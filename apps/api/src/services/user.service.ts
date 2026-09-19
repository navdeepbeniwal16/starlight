import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

// The local row is a minimal anchor keyed on the Clerk user id — Clerk is the
// sole source of truth for identity, so the backend stores none of it. Created
// on the first authenticated request (JIT provisioning) and never mutated after.
export async function resolveLocalUser(clerkUserId: string): Promise<{ id: string }> {
    const existing = await prisma.user.findUnique({
        where: { clerkUserId },
        select: { id: true },
    });
    if (existing) return existing;

    try {
        return await prisma.user.upsert({
            where: { clerkUserId },
            update: {},
            create: { clerkUserId },
            select: { id: true },
        });
    } catch (error) {
        // A concurrent first-request can insert the same clerkUserId between
        // our read and our write. When that collision surfaces as P2002 instead
        // of being absorbed, re-read and return the row the winner created so
        // the racing user gets their identity, not a 500.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            const raced = await prisma.user.findUnique({
                where: { clerkUserId },
                select: { id: true },
            });
            if (raced) return raced;
        }
        throw error;
    }
}
