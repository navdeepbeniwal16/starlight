import request from "supertest";
import type { Request, Response, NextFunction } from "express";
import app from "../app";
import { prisma } from "../lib/prisma";

const TEST_CLERK_ID = "user_test_task_route";
const OTHER_CLERK_ID = "user_test_task_route_other";

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

describe("task routes", () => {
    let userId: string;
    let otherUserId: string;
    let taskId: string;
    let ownedProjectId: string;
    let foreignProjectId: string;

    beforeAll(async () => {
        userId = (await seedUser(TEST_CLERK_ID)).id;
        otherUserId = (await seedUser(OTHER_CLERK_ID)).id;
        mockUserId = userId;

        await prisma.task.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
        await prisma.project.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });

        taskId = (await prisma.task.create({ data: { userId, title: "Route task", estimatedMins: 30 } })).id;
        ownedProjectId = (await prisma.project.create({ data: { userId, name: "Owned" } })).id;
        foreignProjectId = (await prisma.project.create({ data: { userId: otherUserId, name: "Foreign" } })).id;
    });

    afterAll(async () => {
        await prisma.task.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
        await prisma.project.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
        await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
        await prisma.$disconnect();
    });

    const auth = () => ({ Authorization: "Bearer test-token" });

    it("GET /tasks returns a paginated page", async () => {
        const res = await request(app).get("/tasks").set(auth());

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data.items)).toBe(true);
        expect(res.body.data).toHaveProperty("nextCursor");
        expect(res.body.data.items.some((t: { id: string }) => t.id === taskId)).toBe(true);
    });

    // Guards the "/backlog before /:id" ordering: if /:id captured "backlog", this
    // would 404 (no task with id "backlog") instead of returning the bucket shape.
    it("GET /tasks/backlog returns the four backlog buckets", async () => {
        const res = await request(app).get("/tasks/backlog").set(auth());

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual(
            expect.objectContaining({
                carriedOver: expect.any(Array),
                scheduled: expect.any(Array),
                remaining: expect.any(Array),
                doneToday: expect.any(Array),
            }),
        );
    });

    it("GET /tasks/:id returns a single task", async () => {
        const res = await request(app).get(`/tasks/${taskId}`).set(auth());

        expect(res.status).toBe(200);
        expect(res.body.data.id).toBe(taskId);
    });

    it("rejects an unauthenticated request", async () => {
        const res = await request(app).get("/tasks");

        expect(res.status).toBe(401);
    });

    describe("projectId assignment", () => {
        it("POST /tasks attaches an owned projectId", async () => {
            const res = await request(app)
                .post("/tasks")
                .set(auth())
                .send({ title: "With project", estimatedMins: 15, projectId: ownedProjectId });

            expect(res.status).toBe(201);
            const created = await prisma.task.findUnique({ where: { id: res.body.data.id } });
            expect(created?.projectId).toBe(ownedProjectId);
        });

        it("POST /tasks with another user's projectId returns 404", async () => {
            const res = await request(app)
                .post("/tasks")
                .set(auth())
                .send({ title: "IDOR", estimatedMins: 15, projectId: foreignProjectId });

            expect(res.status).toBe(404);
        });

        it("PATCH /tasks/:id attaches an owned projectId", async () => {
            const task = await prisma.task.create({ data: { userId, title: "Attach", estimatedMins: 15 } });

            const res = await request(app).patch(`/tasks/${task.id}`).set(auth()).send({ projectId: ownedProjectId });

            expect(res.status).toBe(200);
            const after = await prisma.task.findUnique({ where: { id: task.id } });
            expect(after?.projectId).toBe(ownedProjectId);
        });

        it("PATCH /tasks/:id with projectId null detaches to Todos", async () => {
            const task = await prisma.task.create({ data: { userId, title: "Detach", estimatedMins: 15, projectId: ownedProjectId } });

            const res = await request(app).patch(`/tasks/${task.id}`).set(auth()).send({ projectId: null });

            expect(res.status).toBe(200);
            const after = await prisma.task.findUnique({ where: { id: task.id } });
            expect(after?.projectId).toBeNull();
        });

        it("PATCH /tasks/:id with another user's projectId returns 404", async () => {
            const task = await prisma.task.create({ data: { userId, title: "IDOR patch", estimatedMins: 15 } });

            const res = await request(app).patch(`/tasks/${task.id}`).set(auth()).send({ projectId: foreignProjectId });

            expect(res.status).toBe(404);
        });
    });
});
