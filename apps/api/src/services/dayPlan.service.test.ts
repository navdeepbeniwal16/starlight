import { prisma } from "../lib/prisma";
import { getDayPlan } from "./dayPlan.service";

const TEST_EMAIL = "test-dayplan-service@starlight.test";

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
