import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { resolveLocalUser } from "./user.service";

const CLERK_ID = "user_test_resolve_local";
const EMAIL = "test-user-service@starlight.test";

function p2002(): Prisma.PrismaClientKnownRequestError {
    return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
    });
}

async function cleanup() {
    await prisma.user.deleteMany({ where: { clerkUserId: CLERK_ID } });
}

beforeEach(cleanup);
afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
});

describe("resolveLocalUser", () => {
    it("creates a local user on first sight", async () => {
        const user = await resolveLocalUser(CLERK_ID, EMAIL);

        const row = await prisma.user.findUnique({ where: { clerkUserId: CLERK_ID } });
        expect(row?.id).toBe(user.id);
        expect(row?.email).toBe(EMAIL);
    });

    it("returns the same user on subsequent calls without creating a duplicate", async () => {
        const first = await resolveLocalUser(CLERK_ID, EMAIL);
        const second = await resolveLocalUser(CLERK_ID, EMAIL);

        expect(second.id).toBe(first.id);
        expect(await prisma.user.count({ where: { clerkUserId: CLERK_ID } })).toBe(1);
    });

    // An existing anchor is never mutated, so a later email is ignored.
    it("does not overwrite the email of an existing user", async () => {
        await resolveLocalUser(CLERK_ID, EMAIL);
        await resolveLocalUser(CLERK_ID, "changed@starlight.test");

        const row = await prisma.user.findUnique({ where: { clerkUserId: CLERK_ID } });
        expect(row?.email).toBe(EMAIL);
    });

    // Two concurrent first-requests both miss the read; the upsert must absorb
    // the losing insert rather than surfacing a unique-constraint error.
    it("resolves concurrent first-requests to a single user", async () => {
        const [a, b] = await Promise.all([
            resolveLocalUser(CLERK_ID, EMAIL),
            resolveLocalUser(CLERK_ID, EMAIL),
        ]);

        expect(a.id).toBe(b.id);
        expect(await prisma.user.count({ where: { clerkUserId: CLERK_ID } })).toBe(1);
    });

    // A racing insert can surface as P2002 rather than being absorbed; the
    // service must recover by returning the winner's row, not propagate a 500.
    it("recovers from a P2002 race by re-reading the winner's row", async () => {
        jest.spyOn(prisma.user, "findUnique")
            .mockResolvedValueOnce(null) // initial read: no user yet
            .mockResolvedValueOnce({ id: "raced-id" } as never); // re-read after P2002
        jest.spyOn(prisma.user, "upsert").mockRejectedValueOnce(p2002());

        expect(await resolveLocalUser(CLERK_ID, EMAIL)).toEqual({ id: "raced-id" });
    });

    // A P2002 with no matching row is a genuine conflict (e.g. the email belongs
    // to a different identity), not our race — it must propagate, not be masked.
    it("rethrows P2002 when no matching row exists on re-read", async () => {
        const error = p2002();
        jest.spyOn(prisma.user, "findUnique").mockResolvedValue(null);
        jest.spyOn(prisma.user, "upsert").mockRejectedValueOnce(error);

        await expect(resolveLocalUser(CLERK_ID, EMAIL)).rejects.toBe(error);
    });
});
