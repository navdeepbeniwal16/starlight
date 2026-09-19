import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

// Identity Clerk carries in its session claims. Populated on the first
// authenticated request (JIT provisioning) and never after — the local row is a
// minimal anchor, and Clerk stays the source of truth for these fields. For a
// social sign-in, first/last name arrive from the OAuth provider (CLERK-5).
export type ClerkIdentity = { email?: string; firstName?: string; lastName?: string };

export async function resolveLocalUser(clerkUserId: string, identity: ClerkIdentity = {}): Promise<{ id: string }> {
    const existing = await prisma.user.findUnique({
        where: { clerkUserId },
        select: { id: true },
    });
    if (existing) return existing;

    const { email, firstName, lastName } = identity;
    try {
        return await prisma.user.upsert({
            where: { clerkUserId },
            update: {},
            create: { clerkUserId, email, firstName, lastName },
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
