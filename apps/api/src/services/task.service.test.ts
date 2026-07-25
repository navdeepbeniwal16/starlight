import { prisma } from "../lib/prisma";
import { getBacklog } from "./task.service";
import type { DayPlanStatus } from "@prisma/client";

const TEST_EMAIL = "test-task-service@starlight.test";
const OTHER_EMAIL = "test-task-service-other@starlight.test";

// getBacklog buckets "today" from the client's local date; tests pin offset 0
// so the day range is the UTC calendar day and freshly created tasks (whose
// updatedAt is now) always land inside it.
const UTC_OFFSET = 0;
const DAY_MS = 24 * 60 * 60 * 1000;

function utcDateString(d: Date): string {
    return d.toISOString().slice(0, 10);
}

const TODAY = utcDateString(new Date());
const YESTERDAY = utcDateString(new Date(Date.now() - DAY_MS));

async function seedUser(email: string) {
    return prisma.user.upsert({
        where: { email },
        update: {},
        create: {
            email,
            passwordHash: "not-a-real-hash",
            firstName: "Test",
            lastName: "User",
        },
    });
}

async function cleanup(userId: string) {
    await prisma.task.deleteMany({ where: { userId } });
    const plans = await prisma.dayPlan.findMany({ where: { userId }, select: { id: true } });
    await prisma.plannedBlock.deleteMany({ where: { dayPlanId: { in: plans.map((p) => p.id) } } });
    await prisma.dayPlan.deleteMany({ where: { userId } });
}

type BlockSpec = { name: string; startTime: string; endTime: string };

// Creates a plan with one CONTAINER block per spec; returns blocks in spec order.
async function seedPlan(
    userId: string,
    date: string,
    status: DayPlanStatus = "ACTIVE",
    blockSpecs: BlockSpec[] = [{ name: "Deep Work", startTime: "09:00", endTime: "12:00" }],
) {
    const plan = await prisma.dayPlan.create({
        data: {
            userId,
            date,
            wakeTime: "07:00",
            sleepTime: "23:00",
            status,
            blocks: { create: blockSpecs.map((b) => ({ type: "CONTAINER" as const, ...b })) },
        },
        include: { blocks: true },
    });
    return blockSpecs.map((spec) => plan.blocks.find((b) => b.name === spec.name)!);
}

type TaskSpec = {
    title: string;
    plannedBlockId?: string;
    blockOrder?: number;
    done?: boolean;
    priority?: "HIGH" | "MEDIUM" | "LOW";
    deadline?: Date;
};

async function seedTask(userId: string, spec: TaskSpec) {
    return prisma.task.create({
        data: {
            userId,
            title: spec.title,
            estimatedMins: 30,
            ...(spec.plannedBlockId && { plannedBlockId: spec.plannedBlockId }),
            ...(spec.blockOrder !== undefined && { blockOrder: spec.blockOrder }),
            ...(spec.done && { status: "DONE" as const, progress: 100 }),
            ...(spec.priority && { priority: spec.priority }),
            ...(spec.deadline && { deadline: spec.deadline }),
        },
    });
}

// Raw SQL so Prisma's @updatedAt does not overwrite the backdated value.
async function backdateUpdatedAt(taskId: string, to: Date) {
    await prisma.$executeRaw`UPDATE "Task" SET "updatedAt" = ${to} WHERE "id" = ${taskId}`;
}

afterAll(async () => {
    for (const email of [TEST_EMAIL, OTHER_EMAIL]) {
        const user = await prisma.user.findUnique({ where: { email } });
        if (user) {
            await cleanup(user.id);
            await prisma.user.delete({ where: { id: user.id } });
        }
    }
    await prisma.$disconnect();
});

describe("getBacklog", () => {
    let userId: string;

    beforeEach(async () => {
        const user = await seedUser(TEST_EMAIL);
        userId = user.id;
        await cleanup(userId);
    });

    it("buckets tasks into carriedOver, scheduled, remaining, and doneToday", async () => {
        const [yesterdayBlock] = await seedPlan(userId, YESTERDAY);
        const [todayBlock] = await seedPlan(userId, TODAY);

        await seedTask(userId, { title: "Carried", plannedBlockId: yesterdayBlock.id, blockOrder: 1 });
        await seedTask(userId, { title: "Scheduled", plannedBlockId: todayBlock.id, blockOrder: 1 });
        await seedTask(userId, { title: "Remaining" });
        await seedTask(userId, { title: "Done", done: true });

        const buckets = await getBacklog(userId, TODAY, UTC_OFFSET);

        expect(buckets.carriedOver.map((t) => t.title)).toEqual(["Carried"]);
        expect(buckets.scheduled.map((t) => t.title)).toEqual(["Scheduled"]);
        expect(buckets.remaining.map((t) => t.title)).toEqual(["Remaining"]);
        expect(buckets.doneToday.map((t) => t.title)).toEqual(["Done"]);
    });

    it("puts a task completed today in doneToday regardless of plan placement", async () => {
        const [yesterdayBlock] = await seedPlan(userId, YESTERDAY);
        const [todayBlock] = await seedPlan(userId, TODAY);

        await seedTask(userId, { title: "Done on today's plan", plannedBlockId: todayBlock.id, blockOrder: 1, done: true });
        await seedTask(userId, { title: "Done on old plan", plannedBlockId: yesterdayBlock.id, blockOrder: 1, done: true });

        const buckets = await getBacklog(userId, TODAY, UTC_OFFSET);

        expect(buckets.scheduled).toHaveLength(0);
        expect(buckets.carriedOver).toHaveLength(0);
        expect(buckets.doneToday.map((t) => t.title).sort()).toEqual([
            "Done on old plan",
            "Done on today's plan",
        ]);
    });

    it("excludes tasks completed before today from every bucket", async () => {
        const doneYesterday = await seedTask(userId, { title: "Done yesterday", done: true });
        await backdateUpdatedAt(doneYesterday.id, new Date(Date.now() - 26 * 60 * 60 * 1000));

        const buckets = await getBacklog(userId, TODAY, UTC_OFFSET);

        expect(buckets.carriedOver).toHaveLength(0);
        expect(buckets.scheduled).toHaveLength(0);
        expect(buckets.remaining).toHaveLength(0);
        expect(buckets.doneToday).toHaveLength(0);
    });

    it("annotates scheduled tasks with their block's start time and name", async () => {
        const [block] = await seedPlan(userId, TODAY, "ACTIVE", [
            { name: "Morning Focus", startTime: "08:30", endTime: "10:00" },
        ]);
        await seedTask(userId, { title: "Scheduled", plannedBlockId: block.id, blockOrder: 1 });

        const buckets = await getBacklog(userId, TODAY, UTC_OFFSET);

        expect(buckets.scheduled).toHaveLength(1);
        expect(buckets.scheduled[0]).toMatchObject({
            title: "Scheduled",
            blockStartTime: "08:30",
            blockName: "Morning Focus",
        });
    });

    it("orders scheduled tasks by block start time, then block order", async () => {
        const [afternoon, morning] = await seedPlan(userId, TODAY, "ACTIVE", [
            { name: "Afternoon", startTime: "13:00", endTime: "17:00" },
            { name: "Morning", startTime: "09:00", endTime: "12:00" },
        ]);

        await seedTask(userId, { title: "PM second", plannedBlockId: afternoon.id, blockOrder: 2 });
        await seedTask(userId, { title: "PM first", plannedBlockId: afternoon.id, blockOrder: 1 });
        await seedTask(userId, { title: "AM only", plannedBlockId: morning.id, blockOrder: 1 });

        const buckets = await getBacklog(userId, TODAY, UTC_OFFSET);

        expect(buckets.scheduled.map((t) => t.title)).toEqual(["AM only", "PM first", "PM second"]);
    });

    it("orders open buckets by deadline first, then priority, nulls last", async () => {
        const d1 = new Date(Date.now() + 2 * DAY_MS);
        const d2 = new Date(Date.now() + 5 * DAY_MS);

        await seedTask(userId, { title: "No deadline, no priority" });
        await seedTask(userId, { title: "No deadline, high", priority: "HIGH" });
        await seedTask(userId, { title: "Later deadline, high", priority: "HIGH", deadline: d2 });
        await seedTask(userId, { title: "Soon deadline, low", priority: "LOW", deadline: d1 });
        await seedTask(userId, { title: "Soon deadline, high", priority: "HIGH", deadline: d1 });

        const buckets = await getBacklog(userId, TODAY, UTC_OFFSET);

        expect(buckets.remaining.map((t) => t.title)).toEqual([
            "Soon deadline, high",
            "Soon deadline, low",
            "Later deadline, high",
            "No deadline, high",
            "No deadline, no priority",
        ]);
    });

    it("does not treat tasks on non-ACTIVE plans as carried over or scheduled", async () => {
        const [retiredBlock] = await seedPlan(userId, YESTERDAY, "COMPLETED");
        await seedTask(userId, { title: "On retired plan", plannedBlockId: retiredBlock.id, blockOrder: 1 });

        const buckets = await getBacklog(userId, TODAY, UTC_OFFSET);

        expect(buckets.carriedOver).toHaveLength(0);
        expect(buckets.scheduled).toHaveLength(0);
    });

    it("returns four empty arrays when the user has no tasks", async () => {
        const buckets = await getBacklog(userId, TODAY, UTC_OFFSET);

        expect(buckets).toEqual({ carriedOver: [], scheduled: [], remaining: [], doneToday: [] });
    });

    it("does not return another user's tasks", async () => {
        const other = await seedUser(OTHER_EMAIL);
        await cleanup(other.id);
        const [otherBlock] = await seedPlan(other.id, TODAY);
        await seedTask(other.id, { title: "Other scheduled", plannedBlockId: otherBlock.id, blockOrder: 1 });
        await seedTask(other.id, { title: "Other remaining" });
        await seedTask(other.id, { title: "Other done", done: true });

        const buckets = await getBacklog(userId, TODAY, UTC_OFFSET);

        expect(buckets).toEqual({ carriedOver: [], scheduled: [], remaining: [], doneToday: [] });
    });
});
