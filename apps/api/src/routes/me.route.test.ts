import request from "supertest";
import type { Request, Response, NextFunction } from "express";
import app from "../app";
import { prisma } from "../lib/prisma";

const TEST_CLERK_ID = "user_test_me_route";

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
        update: { onboardedAt: null },
        create: { clerkUserId },
    });
}

describe("me/onboarding routes", () => {
    let userId: string;

    beforeAll(async () => {
        const user = await seedUser(TEST_CLERK_ID);
        userId = user.id;
        mockUserId = userId;
    });

    afterAll(async () => {
        await prisma.user.delete({ where: { id: userId } });
        await prisma.$disconnect();
    });

    const auth = () => ({ Authorization: "Bearer test-token" });

    it("rejects an unauthenticated request", async () => {
        const res = await request(app).get("/me/onboarding");
        expect(res.status).toBe(401);
    });

    it("GET /me/onboarding returns the onboarding state", async () => {
        const res = await request(app).get("/me/onboarding").set(auth());

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual({ onboardedAt: null });
    });

    it("PUT /me/onboarding marks onboarding complete", async () => {
        const res = await request(app).put("/me/onboarding").set(auth());

        expect(res.status).toBe(200);
        expect(res.body.data.onboardedAt).not.toBeNull();
    });

    // Idempotency: a second PUT must not move the timestamp set by the first.
    it("PUT /me/onboarding is idempotent", async () => {
        const first = await request(app).put("/me/onboarding").set(auth());
        const second = await request(app).put("/me/onboarding").set(auth());

        expect(second.body.data.onboardedAt).toBe(first.body.data.onboardedAt);
    });
});
