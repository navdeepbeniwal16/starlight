import { prisma } from "../lib/prisma";
import { getDayPlan, createDraftPlan, getPlanTasks, generatePlan, adjustPlanTask, confirmPlan, NoTemplateError, NoContainerBlocksError, PlanNotFoundError, PlanNotInDraftError, InvalidBlockError } from "./dayPlan.service";
import { TaskNotFoundError } from "./task.service";
import type { AgentInput } from "./planAgent.service";

const TEST_EMAIL = "test-dayplan-service@starlight.test";
const TEST_EMAIL_CREATE = "test-create-draft-plan@starlight.test";

async function seedUser() {
    return prisma.user.upsert({
        where: { email: TEST_EMAIL },
        update: {},
        create: {
            email: TEST_EMAIL,
            passwordHash: "not-a-real-hash",
            firstName: "Test",
            lastName: "User",
        },
    });
}

async function cleanup(userId: string) {
    await prisma.task.deleteMany({ where: { userId } });
    await prisma.dayPlan.deleteMany({ where: { userId } });
}

afterAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
    if (user) {
        await cleanup(user.id);
        await prisma.user.delete({ where: { id: user.id } });
    }
    await prisma.$disconnect();
});

// ─── createDraftPlan ─────────────────────────────────────────────────────────

async function seedCreateUser() {
    return prisma.user.upsert({
        where: { email: TEST_EMAIL_CREATE },
        update: {},
        create: {
            email: TEST_EMAIL_CREATE,
            passwordHash: "not-a-real-hash",
            firstName: "Create",
            lastName: "User",
        },
    });
}

async function cleanupCreateUser(userId: string) {
    const plans = await prisma.dayPlan.findMany({
        where: { userId },
        select: { blocks: { select: { id: true } } },
    });
    const blockIds = plans.flatMap(p => p.blocks.map(b => b.id));
    if (blockIds.length > 0) {
        await prisma.task.updateMany({
            where: { plannedBlockId: { in: blockIds } },
            data: { plannedBlockId: null, blockOrder: null },
        });
        await prisma.plannedBlock.deleteMany({ where: { id: { in: blockIds } } });
    }
    await prisma.dayPlan.deleteMany({ where: { userId } });

    const template = await prisma.dayTemplate.findUnique({ where: { userId } });
    if (template) {
        await prisma.block.deleteMany({ where: { dayTemplateId: template.id } });
        await prisma.dayTemplate.delete({ where: { id: template.id } });
    }
}

describe("createDraftPlan", () => {
    let userId: string;
    const DATE = "2026-06-20";

    beforeEach(async () => {
        const user = await seedCreateUser();
        userId = user.id;
        await cleanupCreateUser(userId);
    });

    afterAll(async () => {
        const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL_CREATE } });
        if (user) {
            await cleanupCreateUser(user.id);
            await prisma.user.delete({ where: { id: user.id } });
        }
    });

    it("creates PlannedBlocks from all template blocks when all are in the future", async () => {
        await prisma.dayTemplate.create({
            data: {
                userId,
                wakeTime: "07:00",
                sleepTime: "23:00",
                blocks: {
                    create: [
                        { type: "CONTAINER", name: "Deep Work", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" },
                        { type: "ANCHOR",    name: "Lunch",     startTime: "12:00", endTime: "13:00" },
                        { type: "CONTAINER", name: "Afternoon", startTime: "14:00", endTime: "17:00", energyLevel: "MEDIUM" },
                    ],
                },
            },
        });

        const result = await createDraftPlan(userId, DATE, "06:00");

        expect(result).toMatchObject({ id: expect.any(String) });

        const plan = await prisma.dayPlan.findUnique({
            where: { id: (result as { id: string }).id },
            include: { blocks: { orderBy: { startTime: "asc" } } },
        });
        expect(plan!.status).toBe("DRAFT");
        expect(plan!.blocks).toHaveLength(3);
        expect(plan!.blocks[0]).toMatchObject({ name: "Deep Work", startTime: "09:00", endTime: "12:00" });
        expect(plan!.blocks[1]).toMatchObject({ name: "Lunch",     startTime: "12:00", endTime: "13:00" });
        expect(plan!.blocks[2]).toMatchObject({ name: "Afternoon", startTime: "14:00", endTime: "17:00" });
    });

    it("excludes blocks that have fully elapsed (endTime <= nowHHmm)", async () => {
        await prisma.dayTemplate.create({
            data: {
                userId,
                wakeTime: "07:00",
                sleepTime: "23:00",
                blocks: {
                    create: [
                        { type: "CONTAINER", name: "Deep Work", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" },
                        { type: "ANCHOR",    name: "Lunch",     startTime: "12:00", endTime: "13:00" },
                        { type: "CONTAINER", name: "Afternoon", startTime: "14:00", endTime: "17:00", energyLevel: "MEDIUM" },
                    ],
                },
            },
        });

        const result = await createDraftPlan(userId, DATE, "13:00");

        expect(result).toMatchObject({ id: expect.any(String) });

        const plan = await prisma.dayPlan.findUnique({
            where: { id: (result as { id: string }).id },
            include: { blocks: true },
        });
        expect(plan!.blocks).toHaveLength(1);
        expect(plan!.blocks[0]).toMatchObject({ name: "Afternoon", startTime: "14:00" });
    });

    it("trims startTime of a partially elapsed block to the current time", async () => {
        await prisma.dayTemplate.create({
            data: {
                userId,
                wakeTime: "07:00",
                sleepTime: "23:00",
                blocks: {
                    create: [
                        { type: "CONTAINER", name: "Deep Work", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" },
                        { type: "CONTAINER", name: "Afternoon", startTime: "14:00", endTime: "17:00", energyLevel: "MEDIUM" },
                    ],
                },
            },
        });

        const result = await createDraftPlan(userId, DATE, "10:30");

        expect(result).toMatchObject({ id: expect.any(String) });

        const plan = await prisma.dayPlan.findUnique({
            where: { id: (result as { id: string }).id },
            include: { blocks: { orderBy: { startTime: "asc" } } },
        });
        expect(plan!.blocks).toHaveLength(2);
        expect(plan!.blocks[0]).toMatchObject({ name: "Deep Work", startTime: "10:30", endTime: "12:00" });
        expect(plan!.blocks[1]).toMatchObject({ name: "Afternoon", startTime: "14:00", endTime: "17:00" });
    });

    it("discards an existing DRAFT and creates a fresh one on re-trigger", async () => {
        await prisma.dayTemplate.create({
            data: {
                userId,
                wakeTime: "07:00",
                sleepTime: "23:00",
                blocks: {
                    create: [
                        { type: "CONTAINER", name: "Deep Work", startTime: "09:00", endTime: "17:00", energyLevel: "HIGH" },
                    ],
                },
            },
        });

        const first = await createDraftPlan(userId, DATE, "06:00");
        expect(first).toMatchObject({ id: expect.any(String) });
        const firstId = (first as { id: string }).id;

        const second = await createDraftPlan(userId, DATE, "06:00");
        expect(second).toMatchObject({ id: expect.any(String) });
        const secondId = (second as { id: string }).id;

        expect(secondId).not.toBe(firstId);

        const drafts = await prisma.dayPlan.findMany({ where: { userId, date: DATE, status: "DRAFT" } });
        expect(drafts).toHaveLength(1);
        expect(drafts[0].id).toBe(secondId);
    });

    it("throws NoContainerBlocksError when no CONTAINER blocks remain after filtering", async () => {
        await prisma.dayTemplate.create({
            data: {
                userId,
                wakeTime: "07:00",
                sleepTime: "23:00",
                blocks: {
                    create: [
                        { type: "CONTAINER", name: "Deep Work", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" },
                        { type: "ANCHOR",    name: "Evening",   startTime: "19:00", endTime: "20:00" },
                    ],
                },
            },
        });

        await expect(createDraftPlan(userId, DATE, "14:00")).rejects.toThrow(NoContainerBlocksError);

        const plans = await prisma.dayPlan.findMany({ where: { userId } });
        expect(plans).toHaveLength(0);
    });

    it("throws NoTemplateError when the user has no day template", async () => {
        await expect(createDraftPlan(userId, DATE, "09:00")).rejects.toThrow(NoTemplateError);
    });
});

// ─── getPlanTasks ─────────────────────────────────────────────────────────────

const TEST_EMAIL_PLAN_TASKS = "test-get-plan-tasks@starlight.test";

async function seedPlanTasksUser() {
    return prisma.user.upsert({
        where: { email: TEST_EMAIL_PLAN_TASKS },
        update: {},
        create: {
            email: TEST_EMAIL_PLAN_TASKS,
            passwordHash: "not-a-real-hash",
            firstName: "PlanTasks",
            lastName: "User",
        },
    });
}

async function cleanupPlanTasksUser(userId: string) {
    const plans = await prisma.dayPlan.findMany({
        where: { userId },
        select: { blocks: { select: { id: true } } },
    });
    const blockIds = plans.flatMap(p => p.blocks.map(b => b.id));
    if (blockIds.length > 0) {
        await prisma.task.updateMany({
            where: { plannedBlockId: { in: blockIds } },
            data: { plannedBlockId: null, blockOrder: null },
        });
        await prisma.plannedBlock.deleteMany({ where: { id: { in: blockIds } } });
    }
    await prisma.task.deleteMany({ where: { userId } });
    await prisma.dayPlan.deleteMany({ where: { userId } });
}

describe("getPlanTasks", () => {
    let userId: string;
    const TODAY = "2026-06-20";
    const YESTERDAY = "2026-06-19";

    beforeEach(async () => {
        const user = await seedPlanTasksUser();
        userId = user.id;
        await cleanupPlanTasksUser(userId);
    });

    afterAll(async () => {
        const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL_PLAN_TASKS } });
        if (user) {
            await cleanupPlanTasksUser(user.id);
            await prisma.user.delete({ where: { id: user.id } });
        }
    });

    it("throws PlanNotFoundError when plan does not exist", async () => {
        await expect(getPlanTasks(userId, "nonexistent-id")).rejects.toThrow(PlanNotFoundError);
    });

    it("throws PlanNotFoundError when plan belongs to a different user", async () => {
        const otherUser = await prisma.user.create({
            data: { email: "other-plan-tasks@starlight.test", passwordHash: "x", firstName: "Other", lastName: "User" },
        });
        const plan = await prisma.dayPlan.create({
            data: { userId: otherUser.id, date: TODAY, wakeTime: "07:00", sleepTime: "23:00", status: "DRAFT" },
        });
        try {
            await expect(getPlanTasks(userId, plan.id)).rejects.toThrow(PlanNotFoundError);
        } finally {
            await prisma.dayPlan.delete({ where: { id: plan.id } });
            await prisma.user.delete({ where: { id: otherUser.id } });
        }
    });

    it("returns carried-over non-DONE tasks from yesterday's ACTIVE plan", async () => {
        const draftPlan = await prisma.dayPlan.create({
            data: { userId, date: TODAY, wakeTime: "07:00", sleepTime: "23:00", status: "DRAFT" },
        });
        const yesterdayPlan = await prisma.dayPlan.create({
            data: { userId, date: YESTERDAY, wakeTime: "07:00", sleepTime: "23:00", status: "ACTIVE" },
        });
        const block = await prisma.plannedBlock.create({
            data: { dayPlanId: yesterdayPlan.id, type: "CONTAINER", name: "Work", startTime: "09:00", endTime: "12:00" },
        });

        const todoTask = await prisma.task.create({
            data: { userId, title: "Todo task", estimatedMins: 30, status: "TODO", plannedBlockId: block.id },
        });
        const inProgressTask = await prisma.task.create({
            data: { userId, title: "In-progress task", estimatedMins: 60, status: "IN_PROGRESS", plannedBlockId: block.id },
        });
        await prisma.task.create({
            data: { userId, title: "Done task", estimatedMins: 30, status: "DONE", plannedBlockId: block.id },
        });

        const result = await getPlanTasks(userId, draftPlan.id);

        const ids = result.carriedOver.map(t => t.id).sort();
        expect(ids).toEqual([todoTask.id, inProgressTask.id].sort());
        expect(result.carriedOver.every(t => t.status !== 'DONE')).toBe(true);
        expect(result.backlog).toHaveLength(0);
    });

    it("omits carried-over section (returns empty array) when no yesterday ACTIVE plan exists", async () => {
        const draftPlan = await prisma.dayPlan.create({
            data: { userId, date: TODAY, wakeTime: "07:00", sleepTime: "23:00", status: "DRAFT" },
        });
        await prisma.task.create({
            data: { userId, title: "Backlog task", estimatedMins: 30, status: "TODO" },
        });

        const result = await getPlanTasks(userId, draftPlan.id);

        expect(result.carriedOver).toHaveLength(0);
        expect(result.backlog).toHaveLength(1);
    });

    it("backlog includes unscheduled non-DONE tasks and excludes tasks with a plannedBlockId", async () => {
        const draftPlan = await prisma.dayPlan.create({
            data: { userId, date: TODAY, wakeTime: "07:00", sleepTime: "23:00", status: "DRAFT" },
        });
        const activePlan = await prisma.dayPlan.create({
            data: { userId, date: TODAY, wakeTime: "07:00", sleepTime: "23:00", status: "ACTIVE" },
        });
        const block = await prisma.plannedBlock.create({
            data: { dayPlanId: activePlan.id, type: "CONTAINER", name: "Work", startTime: "09:00", endTime: "12:00" },
        });

        const backlogTask = await prisma.task.create({
            data: { userId, title: "Free task", estimatedMins: 30, status: "TODO" },
        });
        await prisma.task.create({
            data: { userId, title: "Done backlog", estimatedMins: 30, status: "DONE" },
        });
        await prisma.task.create({
            data: { userId, title: "Planned task", estimatedMins: 30, status: "TODO", plannedBlockId: block.id },
        });

        const result = await getPlanTasks(userId, draftPlan.id);

        expect(result.backlog).toHaveLength(1);
        expect(result.backlog[0].id).toBe(backlogTask.id);
    });

    it("does not include yesterday DRAFT plan tasks in carried-over", async () => {
        const draftPlan = await prisma.dayPlan.create({
            data: { userId, date: TODAY, wakeTime: "07:00", sleepTime: "23:00", status: "DRAFT" },
        });
        const yesterdayDraft = await prisma.dayPlan.create({
            data: { userId, date: YESTERDAY, wakeTime: "07:00", sleepTime: "23:00", status: "DRAFT" },
        });
        const block = await prisma.plannedBlock.create({
            data: { dayPlanId: yesterdayDraft.id, type: "CONTAINER", name: "Work", startTime: "09:00", endTime: "12:00" },
        });
        await prisma.task.create({
            data: { userId, title: "Draft plan task", estimatedMins: 30, status: "TODO", plannedBlockId: block.id },
        });

        const result = await getPlanTasks(userId, draftPlan.id);

        expect(result.carriedOver).toHaveLength(0);
    });

    it("carries over from an older ACTIVE plan when a day was skipped (no plan yesterday)", async () => {
        const TWO_DAYS_AGO = "2026-06-18";
        const draftPlan = await prisma.dayPlan.create({
            data: { userId, date: TODAY, wakeTime: "07:00", sleepTime: "23:00", status: "DRAFT" },
        });
        // ACTIVE plan two days ago; nothing was planned yesterday.
        const olderActive = await prisma.dayPlan.create({
            data: { userId, date: TWO_DAYS_AGO, wakeTime: "07:00", sleepTime: "23:00", status: "ACTIVE" },
        });
        const block = await prisma.plannedBlock.create({
            data: { dayPlanId: olderActive.id, type: "CONTAINER", name: "Work", startTime: "09:00", endTime: "12:00" },
        });
        const stranded = await prisma.task.create({
            data: { userId, title: "Unfinished", estimatedMins: 30, status: "TODO", plannedBlockId: block.id },
        });

        const result = await getPlanTasks(userId, draftPlan.id);

        expect(result.carriedOver.map(t => t.id)).toEqual([stranded.id]);
    });

    it("carries over from today's ACTIVE plan on a same-day re-plan", async () => {
        const draftPlan = await prisma.dayPlan.create({
            data: { userId, date: TODAY, wakeTime: "07:00", sleepTime: "23:00", status: "DRAFT" },
        });
        const todayActive = await prisma.dayPlan.create({
            data: { userId, date: TODAY, wakeTime: "07:00", sleepTime: "23:00", status: "ACTIVE" },
        });
        const block = await prisma.plannedBlock.create({
            data: { dayPlanId: todayActive.id, type: "CONTAINER", name: "Work", startTime: "09:00", endTime: "12:00" },
        });
        const unfinished = await prisma.task.create({
            data: { userId, title: "Still going", estimatedMins: 30, status: "IN_PROGRESS", plannedBlockId: block.id },
        });

        const result = await getPlanTasks(userId, draftPlan.id);

        expect(result.carriedOver.map(t => t.id)).toEqual([unfinished.id]);
    });

    it("carries over only from the most recent ACTIVE plan when several exist", async () => {
        const draftPlan = await prisma.dayPlan.create({
            data: { userId, date: TODAY, wakeTime: "07:00", sleepTime: "23:00", status: "DRAFT" },
        });
        const olderActive = await prisma.dayPlan.create({
            data: { userId, date: "2026-06-18", wakeTime: "07:00", sleepTime: "23:00", status: "ACTIVE" },
        });
        const olderBlock = await prisma.plannedBlock.create({
            data: { dayPlanId: olderActive.id, type: "CONTAINER", name: "Old", startTime: "09:00", endTime: "12:00" },
        });
        await prisma.task.create({
            data: { userId, title: "Old task", estimatedMins: 30, status: "TODO", plannedBlockId: olderBlock.id },
        });
        const recentActive = await prisma.dayPlan.create({
            data: { userId, date: YESTERDAY, wakeTime: "07:00", sleepTime: "23:00", status: "ACTIVE" },
        });
        const recentBlock = await prisma.plannedBlock.create({
            data: { dayPlanId: recentActive.id, type: "CONTAINER", name: "Recent", startTime: "09:00", endTime: "12:00" },
        });
        const recentTask = await prisma.task.create({
            data: { userId, title: "Recent task", estimatedMins: 30, status: "TODO", plannedBlockId: recentBlock.id },
        });

        const result = await getPlanTasks(userId, draftPlan.id);

        expect(result.carriedOver.map(t => t.id)).toEqual([recentTask.id]);
    });
});

describe("getDayPlan", () => {
    let userId: string;

    beforeEach(async () => {
        const user = await seedUser();
        userId = user.id;
        await cleanup(userId);
    });

    it("returns the ACTIVE plan when both DRAFT and ACTIVE exist for the same date", async () => {
        const date = "2026-01-15";

        const draft = await prisma.dayPlan.create({
            data: { userId, date, wakeTime: "07:00", sleepTime: "23:00", status: "DRAFT" },
        });
        const active = await prisma.dayPlan.create({
            data: { userId, date, wakeTime: "07:00", sleepTime: "23:00", status: "ACTIVE" },
        });

        const result = await getDayPlan(userId, date);

        expect(result).not.toBeNull();
        expect(result!.id).toBe(active.id);
        expect(result!.status).toBe("ACTIVE");
        expect(result!.id).not.toBe(draft.id);
    });

    it("returns null when no ACTIVE plan exists for the date", async () => {
        const date = "2026-01-16";

        await prisma.dayPlan.create({
            data: { userId, date, wakeTime: "07:00", sleepTime: "23:00", status: "DRAFT" },
        });

        const result = await getDayPlan(userId, date);

        expect(result).toBeNull();
    });

    it("returns null when no plan exists for the date", async () => {
        const result = await getDayPlan(userId, "2026-01-17");
        expect(result).toBeNull();
    });
});

// ─── generatePlan ─────────────────────────────────────────────────────────────

const TEST_EMAIL_GENERATE = "test-generate-plan@starlight.test";

async function seedGenerateUser() {
    return prisma.user.upsert({
        where: { email: TEST_EMAIL_GENERATE },
        update: {},
        create: {
            email: TEST_EMAIL_GENERATE,
            passwordHash: "not-a-real-hash",
            firstName: "Generate",
            lastName: "User",
        },
    });
}

async function cleanupGenerateUser(userId: string) {
    const plans = await prisma.dayPlan.findMany({
        where: { userId },
        select: { blocks: { select: { id: true } } },
    });
    const blockIds = plans.flatMap(p => p.blocks.map(b => b.id));
    if (blockIds.length > 0) {
        await prisma.task.updateMany({
            where: { plannedBlockId: { in: blockIds } },
            data: { plannedBlockId: null, blockOrder: null },
        });
        await prisma.plannedBlock.deleteMany({ where: { id: { in: blockIds } } });
    }
    await prisma.task.deleteMany({ where: { userId } });
    await prisma.dayPlan.deleteMany({ where: { userId } });
}

type AgentFixture = {
    assignments: { taskId: string; blockId: string; blockOrder: number }[];
    unschedulable: { taskId: string; reason: string }[];
};

// An injectable agent that records the input it was handed and returns a fixture.
function recordingAgent(result: AgentFixture) {
    const calls: AgentInput[] = [];
    return {
        calls,
        deps: { callAgent: async (input: AgentInput) => { calls.push(input); return result; } },
    };
}

describe("generatePlan", () => {
    let userId: string;
    const TODAY = "2026-06-22";
    const YESTERDAY = "2026-06-21";

    beforeEach(async () => {
        const user = await seedGenerateUser();
        userId = user.id;
        await cleanupGenerateUser(userId);
    });

    afterAll(async () => {
        const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL_GENERATE } });
        if (user) {
            await cleanupGenerateUser(user.id);
            await prisma.user.delete({ where: { id: user.id } });
        }
    });

    async function createDraftWithBlocks() {
        const draft = await prisma.dayPlan.create({
            data: {
                userId, date: TODAY, wakeTime: "07:00", sleepTime: "23:00", status: "DRAFT",
                blocks: {
                    create: [
                        { type: "CONTAINER", name: "Deep Work", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" },
                        { type: "ANCHOR", name: "Lunch", startTime: "12:00", endTime: "13:00" },
                    ],
                },
            },
            select: { id: true, blocks: { select: { id: true, type: true } } },
        });
        const container = draft.blocks.find(b => b.type === "CONTAINER")!;
        return { draftId: draft.id, containerId: container.id };
    }

    it("passes CONTAINER-only blocks and pre-computed remainingMins to the agent", async () => {
        const { draftId } = await createDraftWithBlocks();
        await prisma.task.create({
            data: { userId, title: "Half done", estimatedMins: 60, progress: 50, status: "IN_PROGRESS" },
        });

        const agent = recordingAgent({ assignments: [], unschedulable: [] });
        await generatePlan(userId, draftId, agent.deps);

        expect(agent.calls).toHaveLength(1);
        const input = agent.calls[0];
        expect(input.blocks.map(b => b.name)).toEqual(["Deep Work"]); // ANCHOR excluded
        expect(input.tasks).toHaveLength(1);
        expect(input.tasks[0]).toMatchObject({ title: "Half done", remainingMins: 30 });
    });

    it("writes agent assignments to the DB and returns the populated draft", async () => {
        const { draftId, containerId } = await createDraftWithBlocks();
        const taskA = await prisma.task.create({
            data: { userId, title: "A", estimatedMins: 30, status: "TODO" },
        });
        const taskB = await prisma.task.create({
            data: { userId, title: "B", estimatedMins: 45, status: "TODO" },
        });

        const agent = recordingAgent({
            assignments: [
                { taskId: taskB.id, blockId: containerId, blockOrder: 0 },
                { taskId: taskA.id, blockId: containerId, blockOrder: 1 },
            ],
            unschedulable: [],
        });

        const result = await generatePlan(userId, draftId, agent.deps);

        const writtenA = await prisma.task.findUnique({ where: { id: taskA.id } });
        const writtenB = await prisma.task.findUnique({ where: { id: taskB.id } });
        expect(writtenA).toMatchObject({ plannedBlockId: containerId, blockOrder: 1 });
        expect(writtenB).toMatchObject({ plannedBlockId: containerId, blockOrder: 0 });

        const containerBlock = result.plan.blocks.find(b => b.id === containerId)!;
        expect(containerBlock.tasks.map(t => t.title)).toEqual(["B", "A"]); // ordered by blockOrder
    });

    it("returns remainingMins (estimate scaled by progress) on populated tasks", async () => {
        const { draftId, containerId } = await createDraftWithBlocks();
        const task = await prisma.task.create({
            data: { userId, title: "Half done", estimatedMins: 60, progress: 75, status: "IN_PROGRESS" },
        });

        const agent = recordingAgent({
            assignments: [{ taskId: task.id, blockId: containerId, blockOrder: 0 }],
            unschedulable: [],
        });

        const result = await generatePlan(userId, draftId, agent.deps);

        const planned = result.plan.blocks.find(b => b.id === containerId)!.tasks[0];
        expect(planned).toMatchObject({ estimatedMins: 60, remainingMins: 15 });
    });

    it("returns the unschedulable list and ignores assignments to unknown blocks/tasks", async () => {
        const { draftId, containerId } = await createDraftWithBlocks();
        const taskA = await prisma.task.create({
            data: { userId, title: "A", estimatedMins: 30, status: "TODO" },
        });

        const agent = recordingAgent({
            assignments: [
                { taskId: taskA.id, blockId: "nonexistent-block", blockOrder: 0 },
                { taskId: "nonexistent-task", blockId: containerId, blockOrder: 0 },
            ],
            unschedulable: [{ taskId: taskA.id, reason: "no fit" }],
        });

        const result = await generatePlan(userId, draftId, agent.deps);

        const written = await prisma.task.findUnique({ where: { id: taskA.id } });
        expect(written!.plannedBlockId).toBeNull();
        expect(written!.blockOrder).toBeNull();
        expect(result.unschedulable).toEqual([
            { taskId: taskA.id, title: "A", estimatedMins: 30, remainingMins: 30, reason: "no fit" },
        ]);
    });

    it("includes carry-over tasks from yesterday's ACTIVE plan in the agent input", async () => {
        const { draftId } = await createDraftWithBlocks();
        const yesterdayActive = await prisma.dayPlan.create({
            data: {
                userId, date: YESTERDAY, wakeTime: "07:00", sleepTime: "23:00", status: "ACTIVE",
                blocks: { create: [{ type: "CONTAINER", name: "Y", startTime: "09:00", endTime: "12:00" }] },
            },
            select: { blocks: { select: { id: true } } },
        });
        await prisma.task.create({
            data: { userId, title: "Carry", estimatedMins: 40, status: "IN_PROGRESS", plannedBlockId: yesterdayActive.blocks[0].id },
        });

        const agent = recordingAgent({ assignments: [], unschedulable: [] });
        await generatePlan(userId, draftId, agent.deps);

        expect(agent.calls[0].tasks.map(t => t.title)).toContain("Carry");
    });

    it("throws PlanNotFoundError when the plan does not exist", async () => {
        const agent = recordingAgent({ assignments: [], unschedulable: [] });
        await expect(generatePlan(userId, "nonexistent", agent.deps)).rejects.toThrow(PlanNotFoundError);
    });

    it("throws PlanNotInDraftError when the plan is not a DRAFT", async () => {
        const active = await prisma.dayPlan.create({
            data: { userId, date: TODAY, wakeTime: "07:00", sleepTime: "23:00", status: "ACTIVE" },
        });
        const agent = recordingAgent({ assignments: [], unschedulable: [] });
        await expect(generatePlan(userId, active.id, agent.deps)).rejects.toThrow(PlanNotInDraftError);
    });
});

// ─── adjustPlanTask ───────────────────────────────────────────────────────────

const TEST_EMAIL_ADJUST = "test-adjust-plan-task@starlight.test";

async function seedAdjustUser() {
    return prisma.user.upsert({
        where: { email: TEST_EMAIL_ADJUST },
        update: {},
        create: {
            email: TEST_EMAIL_ADJUST,
            passwordHash: "not-a-real-hash",
            firstName: "Adjust",
            lastName: "User",
        },
    });
}

async function cleanupAdjustUser(userId: string) {
    const plans = await prisma.dayPlan.findMany({
        where: { userId },
        select: { blocks: { select: { id: true } } },
    });
    const blockIds = plans.flatMap(p => p.blocks.map(b => b.id));
    if (blockIds.length > 0) {
        await prisma.task.updateMany({
            where: { plannedBlockId: { in: blockIds } },
            data: { plannedBlockId: null, blockOrder: null },
        });
        await prisma.plannedBlock.deleteMany({ where: { id: { in: blockIds } } });
    }
    await prisma.task.deleteMany({ where: { userId } });
    await prisma.dayPlan.deleteMany({ where: { userId } });
}

describe("adjustPlanTask", () => {
    let userId: string;
    const TODAY = "2026-06-22";

    beforeEach(async () => {
        const user = await seedAdjustUser();
        userId = user.id;
        await cleanupAdjustUser(userId);
    });

    afterAll(async () => {
        const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL_ADJUST } });
        if (user) {
            await cleanupAdjustUser(user.id);
            await prisma.user.delete({ where: { id: user.id } });
        }
    });

    // Creates a DRAFT with two CONTAINER blocks + one ANCHOR, and a task scheduled
    // into the first container block.
    async function seedDraft() {
        const draft = await prisma.dayPlan.create({
            data: {
                userId, date: TODAY, wakeTime: "07:00", sleepTime: "23:00", status: "DRAFT",
                blocks: {
                    create: [
                        { type: "CONTAINER", name: "Morning", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" },
                        { type: "CONTAINER", name: "Afternoon", startTime: "14:00", endTime: "17:00", energyLevel: "MEDIUM" },
                        { type: "ANCHOR", name: "Lunch", startTime: "12:00", endTime: "13:00" },
                    ],
                },
            },
            select: { id: true, blocks: { select: { id: true, name: true, type: true } } },
        });
        const morning = draft.blocks.find(b => b.name === "Morning")!;
        const afternoon = draft.blocks.find(b => b.name === "Afternoon")!;
        const anchor = draft.blocks.find(b => b.type === "ANCHOR")!;
        const taskRow = await prisma.task.create({
            data: { userId, title: "Task", estimatedMins: 30, status: "TODO", plannedBlockId: morning.id, blockOrder: 0 },
        });
        return { draftId: draft.id, morningId: morning.id, afternoonId: afternoon.id, anchorId: anchor.id, taskId: taskRow.id };
    }

    it("moves a task to a different block, clamping blockOrder into range", async () => {
        const { draftId, afternoonId, taskId } = await seedDraft();

        // Afternoon is empty, so an out-of-range index clamps to 0.
        const result = await adjustPlanTask(userId, draftId, taskId, afternoonId, 2);

        expect(result).toMatchObject({ id: taskId, plannedBlockId: afternoonId, blockOrder: 0 });
        const written = await prisma.task.findUnique({ where: { id: taskId } });
        expect(written).toMatchObject({ plannedBlockId: afternoonId, blockOrder: 0 });
    });

    it("inserts at the requested slot and renumbers the block contiguously", async () => {
        const { draftId, morningId, taskId } = await seedDraft();
        // Morning already holds the seed task at order 0; add two more after it.
        const t1 = await prisma.task.create({
            data: { userId, title: "T1", estimatedMins: 30, status: "TODO", plannedBlockId: morningId, blockOrder: 1 },
        });
        const t2 = await prisma.task.create({
            data: { userId, title: "T2", estimatedMins: 30, status: "TODO", plannedBlockId: morningId, blockOrder: 2 },
        });

        // Move the seed task from slot 0 to slot 1 → expect order [T1, Task, T2].
        const result = await adjustPlanTask(userId, draftId, taskId, morningId, 1);

        expect(result).toMatchObject({ plannedBlockId: morningId, blockOrder: 1 });
        const rows = await prisma.task.findMany({
            where: { plannedBlockId: morningId },
            orderBy: { blockOrder: 'asc' },
            select: { id: true, blockOrder: true },
        });
        expect(rows).toEqual([
            { id: t1.id, blockOrder: 0 },
            { id: taskId, blockOrder: 1 },
            { id: t2.id, blockOrder: 2 },
        ]);
    });

    it("closes the gap in the source block when moving a task out of it", async () => {
        const { draftId, morningId, afternoonId, taskId } = await seedDraft();
        // Morning: [Task(0), keep(1)]. Move Task out → keep should renumber to 0.
        const keep = await prisma.task.create({
            data: { userId, title: "Keep", estimatedMins: 30, status: "TODO", plannedBlockId: morningId, blockOrder: 1 },
        });

        await adjustPlanTask(userId, draftId, taskId, afternoonId, 0);

        const written = await prisma.task.findUnique({ where: { id: keep.id } });
        expect(written).toMatchObject({ plannedBlockId: morningId, blockOrder: 0 });
    });

    it("returns a task to the backlog when blockId is null", async () => {
        const { draftId, taskId } = await seedDraft();

        const result = await adjustPlanTask(userId, draftId, taskId, null, 0);

        expect(result).toMatchObject({ id: taskId, plannedBlockId: null, blockOrder: null });
        const written = await prisma.task.findUnique({ where: { id: taskId } });
        expect(written!.plannedBlockId).toBeNull();
        expect(written!.blockOrder).toBeNull();
    });

    it("throws PlanNotInDraftError when the plan is not a DRAFT", async () => {
        const { draftId, afternoonId, taskId } = await seedDraft();
        await prisma.dayPlan.update({ where: { id: draftId }, data: { status: "ACTIVE" } });

        await expect(adjustPlanTask(userId, draftId, taskId, afternoonId, 0)).rejects.toThrow(PlanNotInDraftError);
    });

    it("throws InvalidBlockError when the target block is an ANCHOR block", async () => {
        const { draftId, anchorId, taskId } = await seedDraft();

        await expect(adjustPlanTask(userId, draftId, taskId, anchorId, 0)).rejects.toThrow(InvalidBlockError);
    });

    it("throws InvalidBlockError when the target block belongs to another plan", async () => {
        const { draftId, taskId } = await seedDraft();
        const otherPlan = await prisma.dayPlan.create({
            data: {
                userId, date: "2026-06-23", wakeTime: "07:00", sleepTime: "23:00", status: "DRAFT",
                blocks: { create: [{ type: "CONTAINER", name: "Other", startTime: "09:00", endTime: "12:00" }] },
            },
            select: { blocks: { select: { id: true } } },
        });

        await expect(adjustPlanTask(userId, draftId, taskId, otherPlan.blocks[0].id, 0)).rejects.toThrow(InvalidBlockError);
    });

    it("throws TaskNotFoundError when the task does not exist", async () => {
        const { draftId, afternoonId } = await seedDraft();

        await expect(adjustPlanTask(userId, draftId, "nonexistent", afternoonId, 0)).rejects.toThrow(TaskNotFoundError);
    });

    it("throws PlanNotFoundError when the plan belongs to another user", async () => {
        const { draftId, afternoonId, taskId } = await seedDraft();
        const other = await prisma.user.create({
            data: { email: "other-adjust@starlight.test", passwordHash: "x", firstName: "O", lastName: "U" },
        });
        try {
            await expect(adjustPlanTask(other.id, draftId, taskId, afternoonId, 0)).rejects.toThrow(PlanNotFoundError);
        } finally {
            await prisma.user.delete({ where: { id: other.id } });
        }
    });
});

// ─── confirmPlan ───────────────────────────────────────────────────────────────

const TEST_EMAIL_CONFIRM = "test-confirm-plan@starlight.test";

async function seedConfirmUser() {
    return prisma.user.upsert({
        where: { email: TEST_EMAIL_CONFIRM },
        update: {},
        create: {
            email: TEST_EMAIL_CONFIRM,
            passwordHash: "not-a-real-hash",
            firstName: "Confirm",
            lastName: "User",
        },
    });
}

async function cleanupConfirmUser(userId: string) {
    const plans = await prisma.dayPlan.findMany({
        where: { userId },
        select: { blocks: { select: { id: true } } },
    });
    const blockIds = plans.flatMap(p => p.blocks.map(b => b.id));
    if (blockIds.length > 0) {
        await prisma.task.updateMany({
            where: { plannedBlockId: { in: blockIds } },
            data: { plannedBlockId: null, blockOrder: null },
        });
        await prisma.plannedBlock.deleteMany({ where: { id: { in: blockIds } } });
    }
    await prisma.task.deleteMany({ where: { userId } });
    await prisma.dayPlan.deleteMany({ where: { userId } });

    const template = await prisma.dayTemplate.findUnique({ where: { userId } });
    if (template) {
        await prisma.block.deleteMany({ where: { dayTemplateId: template.id } });
        await prisma.dayTemplate.delete({ where: { id: template.id } });
    }
}

describe("confirmPlan", () => {
    let userId: string;
    const DATE = "2026-06-22";

    beforeEach(async () => {
        const user = await seedConfirmUser();
        userId = user.id;
        await cleanupConfirmUser(userId);
    });

    afterAll(async () => {
        const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL_CONFIRM } });
        if (user) {
            await cleanupConfirmUser(user.id);
            await prisma.user.delete({ where: { id: user.id } });
        }
    });

    it("promotes a first-time DRAFT to ACTIVE with no other changes", async () => {
        const draft = await prisma.dayPlan.create({
            data: {
                userId, date: DATE, wakeTime: "07:00", sleepTime: "23:00", status: "DRAFT",
                blocks: { create: [{ type: "CONTAINER", name: "Morning", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" }] },
            },
            select: { id: true, blocks: { select: { id: true } } },
        });

        const result = await confirmPlan(userId, draft.id, "08:00");

        expect(result).toMatchObject({ id: draft.id, status: "ACTIVE" });
        const written = await prisma.dayPlan.findUnique({ where: { id: draft.id }, include: { blocks: true } });
        expect(written!.status).toBe("ACTIVE");
        expect(written!.blocks).toHaveLength(1);
        expect(written!.blocks[0].id).toBe(draft.blocks[0].id); // unchanged
    });

    it("copies elapsed template blocks (empty) into a fresh plan so the full day shows", async () => {
        await prisma.dayTemplate.create({
            data: {
                userId, wakeTime: "07:00", sleepTime: "23:00",
                blocks: {
                    create: [
                        { type: "CONTAINER", name: "Early", startTime: "08:00", endTime: "10:00", energyLevel: "HIGH" },
                        { type: "ANCHOR", name: "Lunch", startTime: "12:00", endTime: "13:00" },
                        { type: "CONTAINER", name: "Afternoon", startTime: "14:00", endTime: "17:00", energyLevel: "MEDIUM" },
                    ],
                },
            },
        });
        // Draft mirrors createDraftPlan: only the still-upcoming block exists.
        const draft = await prisma.dayPlan.create({
            data: {
                userId, date: DATE, wakeTime: "07:00", sleepTime: "23:00", status: "DRAFT",
                blocks: { create: [{ type: "CONTAINER", name: "Afternoon", startTime: "14:00", endTime: "17:00", energyLevel: "MEDIUM" }] },
            },
            select: { id: true },
        });

        const result = await confirmPlan(userId, draft.id, "13:30");

        expect(result.status).toBe("ACTIVE");
        // Elapsed template blocks (Early, Lunch) are added empty; ordered by startTime.
        expect(result.blocks.map(b => b.name)).toEqual(["Early", "Lunch", "Afternoon"]);
        const early = result.blocks.find(b => b.name === "Early")!;
        expect(early).toMatchObject({ type: "CONTAINER", startTime: "08:00", endTime: "10:00", energyLevel: "HIGH" });
        expect(early.tasks).toEqual([]);
        // The still-upcoming block is left untouched (not duplicated from the template).
        expect(result.blocks.filter(b => b.name === "Afternoon")).toHaveLength(1);
    });

    it("does not duplicate a block that was upcoming at draft time but has since elapsed", async () => {
        await prisma.dayTemplate.create({
            data: {
                userId, wakeTime: "07:00", sleepTime: "23:00",
                blocks: { create: [{ type: "CONTAINER", name: "Morning", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" }] },
            },
        });
        // Draft still holds Morning (it was upcoming when the draft was created).
        const draft = await prisma.dayPlan.create({
            data: {
                userId, date: DATE, wakeTime: "07:00", sleepTime: "23:00", status: "DRAFT",
                blocks: { create: [{ type: "CONTAINER", name: "Morning", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" }] },
            },
            select: { id: true },
        });

        // Confirm after Morning has elapsed — the template's Morning must not be re-added.
        const result = await confirmPlan(userId, draft.id, "13:00");

        expect(result.blocks.filter(b => b.name === "Morning")).toHaveLength(1);
    });

    it("copies elapsed blocks (and their task assignments) from the old ACTIVE into the new plan", async () => {
        // Old ACTIVE: one elapsed block (ends 10:00) holding a task, one upcoming block.
        const active = await prisma.dayPlan.create({
            data: {
                userId, date: DATE, wakeTime: "07:00", sleepTime: "23:00", status: "ACTIVE",
                blocks: {
                    create: [
                        { type: "CONTAINER", name: "Early", startTime: "08:00", endTime: "10:00", energyLevel: "HIGH" },
                        { type: "CONTAINER", name: "Late", startTime: "14:00", endTime: "16:00", energyLevel: "LOW" },
                    ],
                },
            },
            select: { id: true, blocks: { select: { id: true, name: true } } },
        });
        const elapsedBlock = active.blocks.find(b => b.name === "Early")!;
        const upcomingBlock = active.blocks.find(b => b.name === "Late")!;
        const elapsedTask = await prisma.task.create({
            data: { userId, title: "Done earlier", estimatedMins: 30, status: "DONE", plannedBlockId: elapsedBlock.id, blockOrder: 0 },
        });
        const upcomingTask = await prisma.task.create({
            data: { userId, title: "Not replanned", estimatedMins: 30, status: "TODO", plannedBlockId: upcomingBlock.id, blockOrder: 0 },
        });

        const draft = await prisma.dayPlan.create({
            data: {
                userId, date: DATE, wakeTime: "07:00", sleepTime: "23:00", status: "DRAFT",
                blocks: { create: [{ type: "CONTAINER", name: "Afternoon", startTime: "13:00", endTime: "15:00", energyLevel: "MEDIUM" }] },
            },
            select: { id: true },
        });

        const result = await confirmPlan(userId, draft.id, "12:00");

        expect(result.status).toBe("ACTIVE");
        // The elapsed block is copied into the new plan (a fresh PlannedBlock).
        const copied = result.blocks.find(b => b.name === "Early");
        expect(copied).toBeDefined();
        expect(copied!.id).not.toBe(elapsedBlock.id);
        expect(copied!).toMatchObject({ startTime: "08:00", endTime: "10:00", energyLevel: "HIGH" });
        expect(copied!.tasks.map(t => t.id)).toEqual([elapsedTask.id]);
        // The upcoming (non-elapsed) block is not carried over.
        expect(result.blocks.some(b => b.name === "Late")).toBe(false);

        // The elapsed task now points at the copied block; the upcoming task is unscheduled.
        const writtenElapsed = await prisma.task.findUnique({ where: { id: elapsedTask.id } });
        expect(writtenElapsed!.plannedBlockId).toBe(copied!.id);
        expect(writtenElapsed!.blockOrder).toBe(0);
        const writtenUpcoming = await prisma.task.findUnique({ where: { id: upcomingTask.id } });
        expect(writtenUpcoming!.plannedBlockId).toBeNull();
        expect(writtenUpcoming!.blockOrder).toBeNull();

        // The old ACTIVE plan (and its blocks) is gone.
        expect(await prisma.dayPlan.findUnique({ where: { id: active.id } })).toBeNull();
        expect(await prisma.plannedBlock.findUnique({ where: { id: elapsedBlock.id } })).toBeNull();
        expect(await prisma.plannedBlock.findUnique({ where: { id: upcomingBlock.id } })).toBeNull();
    });

    it("leaves all state untouched when the transactional core fails (atomic)", async () => {
        const active = await prisma.dayPlan.create({
            data: {
                userId, date: DATE, wakeTime: "07:00", sleepTime: "23:00", status: "ACTIVE",
                blocks: { create: [{ type: "CONTAINER", name: "Early", startTime: "08:00", endTime: "10:00" }] },
            },
            select: { id: true, blocks: { select: { id: true } } },
        });
        const draft = await prisma.dayPlan.create({
            data: { userId, date: DATE, wakeTime: "07:00", sleepTime: "23:00", status: "DRAFT" },
            select: { id: true },
        });

        // All mutations happen inside the single $transaction; if it throws, none of
        // them are applied. Forcing it to throw proves the promotion + copy + delete
        // are all-or-nothing.
        const spy = jest.spyOn(prisma, "$transaction").mockImplementationOnce(() => {
            throw new Error("boom");
        });

        await expect(confirmPlan(userId, draft.id, "12:00")).rejects.toThrow("boom");
        spy.mockRestore();

        // Nothing changed: draft is still DRAFT, old ACTIVE still ACTIVE and intact.
        expect((await prisma.dayPlan.findUnique({ where: { id: draft.id } }))!.status).toBe("DRAFT");
        expect((await prisma.dayPlan.findUnique({ where: { id: active.id } }))!.status).toBe("ACTIVE");
        expect(await prisma.plannedBlock.findUnique({ where: { id: active.blocks[0].id } })).not.toBeNull();
    });

    it("throws PlanNotFoundError when the plan belongs to another user", async () => {
        const draft = await prisma.dayPlan.create({
            data: { userId, date: DATE, wakeTime: "07:00", sleepTime: "23:00", status: "DRAFT" },
            select: { id: true },
        });
        const other = await prisma.user.create({
            data: { email: "other-confirm@starlight.test", passwordHash: "x", firstName: "O", lastName: "U" },
        });
        try {
            await expect(confirmPlan(other.id, draft.id, "12:00")).rejects.toThrow(PlanNotFoundError);
        } finally {
            await prisma.user.delete({ where: { id: other.id } });
        }
    });

    it("throws PlanNotInDraftError when the plan is not a DRAFT", async () => {
        const active = await prisma.dayPlan.create({
            data: { userId, date: DATE, wakeTime: "07:00", sleepTime: "23:00", status: "ACTIVE" },
            select: { id: true },
        });

        await expect(confirmPlan(userId, active.id, "12:00")).rejects.toThrow(PlanNotInDraftError);
    });
});
