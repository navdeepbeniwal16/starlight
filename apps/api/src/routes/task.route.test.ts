import request from "supertest";
import app from "../app";
import { prisma } from "../lib/prisma";
import { signToken } from "../lib/jwt";

const TEST_EMAIL = "test-task-route@starlight.test";

async function seedUser(email: string) {
    return prisma.user.upsert({
        where: { email },
        update: {},
        create: { email, passwordHash: "not-a-real-hash", firstName: "Test", lastName: "User" },
    });
}

describe("task routes", () => {
    let userId: string;
    let token: string;
    let taskId: string;

    beforeAll(async () => {
        const user = await seedUser(TEST_EMAIL);
        userId = user.id;
        token = signToken({ sub: userId, email: TEST_EMAIL });
        await prisma.task.deleteMany({ where: { userId } });
        const task = await prisma.task.create({ data: { userId, title: "Route task", estimatedMins: 30 } });
        taskId = task.id;
    });

    afterAll(async () => {
        await prisma.task.deleteMany({ where: { userId } });
        await prisma.user.delete({ where: { id: userId } });
        await prisma.$disconnect();
    });

    const auth = () => ({ Authorization: `Bearer ${token}` });

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
});
