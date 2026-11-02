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

// A whole-day 00:00–23:59 container so the shape survives elapsed-block
// filtering whatever the wall-clock time is when the test runs.
const validShape = () => ({
    wakeTime: "00:00",
    sleepTime: "23:59",
    blocks: [{ id: "shape-block-1", ...ALL_DAY_BLOCK }],
});

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

describe("day-plan routes", () => {
    it("POST /generate builds the proposal from the submitted shape, not the stored template", async () => {
        const template = await seedTemplate(userId, "My Day", "07:00");
        const shape = {
            wakeTime: "00:00",
            sleepTime: "23:59",
            blocks: [{ id: "edited-1", type: "CONTAINER", name: "Edited Focus", startTime: "00:00", endTime: "23:59", energyLevel: "HIGH" }],
        };

        const res = await request(app).post("/day-plan/generate").set(auth()).send({ templateId: template.id, shape });

        expect(res.status).toBe(200);
        expect(res.body.data.wakeTime).toBe("00:00");
        expect((res.body.data.blocks as Array<{ name: string }>).map(b => b.name)).toEqual(["Edited Focus"]);
    });

    it("POST /generate rejects a missing templateId with 400", async () => {
        const res = await request(app).post("/day-plan/generate").set(auth()).send({ shape: validShape() });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/templateId is required/);
    });

    it("POST /generate rejects a non-string templateId with 400", async () => {
        const res = await request(app).post("/day-plan/generate").set(auth()).send({ templateId: 123, shape: validShape() });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/templateId is required/);
    });

    it("POST /generate rejects a missing shape with 400", async () => {
        const template = await seedTemplate(userId, "My Day", "07:00");

        const res = await request(app).post("/day-plan/generate").set(auth()).send({ templateId: template.id });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/shape is required/);
    });

    it("POST /generate rejects a structurally invalid shape with 400", async () => {
        const template = await seedTemplate(userId, "My Day", "07:00");

        const res = await request(app).post("/day-plan/generate").set(auth()).send({ templateId: template.id, shape: { ...validShape(), wakeTime: "25:00" } });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/HH:mm/);
    });

    it("POST /generate rejects a templateId belonging to another user with 404", async () => {
        await seedTemplate(userId, "Mine", "07:00");
        const foreign = await seedTemplate(otherUserId, "Theirs", "08:00");

        const res = await request(app).post("/day-plan/generate").set(auth()).send({ templateId: foreign.id, shape: validShape() });

        expect(res.status).toBe(404);
    });

    it("POST /generate rejects a nonexistent templateId with 404", async () => {
        await seedTemplate(userId, "Mine", "07:00");

        const res = await request(app).post("/day-plan/generate").set(auth()).send({ templateId: "no-such-template", shape: validShape() });

        expect(res.status).toBe(404);
    });

    it("POST /confirm records templateId as provenance", async () => {
        const template = await seedTemplate(userId, "My Day", "07:00");

        const res = await request(app).post("/day-plan/confirm").set(auth()).send({ templateId: template.id, plan: validShape() });

        expect(res.status).toBe(200);
        const stored = await prisma.dayPlan.findFirst({ where: { userId, status: "ACTIVE" }, select: { dayTemplateId: true } });
        expect(stored?.dayTemplateId).toBe(template.id);
    });

    it("POST /confirm persists the submitted plan, not the stored template, and places tasks in order", async () => {
        const template = await seedTemplate(userId, "My Day", "07:00");
        const task = await prisma.task.create({ data: { userId, title: "Focus task", estimatedMins: 60, status: "TODO", progress: 0 } });
        const plan = {
            wakeTime: "00:00",
            sleepTime: "23:59",
            blocks: [{ id: "c1", type: "CONTAINER", name: "Focus", startTime: "00:00", endTime: "23:59", energyLevel: "HIGH", taskIds: [task.id] }],
        };

        const res = await request(app).post("/day-plan/confirm").set(auth()).send({ templateId: template.id, plan });

        expect(res.status).toBe(200);
        expect(res.body.data.wakeTime).toBe("00:00");
        const block = (res.body.data.blocks as Array<{ name: string; tasks: Array<{ id: string; blockOrder: number }> }>).find(b => b.name === "Focus")!;
        expect(block.tasks.map(t => t.id)).toEqual([task.id]);
        expect(block.tasks[0].blockOrder).toBe(0);
        const stored = await prisma.dayPlan.findFirst({ where: { userId, status: "ACTIVE" }, select: { dayTemplateId: true } });
        expect(stored?.dayTemplateId).toBe(template.id);
    });

    it("POST /confirm rejects a missing templateId with 400", async () => {
        const res = await request(app).post("/day-plan/confirm").set(auth()).send({ plan: validShape() });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/templateId is required/);
    });

    it("POST /confirm rejects a non-string templateId with 400", async () => {
        const res = await request(app).post("/day-plan/confirm").set(auth()).send({ templateId: 123, plan: validShape() });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/templateId is required/);
    });

    it("POST /confirm rejects a missing plan with 400", async () => {
        const template = await seedTemplate(userId, "My Day", "07:00");

        const res = await request(app).post("/day-plan/confirm").set(auth()).send({ templateId: template.id });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/plan is required/);
    });

    it("POST /confirm rejects taskIds on a non-container block with 400", async () => {
        const template = await seedTemplate(userId, "My Day", "07:00");
        const plan = {
            wakeTime: "00:00",
            sleepTime: "23:59",
            blocks: [
                { id: "c1", type: "CONTAINER", name: "Focus", startTime: "00:00", endTime: "12:00", energyLevel: "HIGH" },
                { id: "a1", type: "ANCHOR", name: "Break", startTime: "12:00", endTime: "13:00", taskIds: ["t1"] },
            ],
        };

        const res = await request(app).post("/day-plan/confirm").set(auth()).send({ templateId: template.id, plan });

        expect(res.status).toBe(400);
    });

    it("POST /confirm rejects a templateId belonging to another user with 404", async () => {
        await seedTemplate(userId, "Mine", "07:00");
        const foreign = await seedTemplate(otherUserId, "Theirs", "08:00");

        const res = await request(app).post("/day-plan/confirm").set(auth()).send({ templateId: foreign.id, plan: validShape() });

        expect(res.status).toBe(404);
        expect(await prisma.dayPlan.count({ where: { userId } })).toBe(0);
    });

    it("POST /confirm rejects a nonexistent templateId with 404", async () => {
        await seedTemplate(userId, "Mine", "07:00");

        const res = await request(app).post("/day-plan/confirm").set(auth()).send({ templateId: "no-such-template", plan: validShape() });

        expect(res.status).toBe(404);
    });

    it("deleting the source template nulls the plan's link but keeps its snapshotted blocks", async () => {
        const template = await seedTemplate(userId, "My Day", "07:00");
        await request(app).post("/day-plan/confirm").set(auth()).send({ templateId: template.id, plan: validShape() });

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
