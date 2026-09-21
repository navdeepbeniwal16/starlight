import request from "supertest";
import type { Request, Response, NextFunction } from "express";
import app from "../app";
import { prisma } from "../lib/prisma";

const TEST_CLERK_ID = "user_test_project_route";
const OTHER_CLERK_ID = "user_test_project_route_other";

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

async function seedUser(clerkUserId: string) {
    return prisma.user.upsert({
        where: { clerkUserId },
        update: {},
        create: { clerkUserId },
    });
}

describe("project routes", () => {
    let userId: string;
    let otherUserId: string;

    beforeAll(async () => {
        userId = (await seedUser(TEST_CLERK_ID)).id;
        otherUserId = (await seedUser(OTHER_CLERK_ID)).id;
        mockUserId = userId;
    });

    afterEach(async () => {
        await prisma.task.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
        await prisma.project.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    });

    afterAll(async () => {
        await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
        await prisma.$disconnect();
    });

    const auth = () => ({ Authorization: "Bearer test-token" });

    it("rejects an unauthenticated request", async () => {
        const res = await request(app).get("/projects");
        expect(res.status).toBe(401);
    });

    it("POST /projects creates a project", async () => {
        const res = await request(app).post("/projects").set(auth()).send({ name: "Work", goal: "Ship it" });

        expect(res.status).toBe(201);
        expect(res.body.data).toEqual(
            expect.objectContaining({ name: "Work", goal: "Ship it", isInFocus: false }),
        );
    });

    it("POST /projects persists notes", async () => {
        const res = await request(app).post("/projects").set(auth()).send({ name: "Work", notes: "watch the vendor SLA" });

        expect(res.status).toBe(201);
        expect(res.body.data).toEqual(expect.objectContaining({ name: "Work", notes: "watch the vendor SLA" }));
    });

    it("POST /projects rejects an empty name with 400", async () => {
        const res = await request(app).post("/projects").set(auth()).send({ name: "   " });
        expect(res.status).toBe(400);
    });

    it("POST /projects rejects a duplicate name (case-insensitive) with 409", async () => {
        await request(app).post("/projects").set(auth()).send({ name: "Work" }).expect(201);

        const res = await request(app).post("/projects").set(auth()).send({ name: "work" });
        expect(res.status).toBe(409);
    });

    it("GET /projects lists only the caller's projects", async () => {
        await prisma.project.create({ data: { userId, name: "Mine" } });
        await prisma.project.create({ data: { userId: otherUserId, name: "Theirs" } });

        const res = await request(app).get("/projects").set(auth());

        expect(res.status).toBe(200);
        const names = res.body.data.map((p: { name: string }) => p.name);
        expect(names).toEqual(["Mine"]);
    });

    it("GET /projects/:id returns 404 for another user's project", async () => {
        const theirs = await prisma.project.create({ data: { userId: otherUserId, name: "Theirs" } });

        const res = await request(app).get(`/projects/${theirs.id}`).set(auth());
        expect(res.status).toBe(404);
    });

    it("PATCH /projects/:id updates name and goal", async () => {
        const project = await prisma.project.create({ data: { userId, name: "Old", goal: "old goal" } });

        const res = await request(app).patch(`/projects/${project.id}`).set(auth()).send({ name: "New", goal: null });

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual(expect.objectContaining({ name: "New", goal: null }));
    });

    it("PATCH /projects/:id updates notes, then clears them with null", async () => {
        const project = await prisma.project.create({ data: { userId, name: "P", notes: "old context" } });

        const updated = await request(app).patch(`/projects/${project.id}`).set(auth()).send({ notes: "new context" });
        expect(updated.status).toBe(200);
        expect(updated.body.data.notes).toBe("new context");

        const cleared = await request(app).patch(`/projects/${project.id}`).set(auth()).send({ notes: null });
        expect(cleared.status).toBe(200);
        expect(cleared.body.data.notes).toBeNull();
    });

    it("PATCH /projects/:id returns 404 for another user's project", async () => {
        const theirs = await prisma.project.create({ data: { userId: otherUserId, name: "Theirs" } });

        const res = await request(app).patch(`/projects/${theirs.id}`).set(auth()).send({ name: "Hijacked" });
        expect(res.status).toBe(404);
    });

    it("DELETE /projects/:id removes the project, then 404 on re-fetch", async () => {
        const project = await prisma.project.create({ data: { userId, name: "Temp" } });

        await request(app).delete(`/projects/${project.id}`).set(auth()).expect(204);
        await request(app).get(`/projects/${project.id}`).set(auth()).expect(404);
    });

    it("PATCH /projects/:id/focus rejects a non-boolean with 400", async () => {
        const project = await prisma.project.create({ data: { userId, name: "P" } });

        const res = await request(app).patch(`/projects/${project.id}/focus`).set(auth()).send({ inFocus: "yes" });
        expect(res.status).toBe(400);
    });

    it("PATCH /projects/:id/focus toggles focus on", async () => {
        const project = await prisma.project.create({ data: { userId, name: "P" } });

        const res = await request(app).patch(`/projects/${project.id}/focus`).set(auth()).send({ inFocus: true });

        expect(res.status).toBe(200);
        expect(res.body.data.isInFocus).toBe(true);
    });

    // Safety invariant: the cap is never breached, asserted on committed DB state, not the
    // response mix. Exactly-3 is deliberately not asserted — under contention a loser can
    // exhaust setInFocus's retry budget and 500, so fewer than 3 may commit. Stripping
    // setInFocus's isolationLevel lets all five commit (count of 5), which fails this.
    it("PATCH /projects/:id/focus never lets more than 3 win the race", async () => {
        const projects = await Promise.all(
            [1, 2, 3, 4, 5].map(n => prisma.project.create({ data: { userId, name: `Race ${n}` } })),
        );

        const results = await Promise.all(
            projects.map(p =>
                request(app).patch(`/projects/${p.id}/focus`).set(auth()).send({ inFocus: true }),
            ),
        );

        const inFocus = await prisma.project.count({ where: { userId, isInFocus: true } });
        expect(inFocus).toBeLessThanOrEqual(3);

        const okCount = results.filter(r => r.status === 200).length;
        expect(okCount).toBe(inFocus);
    });

    // onDelete: SetNull is a schema promise, not service code — this guards the migration.
    it("DELETE /projects/:id detaches its tasks instead of deleting them", async () => {
        const project = await prisma.project.create({ data: { userId, name: "Parent" } });
        const task = await prisma.task.create({
            data: { userId, title: "Child", estimatedMins: 30, projectId: project.id },
        });

        await request(app).delete(`/projects/${project.id}`).set(auth()).expect(204);

        const after = await prisma.task.findUnique({ where: { id: task.id } });
        expect(after).not.toBeNull();
        expect(after?.projectId).toBeNull();
    });
});
