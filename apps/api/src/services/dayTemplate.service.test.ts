import { prisma } from "../lib/prisma";
import {
    createDayTemplate,
    getDayTemplate,
    DayTemplateAlreadyExistsError,
    DayTemplateNotFoundError,
} from "./dayTemplate.service";
import { DayTemplateValidationError } from "./dayTemplate.validator";
import { BlockInput } from "../types/dayTemplate.types";

const TEST_EMAIL = "test-day-template-service@starlight.test";

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
    const template = await prisma.dayTemplate.findUnique({ where: { userId }, select: { id: true } });
    if (template) {
        await prisma.block.deleteMany({ where: { dayTemplateId: template.id } });
        await prisma.dayTemplate.delete({ where: { id: template.id } });
    }
}

// A valid baseline template; individual tests clone and mutate it to isolate one broken invariant.
function validTemplate(): { wakeTime: string; sleepTime: string; blocks: BlockInput[] } {
    return {
        wakeTime: "07:00",
        sleepTime: "23:00",
        blocks: [
            { type: "CONTAINER", name: "Deep Work", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" },
            { type: "ANCHOR", name: "Lunch", startTime: "12:00", endTime: "13:00" },
            { type: "NO_TASK", name: "Wind Down", startTime: "20:00", endTime: "22:00" },
        ],
    };
}

// Seeds a valid template
async function seedTemplate(userId: string) {
    const t = validTemplate();
    await prisma.dayTemplate.create({
        data: {
            userId,
            wakeTime: t.wakeTime,
            sleepTime: t.sleepTime,
            blocks: { create: t.blocks },
        },
    });
}

let userId: string;

beforeEach(async () => {
    const user = await seedUser(TEST_EMAIL);
    userId = user.id;
    await cleanup(userId);
});

afterAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
    if (user) {
        await cleanup(user.id);
        await prisma.user.delete({ where: { id: user.id } });
    }
    await prisma.$disconnect();
});

describe("createDayTemplate", () => {
    it("persists the template and all its blocks", async () => {
        const t = validTemplate();
        await createDayTemplate({ userId, ...t });

        const stored = await prisma.dayTemplate.findUnique({ where: { userId }, include: { blocks: true } });
        expect(stored?.wakeTime).toBe("07:00");
        expect(stored?.sleepTime).toBe("23:00");
        expect(stored?.blocks).toHaveLength(3);
        expect(stored?.blocks.map((b) => b.name).sort()).toEqual(["Deep Work", "Lunch", "Wind Down"]);
    });

    it("routes through the validator and never persists an invalid template", async () => {
        const t = validTemplate();
        t.blocks[0] = { type: "CONTAINER", name: "Deep Work", startTime: "09:00", endTime: "12:00" }; // no energyLevel

        await expect(createDayTemplate({ userId, ...t })).rejects.toBeInstanceOf(DayTemplateValidationError);

        const stored = await prisma.dayTemplate.findUnique({ where: { userId } });
        expect(stored).toBeNull();
    });

    it("rejects a second template for the same user", async () => {
        await createDayTemplate({ userId, ...validTemplate() });
        await expect(createDayTemplate({ userId, ...validTemplate() })).rejects.toBeInstanceOf(
            DayTemplateAlreadyExistsError
        );
    });
});

describe("getDayTemplate", () => {
    it("returns the stored template with its blocks", async () => {
        await seedTemplate(userId);

        const template = await getDayTemplate(userId);

        expect(template.wakeTime).toBe("07:00");
        expect(template.sleepTime).toBe("23:00");
        expect(template.blocks).toHaveLength(3);
        expect(template.blocks.map((b) => b.name).sort()).toEqual(["Deep Work", "Lunch", "Wind Down"]);
    });

    it("throws DayTemplateNotFoundError when the user has no template", async () => {
        await expect(getDayTemplate(userId)).rejects.toBeInstanceOf(DayTemplateNotFoundError);
    });
});
