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

import app from "../app";
import { prisma } from "../lib/prisma";

const TEST_CLERK_ID = "user_test_daytemplates_route";
const OTHER_CLERK_ID = "user_test_daytemplates_route_other";

const validBody = (name: string) => ({
    name,
    wakeTime: "07:00",
    sleepTime: "23:00",
    blocks: [
        { type: "CONTAINER", name: "Deep Work", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" },
        { type: "ANCHOR", name: "Lunch", startTime: "12:00", endTime: "13:00" },
    ],
});

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

describe("day-templates routes", () => {
    it("POST creates a template and GET lists it", async () => {
        const create = await request(app).post("/day-templates").set(auth()).send(validBody("Workday"));
        expect(create.status).toBe(201);
        expect(create.body.data).toMatchObject({ name: "Workday", wakeTime: "07:00" });
        expect(create.body.data.blocks.length).toBe(2);

        const list = await request(app).get("/day-templates").set(auth());
        expect(list.status).toBe(200);
        expect(list.body.data.map((t: { name: string }) => t.name)).toEqual(["Workday"]);
    });

    it("GET list exposes lastUsedOn per template: the latest plan date, else null", async () => {
        const used = await request(app).post("/day-templates").set(auth()).send(validBody("Workday"));
        const unused = await request(app).post("/day-templates").set(auth()).send(validBody("Weekend"));
        await prisma.dayPlan.create({
            data: { userId, dayTemplateId: used.body.data.id, date: "2026-09-15", status: "COMPLETED", wakeTime: "07:00", sleepTime: "23:00" },
        });

        const list = await request(app).get("/day-templates").set(auth());
        expect(list.status).toBe(200);
        const byId = Object.fromEntries(
            list.body.data.map((t: { id: string; lastUsedOn: string | null; lastUsedAt: string | null }) => [t.id, t]),
        );
        expect(byId[used.body.data.id].lastUsedOn).toBe("2026-09-15");
        // lastUsedAt crosses the wire as a serialized ISO timestamp, not a Date.
        expect(byId[used.body.data.id].lastUsedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(byId[unused.body.data.id].lastUsedOn).toBeNull();
        expect(byId[unused.body.data.id].lastUsedAt).toBeNull();
    });

    it("GET list attributes lastUsedOn to the base template after an adjusted-and-confirmed day", async () => {
        const base = await request(app).post("/day-templates").set(auth()).send(validBody("Workday"));
        const unused = await request(app).post("/day-templates").set(auth()).send(validBody("Weekend"));

        // Confirm a plan whose shape diverges from the stored template (today's edits),
        // tagged with the base template as provenance. lastUsedOn must still key off
        // the base template, not the adjusted shape.
        const adjustedPlan = {
            wakeTime: "00:00",
            sleepTime: "23:59",
            blocks: [{ id: "c1", type: "CONTAINER", name: "Adjusted Focus", startTime: "00:00", endTime: "23:59", energyLevel: "HIGH" }],
        };
        const confirmed = await request(app).post("/day-plan/confirm").set(auth()).send({ templateId: base.body.data.id, plan: adjustedPlan });
        expect(confirmed.status).toBe(200);

        const list = await request(app).get("/day-templates").set(auth());
        expect(list.status).toBe(200);
        const byId = Object.fromEntries(
            list.body.data.map((t: { id: string; lastUsedOn: string | null }) => [t.id, t.lastUsedOn]),
        );
        expect(byId[base.body.data.id]).toBe(confirmed.body.data.date); // base template, despite the adjusted shape
        expect(byId[unused.body.data.id]).toBeNull();
    });

    it("GET returns a template by id and rejects an unknown id with 404", async () => {
        const created = await request(app).post("/day-templates").set(auth()).send(validBody("Workday"));
        const id = created.body.data.id;

        const found = await request(app).get(`/day-templates/${id}`).set(auth());
        expect(found.status).toBe(200);
        expect(found.body.data.id).toBe(id);

        const missing = await request(app).get("/day-templates/nope").set(auth());
        expect(missing.status).toBe(404);
    });

    it("POST rejects invalid field values with 400 without persisting", async () => {
        const res = await request(app).post("/day-templates").set(auth()).send(validBody("   "));
        expect(res.status).toBe(400);
        expect(await prisma.dayTemplate.count({ where: { userId } })).toBe(0);
    });

    it("POST rejects a malformed body with 400 without persisting", async () => {
        const { blocks: _blocks, ...noBlocks } = validBody("Workday");
        const res = await request(app).post("/day-templates").set(auth()).send(noBlocks);
        expect(res.status).toBe(400);
        expect(await prisma.dayTemplate.count({ where: { userId } })).toBe(0);
    });

    it("POST rejects a duplicate name with 409 (case-insensitive)", async () => {
        await request(app).post("/day-templates").set(auth()).send(validBody("Workday"));

        const dup = await request(app).post("/day-templates").set(auth()).send(validBody("workday"));
        expect(dup.status).toBe(409);
        expect(await prisma.dayTemplate.count({ where: { userId } })).toBe(1);
    });

    it("PATCH updates and renames a template", async () => {
        const created = await request(app).post("/day-templates").set(auth()).send(validBody("Workday"));
        const id = created.body.data.id;

        const patched = await request(app)
            .patch(`/day-templates/${id}`)
            .set(auth())
            .send({ ...validBody("Focus Day"), wakeTime: "06:30" });

        expect(patched.status).toBe(200);
        expect(patched.body.data).toMatchObject({ id, name: "Focus Day", wakeTime: "06:30" });
    });

    it("PATCH rejects invalid field values with 400", async () => {
        const created = await request(app).post("/day-templates").set(auth()).send(validBody("Workday"));

        const res = await request(app)
            .patch(`/day-templates/${created.body.data.id}`)
            .set(auth())
            .send(validBody("   "));
        expect(res.status).toBe(400);
    });

    it("PATCH rejects a duplicate name with 409", async () => {
        await request(app).post("/day-templates").set(auth()).send(validBody("Workday"));
        const weekend = await request(app).post("/day-templates").set(auth()).send(validBody("Weekend"));

        const conflict = await request(app)
            .patch(`/day-templates/${weekend.body.data.id}`)
            .set(auth())
            .send(validBody("Workday"));
        expect(conflict.status).toBe(409);
    });

    async function seedForeignTemplate(name: string) {
        mockUserId = otherUserId;
        const foreign = await request(app).post("/day-templates").set(auth()).send(validBody(name));
        mockUserId = userId;
        return foreign.body.data.id as string;
    }

    it("GET list returns only the acting user's templates, not another user's", async () => {
        await seedForeignTemplate("Theirs");
        await request(app).post("/day-templates").set(auth()).send(validBody("Mine"));

        const list = await request(app).get("/day-templates").set(auth());
        expect(list.status).toBe(200);
        expect(list.body.data.map((t: { name: string }) => t.name)).toEqual(["Mine"]);
    });

    it("GET rejects reading another user's template with 404", async () => {
        const foreignId = await seedForeignTemplate("Theirs");

        const read = await request(app).get(`/day-templates/${foreignId}`).set(auth());
        expect(read.status).toBe(404);
    });

    it("PATCH rejects updating another user's template with 404", async () => {
        const foreignId = await seedForeignTemplate("Theirs");

        const write = await request(app).patch(`/day-templates/${foreignId}`).set(auth()).send(validBody("Hijacked"));
        expect(write.status).toBe(404);

        const untouched = await prisma.dayTemplate.findUnique({ where: { id: foreignId } });
        expect(untouched?.name).toBe("Theirs");
    });

    it("GET rejects an unauthenticated request with 401", async () => {
        const res = await request(app).get("/day-templates");
        expect(res.status).toBe(401);
    });

    it("DELETE removes a template (and its blocks) and drops it from the list", async () => {
        await request(app).post("/day-templates").set(auth()).send(validBody("Workday"));
        const weekend = await request(app).post("/day-templates").set(auth()).send(validBody("Weekend"));
        const id = weekend.body.data.id;

        const del = await request(app).delete(`/day-templates/${id}`).set(auth());
        expect(del.status).toBe(204);

        expect(await prisma.dayTemplate.findUnique({ where: { id } })).toBeNull();
        expect(await prisma.block.count({ where: { dayTemplateId: id } })).toBe(0);

        const list = await request(app).get("/day-templates").set(auth());
        expect(list.body.data.map((t: { name: string }) => t.name)).toEqual(["Workday"]);
    });

    it("DELETE rejects removing the user's only template with 409 and leaves it intact", async () => {
        const only = await request(app).post("/day-templates").set(auth()).send(validBody("Workday"));
        const id = only.body.data.id;

        const del = await request(app).delete(`/day-templates/${id}`).set(auth());
        expect(del.status).toBe(409);
        expect(del.body.error).toBeTruthy();

        expect(await prisma.dayTemplate.findUnique({ where: { id } })).not.toBeNull();
    });

    it("DELETE is idempotent for an unknown id: 204 and no-op", async () => {
        const del = await request(app).delete("/day-templates/nope").set(auth());
        expect(del.status).toBe(204);
    });

    it("DELETE on another user's template is a 204 no-op that leaves it intact", async () => {
        const foreignId = await seedForeignTemplate("Theirs");

        const del = await request(app).delete(`/day-templates/${foreignId}`).set(auth());
        expect(del.status).toBe(204);
        expect(await prisma.dayTemplate.findUnique({ where: { id: foreignId } })).not.toBeNull();
    });

    it("DELETE nulls a past plan's template link while leaving the plan and its blocks intact", async () => {
        await request(app).post("/day-templates").set(auth()).send(validBody("Workday"));
        const weekend = await request(app).post("/day-templates").set(auth()).send(validBody("Weekend"));
        const templateId = weekend.body.data.id;

        const plan = await prisma.dayPlan.create({
            data: {
                userId,
                dayTemplateId: templateId,
                date: "2026-01-01",
                wakeTime: "07:00",
                sleepTime: "23:00",
                blocks: {
                    create: [{ type: "CONTAINER", name: "Deep Work", startTime: "09:00", endTime: "12:00", energyLevel: "HIGH" }],
                },
            },
        });

        const del = await request(app).delete(`/day-templates/${templateId}`).set(auth());
        expect(del.status).toBe(204);

        const after = await prisma.dayPlan.findUnique({ where: { id: plan.id }, include: { blocks: true } });
        expect(after).not.toBeNull();
        expect(after!.dayTemplateId).toBeNull();
        expect(after!.blocks.map((b) => b.name)).toEqual(["Deep Work"]);
    });
});
