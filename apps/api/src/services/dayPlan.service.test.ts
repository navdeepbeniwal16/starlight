import { prisma } from "../lib/prisma";
import { getDayPlan, createDraftPlan, getPlanTasks, NoTemplateError, NoContainerBlocksError, PlanNotFoundError } from "./dayPlan.service";

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
