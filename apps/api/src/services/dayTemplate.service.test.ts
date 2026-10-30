import { prisma } from "../lib/prisma";
import {
    listDayTemplates,
    getDayTemplateById,
    createDayTemplate,
    updateDayTemplate,
    deleteDayTemplate,
    DayTemplateNotFoundError,
    DuplicateTemplateNameError,
    CannotDeleteLastTemplateError,
} from "./dayTemplate.service";
import { DayTemplateValidationError } from "./dayTemplate.validator";
import { BlockInput } from "../types/dayTemplate.types";

const TEST_CLERK_ID = "user_test_day_template_service";
const OTHER_CLERK_ID = "user_test_day_template_service_other";

async function seedUser(clerkUserId: string) {
    return prisma.user.upsert({ where: { clerkUserId }, update: {}, create: { clerkUserId } });
}

async function cleanup(userId: string) {
    const plans = await prisma.dayPlan.findMany({ where: { userId }, select: { id: true } });
    for (const p of plans) await prisma.plannedBlock.deleteMany({ where: { dayPlanId: p.id } });
    await prisma.dayPlan.deleteMany({ where: { userId } });

    const templates = await prisma.dayTemplate.findMany({ where: { userId }, select: { id: true } });
    for (const t of templates) await prisma.block.deleteMany({ where: { dayTemplateId: t.id } });
    await prisma.dayTemplate.deleteMany({ where: { userId } });
}
function validTemplate(): { wakeTime: string; sleepTime: string; blocks: BlockInput[] } {
    return {
        wakeTime: "07:00",
        sleepTime: "23:00",
        blocks: [
            { type: "CONTAINER", name: "Deep Work", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" },
            { type: "ANCHOR", name: "Lunch", startTime: "12:00", endTime: "13:00" },
            { type: "ANCHOR", name: "Wind Down", startTime: "20:00", endTime: "22:00" },
        ],
    };
}

async function seedPlan(dayTemplateId: string, date: string, createdAt?: Date) {
    return prisma.dayPlan.create({
        data: {
            userId,
            dayTemplateId,
            date,
            status: "COMPLETED",
            wakeTime: "07:00",
            sleepTime: "23:00",
            ...(createdAt ? { createdAt } : {}),
        },
    });
}

let userId: string;
let otherUserId: string;

beforeAll(async () => {
    userId = (await seedUser(TEST_CLERK_ID)).id;
    otherUserId = (await seedUser(OTHER_CLERK_ID)).id;
});

beforeEach(async () => {
    await cleanup(userId);
    await cleanup(otherUserId);
});

afterAll(async () => {
    await cleanup(userId);
    await cleanup(otherUserId);
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
});

describe("listDayTemplates", () => {
    it("returns an empty array when the user has no templates", async () => {
        expect(await listDayTemplates(userId)).toEqual([]);
    });

    it("orders by most-recently-updated: editing a template moves it to the front", async () => {
        await createDayTemplate({ userId, name: "Workday", ...validTemplate() });
        const weekend = await createDayTemplate({ userId, name: "Weekend", ...validTemplate() });
        await createDayTemplate({ userId, name: "Chill", ...validTemplate() });

        expect((await listDayTemplates(userId)).map((t) => t.name)).toEqual(["Chill", "Weekend", "Workday"]);

        await updateDayTemplate({ userId, id: weekend.id, name: "Weekend", ...validTemplate() });

        expect((await listDayTemplates(userId)).map((t) => t.name)).toEqual(["Weekend", "Chill", "Workday"]);
    });

    it("nests each template's own blocks without leaking across templates", async () => {
        await createDayTemplate({
            userId,
            name: "Workday",
            wakeTime: "07:00",
            sleepTime: "23:00",
            blocks: [{ type: "CONTAINER", name: "Focus", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" }],
        });
        await createDayTemplate({
            userId,
            name: "Weekend",
            wakeTime: "08:00",
            sleepTime: "22:00",
            blocks: [
                { type: "CONTAINER", name: "Hobby", startTime: "10:00", endTime: "12:00", energyLevel: "MEDIUM" },
                { type: "ANCHOR", name: "Brunch", startTime: "12:00", endTime: "13:00" },
            ],
        });

        const list = await listDayTemplates(userId);
        const workday = list.find((t) => t.name === "Workday")!;
        const weekend = list.find((t) => t.name === "Weekend")!;

        expect(workday.blocks.map((b) => b.name)).toEqual(["Focus"]);
        expect(weekend.blocks.map((b) => b.name).sort()).toEqual(["Brunch", "Hobby"]);
        expect(workday.blocks.every((b) => b.dayTemplateId === workday.id)).toBe(true);
        expect(weekend.blocks.every((b) => b.dayTemplateId === weekend.id)).toBe(true);
    });

    it("excludes another user's templates", async () => {
        await createDayTemplate({ userId, name: "Mine", ...validTemplate() });
        await createDayTemplate({ userId: otherUserId, name: "Theirs", ...validTemplate() });

        const list = await listDayTemplates(userId);
        expect(list.map((t) => t.name)).toEqual(["Mine"]);
    });

    it("reports lastUsedOn as null for a template never used in a plan", async () => {
        await createDayTemplate({ userId, name: "Workday", ...validTemplate() });

        const [template] = await listDayTemplates(userId);
        expect(template.lastUsedOn).toBeNull();
    });

    it("reports lastUsedOn as the most recent plan date that recorded the template", async () => {
        const workday = await createDayTemplate({ userId, name: "Workday", ...validTemplate() });
        await seedPlan(workday.id, "2026-09-10");
        await seedPlan(workday.id, "2026-09-20");

        const [template] = await listDayTemplates(userId);
        expect(template.lastUsedOn).toBe("2026-09-20");
    });

    it("derives lastUsedOn by plan date, not by plan creation time", async () => {
        const workday = await createDayTemplate({ userId, name: "Workday", ...validTemplate() });
        // The later-dated plan was created first; createdAt must not win over date.
        await seedPlan(workday.id, "2026-09-20", new Date("2026-09-20T08:00:00Z"));
        await seedPlan(workday.id, "2026-09-01", new Date("2026-09-25T08:00:00Z"));

        const [template] = await listDayTemplates(userId);
        expect(template.lastUsedOn).toBe("2026-09-20");
    });

    it("reports lastUsedAt as the creation instant of the most recent plan", async () => {
        const workday = await createDayTemplate({ userId, name: "Workday", ...validTemplate() });
        const usedAt = new Date("2026-09-20T08:30:00.000Z");
        await seedPlan(workday.id, "2026-09-10", new Date("2026-09-10T08:00:00.000Z"));
        await seedPlan(workday.id, "2026-09-20", usedAt);

        const [template] = await listDayTemplates(userId);
        expect(template.lastUsedAt).toEqual(usedAt);
    });

    it("reports lastUsedAt as null for a template never used in a plan", async () => {
        await createDayTemplate({ userId, name: "Workday", ...validTemplate() });

        const [template] = await listDayTemplates(userId);
        expect(template.lastUsedAt).toBeNull();
    });

    it("derives lastUsedOn per template without bleeding across them", async () => {
        const used = await createDayTemplate({ userId, name: "Used", ...validTemplate() });
        const unused = await createDayTemplate({ userId, name: "Unused", ...validTemplate() });
        await seedPlan(used.id, "2026-09-15");

        const list = await listDayTemplates(userId);
        expect(list.find((t) => t.id === used.id)!.lastUsedOn).toBe("2026-09-15");
        expect(list.find((t) => t.id === unused.id)!.lastUsedOn).toBeNull();
    });
});

describe("getDayTemplateById", () => {
    it("returns the template with its blocks", async () => {
        const created = await createDayTemplate({ userId, name: "Workday", ...validTemplate() });

        const fetched = await getDayTemplateById(userId, created.id);
        expect(fetched).toMatchObject({ id: created.id, name: "Workday", wakeTime: "07:00", sleepTime: "23:00" });
        expect(fetched.blocks).toHaveLength(3);
    });

    it("throws NotFound for a missing id", async () => {
        await expect(getDayTemplateById(userId, "does-not-exist")).rejects.toBeInstanceOf(DayTemplateNotFoundError);
    });

    it("throws NotFound for another user's template (ownership isolation)", async () => {
        const foreign = await createDayTemplate({ userId: otherUserId, name: "Theirs", ...validTemplate() });
        await expect(getDayTemplateById(userId, foreign.id)).rejects.toBeInstanceOf(DayTemplateNotFoundError);
    });
});

describe("createDayTemplate", () => {
    it("persists the named template and all its blocks", async () => {
        const created = await createDayTemplate({ userId, name: "Workday", ...validTemplate() });

        expect(created).toMatchObject({ name: "Workday", wakeTime: "07:00", sleepTime: "23:00" });
        expect(created.blocks).toHaveLength(3);

        const byName = Object.fromEntries(created.blocks.map((b) => [b.name, b] as const));
        expect(byName["Deep Work"]).toMatchObject({ type: "CONTAINER", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" });
        expect(byName["Lunch"]).toMatchObject({ type: "ANCHOR", startTime: "12:00", endTime: "13:00", energyLevel: null });
        expect(byName["Wind Down"]).toMatchObject({ type: "ANCHOR", startTime: "20:00", endTime: "22:00", energyLevel: null });
    });

    it("trims the name and rejects blank / over-length names without persisting", async () => {
        const created = await createDayTemplate({ userId, name: "  Weekend  ", ...validTemplate() });
        expect(created.name).toBe("Weekend");

        await expect(createDayTemplate({ userId, name: "   ", ...validTemplate() })).rejects.toBeInstanceOf(DayTemplateValidationError);
        await expect(createDayTemplate({ userId, name: "x".repeat(51), ...validTemplate() })).rejects.toBeInstanceOf(DayTemplateValidationError);

        expect(await prisma.dayTemplate.count({ where: { userId } })).toBe(1);
    });

    it("routes through the structural validator and never persists an invalid template", async () => {
        const t = validTemplate();
        t.blocks[0] = { type: "CONTAINER", name: "Deep Work", startTime: "09:00", endTime: "12:00" };

        await expect(createDayTemplate({ userId, name: "Bad", ...t })).rejects.toBeInstanceOf(DayTemplateValidationError);
        expect(await prisma.dayTemplate.count({ where: { userId } })).toBe(0);
    });

    it("allows multiple templates per user but rejects a duplicate name (case-insensitive)", async () => {
        await createDayTemplate({ userId, name: "Workday", ...validTemplate() });
        await createDayTemplate({ userId, name: "Weekend", ...validTemplate() });
        expect(await prisma.dayTemplate.count({ where: { userId } })).toBe(2);

        await expect(createDayTemplate({ userId, name: "workday", ...validTemplate() })).rejects.toBeInstanceOf(DuplicateTemplateNameError);
        expect(await prisma.dayTemplate.count({ where: { userId } })).toBe(2);
    });
});

describe("updateDayTemplate", () => {
    it("renames, updates wake/sleep, and replaces blocks with fresh ids", async () => {
        const created = await createDayTemplate({ userId, name: "Workday", ...validTemplate() });
        const beforeIds = created.blocks.map((b) => b.id).sort();

        const updated = await updateDayTemplate({
            userId,
            id: created.id,
            name: "Focus Day",
            wakeTime: "06:30",
            sleepTime: "22:30",
            blocks: [{ type: "CONTAINER", name: "Sprint", startTime: "08:00", endTime: "11:00", energyLevel: "HIGH" }],
        });

        expect(updated).toMatchObject({ id: created.id, name: "Focus Day", wakeTime: "06:30", sleepTime: "22:30" });
        expect(updated.blocks).toHaveLength(1);
        expect(updated.blocks[0]).toMatchObject({ type: "CONTAINER", name: "Sprint", startTime: "08:00", endTime: "11:00", energyLevel: "HIGH" });
        const afterIds = updated.blocks.map((b) => b.id).sort();
        expect(afterIds.some((id) => beforeIds.includes(id))).toBe(false);
    });

    it("throws NotFound for an id that doesn't exist", async () => {
        await expect(updateDayTemplate({ userId, id: "does-not-exist", name: "Whatever", ...validTemplate() }))
            .rejects.toBeInstanceOf(DayTemplateNotFoundError);
    });

    it("throws NotFound for another user's template", async () => {
        const foreign = await createDayTemplate({ userId: otherUserId, name: "Theirs", ...validTemplate() });
        await expect(updateDayTemplate({ userId, id: foreign.id, name: "Hijack", ...validTemplate() }))
            .rejects.toBeInstanceOf(DayTemplateNotFoundError);
    });

    it("routes through the validator and leaves the template unchanged on an invalid payload", async () => {
        const created = await createDayTemplate({ userId, name: "Workday", ...validTemplate() });

        const invalid = validTemplate();
        invalid.blocks[0] = { type: "CONTAINER", name: "Deep Work", startTime: "09:00", endTime: "12:00" };

        await expect(updateDayTemplate({ userId, id: created.id, name: "Workday", ...invalid }))
            .rejects.toBeInstanceOf(DayTemplateValidationError);

        const after = await getDayTemplateById(userId, created.id);
        expect(after.blocks).toHaveLength(3);
        expect(after.blocks.map((b) => b.name).sort()).toEqual(["Deep Work", "Lunch", "Wind Down"]);
    });

    it("rejects renaming onto an existing name", async () => {
        await createDayTemplate({ userId, name: "Workday", ...validTemplate() });
        const weekend = await createDayTemplate({ userId, name: "Weekend", ...validTemplate() });

        await expect(updateDayTemplate({ userId, id: weekend.id, name: "Workday", ...validTemplate() }))
            .rejects.toBeInstanceOf(DuplicateTemplateNameError);
    });
});

describe("deleteDayTemplate", () => {
    it("removes the template and its blocks when it isn't the user's last", async () => {
        const workday = await createDayTemplate({ userId, name: "Workday", ...validTemplate() });
        await createDayTemplate({ userId, name: "Weekend", ...validTemplate() });

        await deleteDayTemplate(userId, workday.id);

        expect(await prisma.dayTemplate.findUnique({ where: { id: workday.id } })).toBeNull();
        expect(await prisma.block.count({ where: { dayTemplateId: workday.id } })).toBe(0);
        expect((await listDayTemplates(userId)).map((t) => t.name)).toEqual(["Weekend"]);
    });

    it("throws NotFound for a missing id", async () => {
        await expect(deleteDayTemplate(userId, "does-not-exist")).rejects.toBeInstanceOf(DayTemplateNotFoundError);
    });

    it("throws NotFound for another user's template (ownership isolation)", async () => {
        const foreign = await createDayTemplate({ userId: otherUserId, name: "Theirs", ...validTemplate() });
        await createDayTemplate({ userId: otherUserId, name: "Spare", ...validTemplate() });

        await expect(deleteDayTemplate(userId, foreign.id)).rejects.toBeInstanceOf(DayTemplateNotFoundError);
        expect(await prisma.dayTemplate.findUnique({ where: { id: foreign.id } })).not.toBeNull();
    });

    it("refuses to delete the user's only remaining template", async () => {
        const only = await createDayTemplate({ userId, name: "Workday", ...validTemplate() });

        await expect(deleteDayTemplate(userId, only.id)).rejects.toBeInstanceOf(CannotDeleteLastTemplateError);
        expect(await prisma.dayTemplate.findUnique({ where: { id: only.id } })).not.toBeNull();
    });
});
