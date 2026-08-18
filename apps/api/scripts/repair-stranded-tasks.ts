/**
 * One-off data repair for tasks stranded by the old draft-based planning flow.
 *
 * Under the old flow, generating a plan reassigned tasks onto DRAFT plan
 * blocks; abandoning the flow left them invisible (not in the backlog, not in
 * any active timeline). Superseded ACTIVE plans from past dates similarly hold
 * unfinished tasks that carry-over no longer reaches.
 *
 * This script:
 *   1. Returns every task attached to a DRAFT plan's block to the backlog,
 *      then deletes all DRAFT plans and their blocks (the new flow never
 *      persists drafts).
 *   2. For ACTIVE plans older than the most recent one per user: returns their
 *      not-DONE tasks to the backlog and marks the plans COMPLETED. DONE tasks
 *      keep their placement as history.
 *
 * Run with: npx tsx scripts/repair-stranded-tasks.ts
 * (Idempotent — safe to re-run.)
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
    // ── 1. Legacy DRAFT plans ──
    const drafts = await prisma.dayPlan.findMany({
        where: { status: "DRAFT" },
        select: { id: true, userId: true, date: true, blocks: { select: { id: true } } },
    });

    let releasedFromDrafts = 0;
    for (const draft of drafts) {
        const blockIds = draft.blocks.map(b => b.id);
        if (blockIds.length > 0) {
            const released = await prisma.task.updateMany({
                where: { plannedBlockId: { in: blockIds } },
                data: { plannedBlockId: null, blockOrder: null },
            });
            releasedFromDrafts += released.count;
        }
        await prisma.plannedBlock.deleteMany({ where: { dayPlanId: draft.id } });
        await prisma.dayPlan.delete({ where: { id: draft.id } });
    }
    console.log(`Deleted ${drafts.length} legacy DRAFT plan(s), returning ${releasedFromDrafts} task(s) to the backlog.`);

    // ── 2. Superseded ACTIVE plans ──
    // For each user, every ACTIVE plan except the most recent by date is
    // unreachable by carry-over: release its unfinished tasks and retire it.
    const actives = await prisma.dayPlan.findMany({
        where: { status: "ACTIVE" },
        orderBy: [{ userId: "asc" }, { date: "desc" }],
        select: { id: true, userId: true, date: true, blocks: { select: { id: true } } },
    });

    const latestSeen = new Set<string>();
    let retired = 0;
    let releasedFromActives = 0;
    for (const plan of actives) {
        if (!latestSeen.has(plan.userId)) {
            latestSeen.add(plan.userId); // most recent ACTIVE per user — keep as-is
            continue;
        }
        const blockIds = plan.blocks.map(b => b.id);
        if (blockIds.length > 0) {
            const released = await prisma.task.updateMany({
                where: { plannedBlockId: { in: blockIds }, status: { not: "DONE" } },
                data: { plannedBlockId: null, blockOrder: null },
            });
            releasedFromActives += released.count;
        }
        await prisma.dayPlan.update({ where: { id: plan.id }, data: { status: "COMPLETED" } });
        retired += 1;
    }
    console.log(`Retired ${retired} superseded ACTIVE plan(s), returning ${releasedFromActives} unfinished task(s) to the backlog.`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
