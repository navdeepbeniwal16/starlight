import { prisma } from "../lib/prisma";
import { getBacklog } from "./task.service";

const TEST_EMAIL = "test-task-service@starlight.test";

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
    const plans = await prisma.dayPlan.findMany({ where: { userId }, select: { id: true } });
    await prisma.plannedBlock.deleteMany({ where: { dayPlanId: { in: plans.map((p) => p.id) } } });
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

describe("getBacklog", () => {
    let userId: string;

    beforeEach(async () => {
        const user = await seedUser();
        userId = user.id;
        await cleanup(userId);
    });

    it("returns only tasks with no plannedBlockId", async () => {
        const plan = await prisma.dayPlan.create({
            data: {
                userId,
                date: "2026-01-15",
                wakeTime: "07:00",
                sleepTime: "23:00",
                status: "ACTIVE",
                blocks: {
                    create: {
                        type: "CONTAINER",
                        name: "Deep Work",
                        startTime: "09:00",
                        endTime: "12:00",
                    },
                },
            },
            include: { blocks: true },
        });
        const block = plan.blocks[0];

        await prisma.task.create({
            data: {
                userId,
                title: "Scheduled task",
                estimatedMins: 30,
                plannedBlockId: block.id,
                blockOrder: 1,
            },
        });
        await prisma.task.create({
            data: { userId, title: "Backlog task A", estimatedMins: 20 },
        });
        await prisma.task.create({
            data: { userId, title: "Backlog task B", estimatedMins: 45 },
        });

        const backlog = await getBacklog(userId);

        expect(backlog).toHaveLength(2);
        expect(backlog.map((t) => t.title)).toEqual(
            expect.arrayContaining(["Backlog task A", "Backlog task B"])
        );
        expect(backlog.map((t) => t.title)).not.toContain("Scheduled task");
    });

    it("returns all tasks when none are scheduled", async () => {
        await prisma.task.create({
            data: { userId, title: "Task 1", estimatedMins: 15 },
        });
        await prisma.task.create({
            data: { userId, title: "Task 2", estimatedMins: 30 },
        });

        const backlog = await getBacklog(userId);

        expect(backlog).toHaveLength(2);
    });

    it("returns an empty array when all tasks are scheduled", async () => {
        const plan = await prisma.dayPlan.create({
            data: {
                userId,
                date: "2026-01-15",
                wakeTime: "07:00",
                sleepTime: "23:00",
                status: "ACTIVE",
                blocks: {
                    create: { type: "CONTAINER", name: "Work", startTime: "09:00", endTime: "12:00" },
                },
            },
            include: { blocks: true },
        });
        const block = plan.blocks[0];

        await prisma.task.create({
            data: { userId, title: "Scheduled", estimatedMins: 30, plannedBlockId: block.id, blockOrder: 1 },
        });

        const backlog = await getBacklog(userId);
        expect(backlog).toHaveLength(0);
    });
});
