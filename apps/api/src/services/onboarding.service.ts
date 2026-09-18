import { prisma } from "../lib/prisma";

// Narrows the nullable findUnique result. authenticate upserts the user before
// any route runs, so a miss here is an unexpected invariant breach, not a 404.
export class UserNotFoundError extends Error { }

export async function getOnboarding(userId: string): Promise<{ onboardedAt: Date | null }> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { onboardedAt: true },
    });

    if (!user) throw new UserNotFoundError();

    return user;
}


export async function markOnboarded(userId: string): Promise<{ onboardedAt: Date | null }> {
    // Idempotent: the null guard keeps the original timestamp so re-running
    // onboarding can never move an already-set completion time.
    await prisma.user.updateMany({
        where: { id: userId, onboardedAt: null },
        data: { onboardedAt: new Date() },
    });

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { onboardedAt: true },
    });

    if (!user) throw new UserNotFoundError();

    return user;
}
