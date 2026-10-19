import request from "supertest";
import type { Request, Response, NextFunction } from "express";

let mockUserId = "";
jest.mock("../middlewares/auth.middleware", () => ({
    authenticate: (req: Request, res: Response, next: NextFunction): void => {
        if (!req.headers.authorization) {
            res.status(401).json({ error: "Missing or invalid authorization token" });
            return;
        }
        req.user = { sub: mockUserId };
        res.locals["userId"] = mockUserId;
        next();
    },
}));

// Stub only the LLM call: /generate then exercises real template resolution and
// proposal assembly without reaching Anthropic. Everything else in the module
// (AgentError, remainingMinsOf, types) stays real.
jest.mock("../services/planAgent.service", () => {
    const actual = jest.requireActual("../services/planAgent.service");
    return {
        ...actual,
        generateSchedule: jest.fn(async () => ({ assignments: [], unschedulable: [] })),
    };
});

import app from "../app";
import { prisma } from "../lib/prisma";

const TEST_CLERK_ID = "user_test_dayplan_route";
const OTHER_CLERK_ID = "user_test_dayplan_route_other";

// A container block spanning the whole day, so it survives elapsed-block
// filtering whatever the wall-clock time is when the test runs.
const ALL_DAY_BLOCK = {
    type: "CONTAINER" as const,
    name: "All Day",
    startTime: "00:00",
    endTime: "23:59",
    energyLevel: "HIGH" as const,
};

async function seedUser(clerkUserId: string) {
    return prisma.user.upsert({ where: { clerkUserId }, update: {}, create: { clerkUserId } });
}

async function seedTemplate(userId: string, name: string, wakeTime: string) {
    return prisma.dayTemplate.create({
        data: { userId, name, wakeTime, sleepTime: "23:59", blocks: { create: [ALL_DAY_BLOCK] } },
        include: { blocks: true },
    });
}

async function cleanup(userId: string) {
    await prisma.task.deleteMany({ where: { userId } });
    const plans = await prisma.dayPlan.findMany({ where: { userId }, select: { id: true } });
    await prisma.plannedBlock.deleteMany({ where: { dayPlanId: { in: plans.map(p => p.id) } } });
    await prisma.dayPlan.deleteMany({ where: { userId } });
    const templates = await prisma.dayTemplate.findMany({ where: { userId }, select: { id: true } });
    for (const t of templates) await prisma.block.deleteMany({ where: { dayTemplateId: t.id } });
    await prisma.dayTemplate.deleteMany({ where: { userId } });
}

let userId: string;
let otherUserId: string;

beforeAll(async () => {
    userId = (await seedUser(TEST_CLERK_ID)).id;
    otherUserId = (await seedUser(OTHER_CLERK_ID)).id;
    mockUserId = userId;
});

beforeEach(async () => {
    await cleanup(userId);
    await cleanup(otherUserId);
    mockUserId = userId;
});

afterAll(async () => {
    await cleanup(userId);
    await cleanup(otherUserId);
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
});

const auth = () => ({ Authorization: "Bearer test-token" });

describe("day-plan routes: multi-template resolution", () => {
    it("POST /generate builds the proposal from the last-used template, not the most-recently-updated one", async () => {
        const lastUsed = await seedTemplate(userId, "Weekend", "09:00");
        const recentlyEdited = await seedTemplate(userId, "Workday", "06:00");
        await prisma.dayTemplate.update({ where: { id: recentlyEdited.id }, data: { wakeTime: "06:00" } });
        await prisma.dayPlan.create({
            data: { userId, date: "2026-09-01", status: "COMPLETED", wakeTime: "09:00", sleepTime: "23:59", dayTemplateId: lastUsed.id },
        });

        const res = await request(app).post("/day-plan/generate").set(auth());

        expect(res.status).toBe(200);
        expect(res.body.data.wakeTime).toBe("09:00"); // Weekend (last used), not Workday's 06:00
    });

    it("POST /generate resolves last-used by plan date, not by plan creation time", async () => {
        // The plan dates and createdAt timestamps are inverted on purpose: the
        // later-dated plan was created first, the earlier-dated plan created later.
        const newerDated = await seedTemplate(userId, "Weekend", "09:00");
        const backdated = await seedTemplate(userId, "Workday", "06:00");
        await prisma.dayPlan.create({
            data: { userId, date: "2026-09-10", status: "COMPLETED", wakeTime: "09:00", sleepTime: "23:59", dayTemplateId: newerDated.id, createdAt: new Date("2026-09-10T08:00:00Z") },
        });
        await prisma.dayPlan.create({
            data: { userId, date: "2026-09-01", status: "COMPLETED", wakeTime: "06:00", sleepTime: "23:59", dayTemplateId: backdated.id, createdAt: new Date("2026-09-15T08:00:00Z") },
        });

        const res = await request(app).post("/day-plan/generate").set(auth());

        expect(res.status).toBe(200);
        expect(res.body.data.wakeTime).toBe("09:00"); // Weekend (later-dated plan), though it was created earlier
    });

    it("POST /generate falls back to the most-recently-updated template when no plan carries one", async () => {
        await seedTemplate(userId, "Weekend", "09:00");
        const workday = await seedTemplate(userId, "Workday", "06:00");
        await prisma.dayTemplate.update({ where: { id: workday.id }, data: { wakeTime: "06:00" } });

        const res = await request(app).post("/day-plan/generate").set(auth());

        expect(res.status).toBe(200);
        expect(res.body.data.wakeTime).toBe("06:00"); // Workday (most recently updated)
    });

    it("POST /generate builds from an explicitly chosen owned template, overriding last-used", async () => {
        const weekend = await seedTemplate(userId, "Weekend", "09:00");
        const workday = await seedTemplate(userId, "Workday", "06:00");
        await prisma.dayPlan.create({
            data: { userId, date: "2026-09-01", status: "COMPLETED", wakeTime: "09:00", sleepTime: "23:59", dayTemplateId: weekend.id },
        });

        const res = await request(app).post("/day-plan/generate").set(auth()).send({ templateId: workday.id });

        expect(res.status).toBe(200);
        expect(res.body.data.wakeTime).toBe("06:00");
    });

    it("POST /generate rejects a templateId belonging to another user with 404", async () => {
        await seedTemplate(userId, "Mine", "07:00");
        const foreign = await seedTemplate(otherUserId, "Theirs", "08:00");

        const res = await request(app).post("/day-plan/generate").set(auth()).send({ templateId: foreign.id });

        expect(res.status).toBe(404);
    });

    it("POST /generate rejects a nonexistent templateId with 404", async () => {
        await seedTemplate(userId, "Mine", "07:00");

        const res = await request(app).post("/day-plan/generate").set(auth()).send({ templateId: "no-such-template" });

        expect(res.status).toBe(404);
    });

    it("POST /generate returns NO_TEMPLATE when the user has no template", async () => {
        const res = await request(app).post("/day-plan/generate").set(auth());

        expect(res.status).toBe(400);
        expect(res.body.code).toBe("NO_TEMPLATE");
    });

    it("POST /confirm stores the id of the template the plan was built from", async () => {
        const template = await seedTemplate(userId, "My Day", "07:00");

        const res = await request(app).post("/day-plan/confirm").set(auth()).send({ assignments: [] });

        expect(res.status).toBe(200);
        const stored = await prisma.dayPlan.findFirst({ where: { userId, status: "ACTIVE" }, select: { dayTemplateId: true } });
        expect(stored?.dayTemplateId).toBe(template.id);
    });

    it("POST /confirm stores the last-used template id when the user has several", async () => {
        const lastUsed = await seedTemplate(userId, "Weekend", "09:00");
        const other = await seedTemplate(userId, "Workday", "06:00");
        await prisma.dayTemplate.update({ where: { id: other.id }, data: { wakeTime: "06:00" } });
        await prisma.dayPlan.create({
            data: { userId, date: "2026-09-01", status: "COMPLETED", wakeTime: "09:00", sleepTime: "23:59", dayTemplateId: lastUsed.id },
        });

        const res = await request(app).post("/day-plan/confirm").set(auth()).send({ assignments: [] });

        expect(res.status).toBe(200);
        const stored = await prisma.dayPlan.findFirst({ where: { userId, status: "ACTIVE" }, select: { dayTemplateId: true } });
        expect(stored?.dayTemplateId).toBe(lastUsed.id);
    });

    it("POST /confirm records the client-sent templateId, not a re-resolved one", async () => {
        const lastUsed = await seedTemplate(userId, "Weekend", "09:00");
        const chosen = await seedTemplate(userId, "Workday", "06:00");
        await prisma.dayPlan.create({
            data: { userId, date: "2026-09-01", status: "COMPLETED", wakeTime: "09:00", sleepTime: "23:59", dayTemplateId: lastUsed.id },
        });

        const res = await request(app).post("/day-plan/confirm").set(auth()).send({ assignments: [], templateId: chosen.id });

        expect(res.status).toBe(200);
        expect(res.body.data.wakeTime).toBe("06:00"); // built from Workday (chosen), not Weekend (last used)
        const stored = await prisma.dayPlan.findFirst({ where: { userId, status: "ACTIVE" }, select: { dayTemplateId: true } });
        expect(stored?.dayTemplateId).toBe(chosen.id);
    });

    it("POST /confirm rejects a templateId belonging to another user with 404", async () => {
        await seedTemplate(userId, "Mine", "07:00");
        const foreign = await seedTemplate(otherUserId, "Theirs", "08:00");

        const res = await request(app).post("/day-plan/confirm").set(auth()).send({ assignments: [], templateId: foreign.id });

        expect(res.status).toBe(404);
        expect(await prisma.dayPlan.count({ where: { userId } })).toBe(0);
    });

    it("POST /confirm rejects a nonexistent templateId with 404", async () => {
        await seedTemplate(userId, "Mine", "07:00");

        const res = await request(app).post("/day-plan/confirm").set(auth()).send({ assignments: [], templateId: "no-such-template" });

        expect(res.status).toBe(404);
    });

    it("deleting the source template nulls the plan's link but keeps its snapshotted blocks", async () => {
        const template = await seedTemplate(userId, "My Day", "07:00");
        await request(app).post("/day-plan/confirm").set(auth()).send({ assignments: [] });

        const before = await prisma.dayPlan.findFirst({
            where: { userId, status: "ACTIVE" },
            select: { id: true, dayTemplateId: true, blocks: { select: { id: true } } },
        });
        expect(before?.dayTemplateId).toBe(template.id);
        expect(before!.blocks.length).toBeGreaterThan(0);

        // No delete endpoint yet (STA-28); exercise the FK behaviour directly.
        await prisma.block.deleteMany({ where: { dayTemplateId: template.id } });
        await prisma.dayTemplate.delete({ where: { id: template.id } });

        const after = await prisma.dayPlan.findFirst({
            where: { id: before!.id },
            select: { dayTemplateId: true, blocks: { select: { id: true } } },
        });
        expect(after?.dayTemplateId).toBeNull(); // link nulled, not cascaded
        expect(after?.blocks.length).toBe(before!.blocks.length);
    });

    it("rejects an unauthenticated request", async () => {
        const res = await request(app).post("/day-plan/generate");

        expect(res.status).toBe(401);
    });
});
