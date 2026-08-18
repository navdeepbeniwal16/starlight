import { prisma } from "../lib/prisma";
import { getDayPlan, getReviewTasks, generatePlanProposal, confirmPlan, NoTemplateError, NoContainerBlocksError, InvalidAssignmentError } from "./dayPlan.service";
import type { Anthropic } from "@anthropic-ai/sdk";
import type { AgentInput, AgentResult } from "./planAgent.service";

const TEST_EMAIL = "test-dayplan-service@starlight.test";
const DATE = "2026-06-20";
const YESTERDAY = "2026-06-19";
const NOW = "2026-06-20T08:00:00.000Z";

let userId: string;

// Fake agent: returns a canned result wrapped as callModel's tool_use message, and
// records the input it saw.
function fakeAgent(result: AgentResult) {
    const calls: AgentInput[] = [];
    return {
        calls,
        deps: {
            callModel: async (messages: Anthropic.MessageParam[]) => {
                calls.push(JSON.parse(messages[0].content as string) as AgentInput);
                return {
                    content: [{ type: "tool_use", id: "toolu_1", name: "submit_schedule", input: result }],
                } as unknown as Anthropic.Message;
            },
        },
    };
}

const noopAgent = () => fakeAgent({ assignments: [], unschedulable: [] });

async function seedTemplate(blocks?: {
    type: "CONTAINER" | "ANCHOR" | "NO_TASK";
    name: string;
    startTime: string;
    endTime: string;
    energyLevel?: "HIGH" | "MEDIUM" | "LOW";
}[]) {
    return prisma.dayTemplate.create({
        data: {
            userId,
            wakeTime: "07:00",
            sleepTime: "23:00",
            blocks: {
                create: blocks ?? [
                    { type: "CONTAINER", name: "Deep Work", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" },
                    { type: "ANCHOR",    name: "Lunch",     startTime: "12:00", endTime: "13:00" },
                    { type: "CONTAINER", name: "Afternoon", startTime: "14:00", endTime: "17:00", energyLevel: "MEDIUM" },
                ],
            },
        },
        include: { blocks: true },
    });
}

function templateBlock(template: Awaited<ReturnType<typeof seedTemplate>>, name: string) {
    const block = template.blocks.find(b => b.name === name);
    if (!block) throw new Error(`No template block named ${name}`);
    return block;
}

async function seedTask(title: string, overrides: Partial<{
    estimatedMins: number;
    progress: number;
    status: "TODO" | "IN_PROGRESS" | "DONE";
    plannedBlockId: string;
    blockOrder: number;
    notes: string;
    createdAt: Date;
}> = {}) {
    return prisma.task.create({
        data: {
            userId,
            title,
            estimatedMins: overrides.estimatedMins ?? 60,
            status: overrides.status ?? "TODO",
            progress: overrides.progress ?? 0,
            ...(overrides.notes !== undefined && { notes: overrides.notes }),
            ...(overrides.createdAt !== undefined && { createdAt: overrides.createdAt }),
            ...(overrides.plannedBlockId !== undefined && { plannedBlockId: overrides.plannedBlockId }),
            ...(overrides.blockOrder !== undefined && { blockOrder: overrides.blockOrder }),
        },
    });
}

// Creates an ACTIVE plan with the given blocks, returning the created rows.
async function seedActivePlan(date: string, blocks: { type?: "CONTAINER" | "ANCHOR"; name: string; startTime: string; endTime: string }[]) {
    return prisma.dayPlan.create({
        data: {
            userId,
            date,
            wakeTime: "07:00",
            sleepTime: "23:00",
            status: "ACTIVE",
            blocks: {
                create: blocks.map(b => ({
                    type: b.type ?? "CONTAINER",
                    name: b.name,
                    startTime: b.startTime,
                    endTime: b.endTime,
                    energyLevel: "MEDIUM",
                })),
            },
        },
        include: { blocks: { orderBy: { startTime: "asc" } } },
    });
}

async function cleanup() {
    await prisma.task.deleteMany({ where: { userId } });
    const plans = await prisma.dayPlan.findMany({ where: { userId }, select: { id: true } });
    await prisma.plannedBlock.deleteMany({ where: { dayPlanId: { in: plans.map(p => p.id) } } });
    await prisma.dayPlan.deleteMany({ where: { userId } });
    const template = await prisma.dayTemplate.findUnique({ where: { userId } });
    if (template) {
        await prisma.block.deleteMany({ where: { dayTemplateId: template.id } });
        await prisma.dayTemplate.delete({ where: { id: template.id } });
    }
}

beforeAll(async () => {
    const user = await prisma.user.upsert({
        where: { email: TEST_EMAIL },
        update: {},
        create: {
            email: TEST_EMAIL,
            passwordHash: "not-a-real-hash",
            firstName: "Test",
            lastName: "User",
        },
    });
    userId = user.id;
});

beforeEach(async () => {
    await cleanup();
});

afterAll(async () => {
    await cleanup();
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
});

// ─── generatePlanProposal ─────────────────────────────────────────────────────

describe("generatePlanProposal", () => {
    it("throws NoTemplateError when the user has no template", async () => {
        await expect(generatePlanProposal(userId, DATE, "08:00", NOW, noopAgent().deps))
            .rejects.toBeInstanceOf(NoTemplateError);
    });

    it("throws NoContainerBlocksError when every container block has elapsed", async () => {
        await seedTemplate([
            { type: "CONTAINER", name: "Morning", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" },
            { type: "ANCHOR", name: "Dinner", startTime: "18:00", endTime: "19:00" },
        ]);
        await expect(generatePlanProposal(userId, DATE, "13:00", NOW, noopAgent().deps))
            .rejects.toBeInstanceOf(NoContainerBlocksError);
    });

    it("returns eligible blocks keyed by template block id, clamping an in-progress block", async () => {
        const template = await seedTemplate();
        const proposal = await generatePlanProposal(userId, DATE, "10:00", NOW, noopAgent().deps);

        expect(proposal.wakeTime).toBe("07:00");
        expect(proposal.sleepTime).toBe("23:00");
        // Deep Work is in progress (clamped), Lunch + Afternoon upcoming.
        expect(proposal.blocks.map(b => b.name)).toEqual(["Deep Work", "Lunch", "Afternoon"]);
        expect(proposal.blocks[0]).toMatchObject({
            blockId: templateBlock(template, "Deep Work").id,
            startTime: "10:00",
            endTime: "12:00",
        });
    });

    it("writes nothing to the database", async () => {
        await seedTemplate();
        const task = await seedTask("Backlog task");

        await generatePlanProposal(userId, DATE, "08:00", NOW, fakeAgent({
            assignments: [{ taskId: task.id, blockId: "ignored", blockOrder: 0 }],
            unschedulable: [],
        }).deps);

        expect(await prisma.dayPlan.count({ where: { userId } })).toBe(0);
        const after = await prisma.task.findUnique({ where: { id: task.id } });
        expect(after!.plannedBlockId).toBeNull();
    });

    it("places tasks per the agent's assignments, in blockOrder order", async () => {
        const template = await seedTemplate();
        const deepWork = templateBlock(template, "Deep Work");
        const t1 = await seedTask("First", { estimatedMins: 30 });
        const t2 = await seedTask("Second", { estimatedMins: 60, progress: 50 });

        const proposal = await generatePlanProposal(userId, DATE, "08:00", NOW, fakeAgent({
            assignments: [
                { taskId: t2.id, blockId: deepWork.id, blockOrder: 1 },
                { taskId: t1.id, blockId: deepWork.id, blockOrder: 0 },
            ],
            unschedulable: [],
        }).deps);

        const block = proposal.blocks.find(b => b.blockId === deepWork.id)!;
        expect(block.tasks.map(t => t.title)).toEqual(["First", "Second"]);
        expect(block.tasks[1].remainingMins).toBe(30); // 60 mins at 50%
    });

    it("ignores assignments to unknown or non-container blocks and duplicate task ids", async () => {
        const template = await seedTemplate();
        const deepWork = templateBlock(template, "Deep Work");
        const lunch = templateBlock(template, "Lunch");
        const t1 = await seedTask("Valid");

        const proposal = await generatePlanProposal(userId, DATE, "08:00", NOW, fakeAgent({
            assignments: [
                { taskId: t1.id, blockId: deepWork.id, blockOrder: 0 },
                { taskId: t1.id, blockId: lunch.id, blockOrder: 0 },      // duplicate + anchor
                { taskId: "no-such-task", blockId: deepWork.id, blockOrder: 1 },
            ],
            unschedulable: [],
        }).deps);

        const deepWorkBlock = proposal.blocks.find(b => b.blockId === deepWork.id)!;
        const lunchBlock = proposal.blocks.find(b => b.blockId === lunch.id)!;
        expect(deepWorkBlock.tasks.map(t => t.id)).toEqual([t1.id]);
        expect(lunchBlock.tasks).toHaveLength(0);
    });

    it("accounts for every schedulable task: enriched unschedulable plus dropped-task fallback", async () => {
        await seedTemplate();
        const noFit = await seedTask("Too big", { estimatedMins: 600 });
        const dropped = await seedTask("Forgotten by agent");

        const proposal = await generatePlanProposal(userId, DATE, "08:00", NOW, fakeAgent({
            assignments: [],
            unschedulable: [{ taskId: noFit.id, reason: "Exceeds every block's capacity" }],
        }).deps);

        expect(proposal.unschedulable).toHaveLength(2);
        const enriched = proposal.unschedulable.find(u => u.taskId === noFit.id)!;
        expect(enriched).toMatchObject({ title: "Too big", remainingMins: 600, reason: "Exceeds every block's capacity" });
        const fallback = proposal.unschedulable.find(u => u.taskId === dropped.id)!;
        expect(fallback.reason).toBeTruthy();
    });

    it("feeds carried-over tasks to the agent without touching the active plan", async () => {
        await seedTemplate();
        const active = await seedActivePlan(DATE, [
            { name: "Morning", startTime: "09:00", endTime: "12:00" },
            { name: "Evening", startTime: "18:00", endTime: "20:00" },
        ]);
        const futureBlock = active.blocks.find(b => b.name === "Evening")!;
        const scheduled = await seedTask("Already scheduled", { plannedBlockId: futureBlock.id, blockOrder: 0 });
        const agent = noopAgent();

        await generatePlanProposal(userId, DATE, "10:00", NOW, agent.deps);

        // The carried-over task was offered to the agent…
        expect(agent.calls[0].tasks.map(t => t.id)).toContain(scheduled.id);
        // …but its live placement is untouched: generate must be non-destructive.
        const after = await prisma.task.findUnique({ where: { id: scheduled.id } });
        expect(after!.plannedBlockId).toBe(futureBlock.id);
        expect(after!.blockOrder).toBe(0);
        const plan = await prisma.dayPlan.findUnique({ where: { id: active.id } });
        expect(plan!.status).toBe("ACTIVE");
    });

    it("threads `now` and each task's notes and createdAt through to the agent", async () => {
        await seedTemplate();
        const createdAt = new Date("2026-05-01T00:00:00.000Z");
        const t = await seedTask("Backlog task", { notes: "call the vendor first", createdAt });
        const agent = noopAgent();

        await generatePlanProposal(userId, DATE, "08:00", NOW, agent.deps);

        expect(agent.calls[0].now).toBe(NOW);
        const sent = agent.calls[0].tasks.find(x => x.id === t.id)!;
        expect(sent.notes).toBe("call the vendor first");
        expect(sent.createdAt).toBe(createdAt.toISOString());
    });
});

// ─── confirmPlan ──────────────────────────────────────────────────────────────

describe("confirmPlan", () => {
    it("throws NoTemplateError when the user has no template", async () => {
        await expect(confirmPlan(userId, DATE, "08:00", []))
            .rejects.toBeInstanceOf(NoTemplateError);
    });

    it("rejects assignments referencing unknown or non-container blocks", async () => {
        const template = await seedTemplate();
        const lunch = templateBlock(template, "Lunch");
        const task = await seedTask("A task");

        await expect(confirmPlan(userId, DATE, "08:00", [
            { taskId: task.id, blockId: "not-a-block", blockOrder: 0 },
        ])).rejects.toBeInstanceOf(InvalidAssignmentError);

        await expect(confirmPlan(userId, DATE, "08:00", [
            { taskId: task.id, blockId: lunch.id, blockOrder: 0 },
        ])).rejects.toBeInstanceOf(InvalidAssignmentError);
    });

    it("creates an ACTIVE plan spanning the whole day and applies renumbered placements", async () => {
        const template = await seedTemplate();
        const afternoon = templateBlock(template, "Afternoon");
        const t1 = await seedTask("First");
        const t2 = await seedTask("Second");
        const unplaced = await seedTask("Stays in backlog");

        // 13:00 — Deep Work and Lunch have elapsed, Afternoon is upcoming.
        const plan = await confirmPlan(userId, DATE, "13:00", [
            { taskId: t2.id, blockId: afternoon.id, blockOrder: 7 },  // sparse orders
            { taskId: t1.id, blockId: afternoon.id, blockOrder: 3 },
        ]);

        expect(plan.status).toBe("ACTIVE");
        expect(plan.date).toBe(DATE);
        // Whole day is represented, including elapsed blocks as (empty) history.
        expect(plan.blocks.map(b => b.name)).toEqual(["Deep Work", "Lunch", "Afternoon"]);
        expect(plan.blocks[0].tasks).toHaveLength(0);

        const afternoonBlock = plan.blocks.find(b => b.name === "Afternoon")!;
        expect(afternoonBlock.tasks.map(t => t.title)).toEqual(["First", "Second"]);
        expect(afternoonBlock.tasks.map(t => t.blockOrder)).toEqual([0, 1]);

        const backlogTask = await prisma.task.findUnique({ where: { id: unplaced.id } });
        expect(backlogTask!.plannedBlockId).toBeNull();
    });

    it("clamps an in-progress block's startTime but keeps elapsed blocks' original times", async () => {
        await seedTemplate();
        const plan = await confirmPlan(userId, DATE, "10:00", []);

        const deepWork = plan.blocks.find(b => b.name === "Deep Work")!;
        expect(deepWork.startTime).toBe("10:00");

        const early = await confirmPlan(userId, DATE, "15:00", []);
        expect(early.blocks.find(b => b.name === "Deep Work")!.startTime).toBe("09:00");
        expect(early.blocks.find(b => b.name === "Afternoon")!.startTime).toBe("15:00");
    });

    it("silently drops assignments to blocks that elapsed during review", async () => {
        const template = await seedTemplate();
        const deepWork = templateBlock(template, "Deep Work");
        const task = await seedTask("Was placed in a now-elapsed block");

        // Proposal was generated before 12:00; the user confirms at 12:30.
        const plan = await confirmPlan(userId, DATE, "12:30", [
            { taskId: task.id, blockId: deepWork.id, blockOrder: 0 },
        ]);

        expect(plan.blocks.find(b => b.name === "Deep Work")!.tasks).toHaveLength(0);
        const after = await prisma.task.findUnique({ where: { id: task.id } });
        expect(after!.plannedBlockId).toBeNull(); // back in the backlog, not lost
    });

    it("silently drops assignments for tasks that vanished, moved on, or belong to someone else", async () => {
        const template = await seedTemplate();
        const deepWork = templateBlock(template, "Deep Work");
        const done = await seedTask("Completed during review", { status: "DONE", progress: 100 });

        const otherUser = await prisma.user.create({
            data: { email: "other-confirm@starlight.test", passwordHash: "x", firstName: "O", lastName: "U" },
        });
        const foreign = await prisma.task.create({
            data: { userId: otherUser.id, title: "Not yours", estimatedMins: 30 },
        });

        try {
            const plan = await confirmPlan(userId, DATE, "08:00", [
                { taskId: done.id, blockId: deepWork.id, blockOrder: 0 },
                { taskId: "ghost-task", blockId: deepWork.id, blockOrder: 1 },
                { taskId: foreign.id, blockId: deepWork.id, blockOrder: 2 },
            ]);

            expect(plan.blocks.find(b => b.name === "Deep Work")!.tasks).toHaveLength(0);
            const foreignAfter = await prisma.task.findUnique({ where: { id: foreign.id } });
            expect(foreignAfter!.plannedBlockId).toBeNull();
        } finally {
            await prisma.task.delete({ where: { id: foreign.id } });
            await prisma.user.delete({ where: { id: otherUser.id } });
        }
    });

    it("re-plan: replaces the same-day ACTIVE plan, carrying elapsed history and releasing unplaced tasks", async () => {
        const template = await seedTemplate();
        const afternoon = templateBlock(template, "Afternoon");

        // Old plan mirrors the template names/times, as real plans do.
        const old = await seedActivePlan(DATE, [
            { name: "Deep Work", startTime: "09:00", endTime: "12:00" },
            { name: "Afternoon", startTime: "14:00", endTime: "17:00" },
        ]);
        const oldMorning = old.blocks.find(b => b.name === "Deep Work")!;
        const oldAfternoon = old.blocks.find(b => b.name === "Afternoon")!;

        const doneThisMorning = await seedTask("Done this morning", { status: "DONE", progress: 100, plannedBlockId: oldMorning.id, blockOrder: 0 });
        const rescheduled = await seedTask("Re-planned", { plannedBlockId: oldAfternoon.id, blockOrder: 0 });
        const notReplanned = await seedTask("Dropped from plan", { plannedBlockId: oldAfternoon.id, blockOrder: 1 });

        // Confirm at 13:00: Deep Work has elapsed, Afternoon is upcoming.
        const plan = await confirmPlan(userId, DATE, "13:00", [
            { taskId: rescheduled.id, blockId: afternoon.id, blockOrder: 0 },
        ]);

        // Old plan is gone; exactly one plan remains for the date.
        expect(await prisma.dayPlan.count({ where: { userId, date: DATE } })).toBe(1);
        expect(await prisma.dayPlan.findUnique({ where: { id: old.id } })).toBeNull();

        // Elapsed history preserved: the DONE task sits in the new plan's Deep Work copy.
        const newMorning = plan.blocks.find(b => b.name === "Deep Work")!;
        expect(newMorning.tasks.map(t => t.id)).toEqual([doneThisMorning.id]);

        // The re-planned task landed in the new Afternoon block.
        const newAfternoon = plan.blocks.find(b => b.name === "Afternoon")!;
        expect(newAfternoon.tasks.map(t => t.id)).toEqual([rescheduled.id]);

        // The task the user removed from the plan went back to the backlog.
        const released = await prisma.task.findUnique({ where: { id: notReplanned.id } });
        expect(released!.plannedBlockId).toBeNull();
    });

    it("the confirmed placement wins over elapsed history for the same task", async () => {
        const template = await seedTemplate();
        const afternoon = templateBlock(template, "Afternoon");

        const old = await seedActivePlan(DATE, [
            { name: "Deep Work", startTime: "09:00", endTime: "12:00" },
        ]);
        const inElapsed = await seedTask("Started this morning", { progress: 40, plannedBlockId: old.blocks[0].id, blockOrder: 0 });

        const plan = await confirmPlan(userId, DATE, "13:00", [
            { taskId: inElapsed.id, blockId: afternoon.id, blockOrder: 0 },
        ]);

        const newMorning = plan.blocks.find(b => b.name === "Deep Work")!;
        const newAfternoon = plan.blocks.find(b => b.name === "Afternoon")!;
        expect(newMorning.tasks).toHaveLength(0);
        expect(newAfternoon.tasks.map(t => t.id)).toEqual([inElapsed.id]);
    });

    it("retires past-date ACTIVE plans: not-DONE tasks return to the backlog, DONE tasks keep their history", async () => {
        await seedTemplate();
        const yesterdays = await seedActivePlan(YESTERDAY, [
            { name: "Old block", startTime: "09:00", endTime: "12:00" },
        ]);
        const oldBlock = yesterdays.blocks[0];
        const unfinished = await seedTask("Unfinished from yesterday", { plannedBlockId: oldBlock.id, blockOrder: 0 });
        const finished = await seedTask("Finished yesterday", { status: "DONE", progress: 100, plannedBlockId: oldBlock.id, blockOrder: 1 });

        await confirmPlan(userId, DATE, "08:00", []);

        const retired = await prisma.dayPlan.findUnique({ where: { id: yesterdays.id } });
        expect(retired!.status).toBe("COMPLETED");

        const unfinishedAfter = await prisma.task.findUnique({ where: { id: unfinished.id } });
        expect(unfinishedAfter!.plannedBlockId).toBeNull(); // reachable in the backlog again

        const finishedAfter = await prisma.task.findUnique({ where: { id: finished.id } });
        expect(finishedAfter!.plannedBlockId).toBe(oldBlock.id); // history intact
    });

    it("retires a past ACTIVE plan even when a COMPLETED plan already exists for that date", async () => {
        await seedTemplate();

        // Precondition for the @@unique([userId,date,status]) collision: a COMPLETED
        // and an ACTIVE plan on the same past date. seedActivePlan only makes ACTIVE
        // plans, so the COMPLETED one is created directly.
        const stale = await prisma.dayPlan.create({
            data: {
                userId, date: YESTERDAY, wakeTime: "07:00", sleepTime: "23:00", status: "COMPLETED",
                blocks: { create: [{ type: "CONTAINER", name: "Old", startTime: "09:00", endTime: "12:00", energyLevel: "MEDIUM" }] },
            },
            include: { blocks: true },
        });
        const staleDone = await seedTask("Done on stale completed", { status: "DONE", progress: 100, plannedBlockId: stale.blocks[0].id, blockOrder: 0 });

        const active = await seedActivePlan(YESTERDAY, [{ name: "Redo", startTime: "09:00", endTime: "12:00" }]);
        const unfinished = await seedTask("Unfinished on active", { plannedBlockId: active.blocks[0].id, blockOrder: 0 });

        // Must not throw a unique-constraint error while retiring ACTIVE(YESTERDAY).
        await expect(confirmPlan(userId, DATE, "08:00", [])).resolves.toBeDefined();

        const yPlans = await prisma.dayPlan.findMany({ where: { userId, date: YESTERDAY } });
        expect(yPlans).toHaveLength(1);
        expect(yPlans[0].status).toBe("COMPLETED");

        // Neither plan's task is stranded on a deleted/retired plan.
        const unfinishedAfter = await prisma.task.findUnique({ where: { id: unfinished.id } });
        expect(unfinishedAfter!.plannedBlockId).toBeNull();
        const staleAfter = await prisma.task.findUnique({ where: { id: staleDone.id } });
        expect(staleAfter!.plannedBlockId).toBeNull();
    });
});

// ─── getReviewTasks ───────────────────────────────────────────────────────────

describe("getReviewTasks", () => {
    it("splits carry-over (most recent ACTIVE plan) from backlog, excluding DONE", async () => {
        const active = await seedActivePlan(YESTERDAY, [
            { name: "Old block", startTime: "09:00", endTime: "12:00" },
        ]);
        const carried = await seedTask("Carried over", { plannedBlockId: active.blocks[0].id, blockOrder: 0 });
        const doneInPlan = await seedTask("Done in plan", { status: "DONE", progress: 100, plannedBlockId: active.blocks[0].id, blockOrder: 1 });
        const backlogTask = await seedTask("In backlog");
        const doneBacklog = await seedTask("Done in backlog", { status: "DONE", progress: 100 });

        const result = await getReviewTasks(userId, DATE);

        expect(result.carriedOver.map(t => t.id)).toEqual([carried.id]);
        expect(result.backlog.map(t => t.id)).toEqual([backlogTask.id]);
        expect([...result.carriedOver, ...result.backlog].map(t => t.id))
            .not.toContain(doneInPlan.id);
        expect([...result.carriedOver, ...result.backlog].map(t => t.id))
            .not.toContain(doneBacklog.id);
    });

    it("returns empty carry-over when there is no ACTIVE plan", async () => {
        const backlogTask = await seedTask("In backlog");
        const result = await getReviewTasks(userId, DATE);
        expect(result.carriedOver).toEqual([]);
        expect(result.backlog.map(t => t.id)).toEqual([backlogTask.id]);
    });
});

// ─── getDayPlan ───────────────────────────────────────────────────────────────

describe("getDayPlan", () => {
    it("returns the ACTIVE plan for the date with derived remainingMins", async () => {
        const active = await seedActivePlan(DATE, [
            { name: "Morning", startTime: "09:00", endTime: "12:00" },
        ]);
        await seedTask("Half done", { estimatedMins: 90, progress: 50, plannedBlockId: active.blocks[0].id, blockOrder: 0 });

        const plan = await getDayPlan(userId, DATE);

        expect(plan).not.toBeNull();
        expect(plan!.blocks[0].tasks[0]).toMatchObject({ title: "Half done", remainingMins: 45 });
    });

    it("returns null when no ACTIVE plan exists for the date", async () => {
        expect(await getDayPlan(userId, DATE)).toBeNull();
    });
});
