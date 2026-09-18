/**
 * One-time, re-runnable import of existing users into Clerk (CLERK-3).
 *
 * Each local `User` predates the Clerk cutover and still carries its own
 * identity (email + bcrypt `passwordHash`). This creates a matching Clerk user
 * that imports the *existing* bcrypt hash — so people keep their current
 * password — then writes the returned Clerk id back onto the local row. That
 * `clerkUserId` link is what every authenticated request resolves against.
 *
 * Idempotency (safe to re-run during rehearsal and cutover):
 *   - Rows already linked (`clerkUserId` set) are skipped untouched.
 *   - `externalId` on the Clerk side is pinned to the local `User.id`, so a run
 *     that created the Clerk user but died before writeback is recovered by
 *     lookup rather than creating a duplicate.
 *   - A pre-existing Clerk user with the same email (created out-of-band) is
 *     linked rather than re-created.
 *
 * Identity only — no domain data (day template, day plans, tasks) is read or
 * written.
 *
 * Run with: npx tsx scripts/import-users-to-clerk.ts
 */
import "dotenv/config";
import { createClerkClient } from "@clerk/express";
import { prisma } from "../src/lib/prisma";

const secretKey = process.env.CLERK_SECRET_KEY;
if (!secretKey || secretKey === "sk_test_dummy") {
    throw new Error(
        "CLERK_SECRET_KEY is unset or the test dummy. Point .env at a real Clerk instance before importing users.",
    );
}

const clerk = createClerkClient({ secretKey });

/** Clerk flags a taken email/identifier with this error code on create. */
function isIdentifierTakenError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "errors" in error &&
        Array.isArray((error as { errors: unknown }).errors) &&
        (error as { errors: { code?: string }[] }).errors.some(e => e.code === "form_identifier_exists")
    );
}

/**
 * Return the Clerk user id for a local user, creating the Clerk user if needed.
 * Prefers the `externalId` anchor, then falls back to email so a re-run never
 * duplicates an account that already exists on the Clerk side.
 */
async function resolveClerkUser(user: {
    id: string;
    email: string;
    passwordHash: string;
    firstName: string | null;
    lastName: string | null;
}): Promise<string> {
    const byExternalId = await clerk.users.getUserList({ externalId: [user.id], limit: 1 });
    if (byExternalId.data[0]) return byExternalId.data[0].id;

    try {
        const created = await clerk.users.createUser({
            externalId: user.id,
            emailAddress: [user.email],
            firstName: user.firstName ?? undefined,
            lastName: user.lastName ?? undefined,
            passwordDigest: user.passwordHash,
            passwordHasher: "bcrypt",
            // Migrating an existing hash — bypass strength/breach and legal gates
            // that only apply to fresh sign-ups.
            skipPasswordChecks: true,
            skipLegalChecks: true,
        });
        return created.id;
    } catch (error) {
        if (!isIdentifierTakenError(error)) throw error;
        // Email already taken on the Clerk side. Safe to adopt only when it's the
        // same identity — our own externalId (a create Clerk hadn't yet indexed
        // for the lookup above) or an unclaimed account. An email owned by a
        // *different* externalId is a genuine conflict: linking it would graft
        // this user onto a Clerk account whose password we don't control, so
        // their "existing password" sign-in would fail. Refuse it loudly.
        const byEmail = await clerk.users.getUserList({ emailAddress: [user.email], limit: 1 });
        const existing = byEmail.data[0];
        if (existing && (existing.externalId === null || existing.externalId === user.id)) {
            return existing.id;
        }
        throw new Error(
            `Email ${user.email} is already held by a different Clerk identity ` +
                `(externalId ${existing?.externalId ?? "unknown"}); refusing to link local user ${user.id}.`,
        );
    }
}

async function main() {
    const users = await prisma.user.findMany({
        where: { clerkUserId: null },
        select: { id: true, email: true, passwordHash: true, firstName: true, lastName: true },
    });

    let imported = 0;
    let skipped = 0;
    for (const user of users) {
        if (!user.email || !user.passwordHash) {
            // No importable credentials — no hash to preserve, so there's nothing
            // to move into Clerk. Left unlinked for a human to resolve.
            console.warn(`Skipping user ${user.id}: missing email or password hash.`);
            skipped += 1;
            continue;
        }

        const clerkUserId = await resolveClerkUser({
            id: user.id,
            email: user.email,
            passwordHash: user.passwordHash,
            firstName: user.firstName,
            lastName: user.lastName,
        });

        await prisma.user.update({ where: { id: user.id }, data: { clerkUserId } });
        imported += 1;
    }

    const alreadyLinked = await prisma.user.count({ where: { clerkUserId: { not: null } } });
    console.log(
        `Imported ${imported} user(s) into Clerk, skipped ${skipped} without credentials. ` +
            `${alreadyLinked} user(s) now linked.`,
    );
}

main()
    .catch(err => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
