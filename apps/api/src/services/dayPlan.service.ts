import { prisma } from "../lib/prisma";
import type { ConfirmAssignment, DayPlan, PlanProposal, ProposalBlock, ReviewTasks } from "../types/dayPlan.types";
import { generateSchedule, remainingMinsOf, type RawTask, type ScheduleDeps } from "./planAgent.service";

export class NoTemplateError extends Error { }
export class NoContainerBlocksError extends Error { }
export class InvalidAssignmentError extends Error { }

// The plan whose unfinished tasks carry over into a new plan: the most recent
// ACTIVE plan dated on or before `onOrBeforeDate`. On a same-day re-plan that's
// today's ACTIVE plan; if days were skipped it's the latest ACTIVE plan in the
// past. Using the latest ACTIVE plan (rather than strictly "yesterday") means a
// skipped day no longer strands an earlier plan's unfinished tasks.
async function mostRecentActivePlan(userId: string, onOrBeforeDate: string): Promise<{ id: string } | null> {
    return prisma.dayPlan.findFirst({
        where: { userId, status: 'ACTIVE', date: { lte: onOrBeforeDate } },
        orderBy: { date: 'desc' },
        select: { id: true },
    });
}

export async function getReviewTasks(userId: string, date: string): Promise<ReviewTasks> {
    const recentActive = await mostRecentActivePlan(userId, date);

    const taskSelect = {
        id: true,
        title: true,
        status: true,
        priority: true,
        deadline: true,
        progress: true,
        estimatedMins: true,
    } as const;

    const [carriedOver, backlog] = await Promise.all([
        recentActive
            ? prisma.task.findMany({
                where: {
                    userId,
                    status: { not: 'DONE' },
                    plannedBlock: { dayPlanId: recentActive.id },
                },
                select: taskSelect,
            })
            : Promise.resolve([]),
        prisma.task.findMany({
            where: {
                userId,
                plannedBlockId: null,
                status: { not: 'DONE' },
            },
            select: taskSelect,
        }),
    ]);

    return { carriedOver, backlog };
}

// Shared select for a fully populated plan (blocks with their assigned tasks).
const populatedPlanSelect = {
    id: true,
    date: true,
    wakeTime: true,
    sleepTime: true,
    status: true,
    blocks: {
        orderBy: { startTime: 'asc' },
        select: {
            id: true,
            type: true,
            name: true,
            startTime: true,
            endTime: true,
            energyLevel: true,
            tasks: {
                orderBy: { blockOrder: 'asc' },
                select: {
                    id: true,
                    title: true,
                    estimatedMins: true,
                    progress: true,
                    blockOrder: true,
                    status: true,
                }
            }
        }
    }
} as const;

function fetchPopulatedPlan(where: { id: string } | { userId: string; date: string; status: 'ACTIVE' }) {
    return prisma.dayPlan.findFirst({ where, select: populatedPlanSelect });
}
type RawPopulatedPlan = NonNullable<Awaited<ReturnType<typeof fetchPopulatedPlan>>>;

// Derives each task's remainingMins and drops the raw progress field.
function toDayPlan(raw: RawPopulatedPlan): DayPlan {
    return {
        ...raw,
        blocks: raw.blocks.map(b => ({
            ...b,
            tasks: b.tasks.map(({ progress, ...t }) => ({
                ...t,
                remainingMins: remainingMinsOf(t.estimatedMins, progress),
            })),
        })),
    };
}

export async function getDayPlan(userId: string, date: string): Promise<DayPlan | null> {
    const raw = await fetchPopulatedPlan({ userId, date, status: 'ACTIVE' });
    return raw ? toDayPlan(raw) : null;
}

// Fetches schedulable tasks: carry-over (unfinished tasks from the most recent
// ACTIVE plan) plus backlog (unscheduled, not DONE). The two sets are disjoint —
// carry-over tasks still point at that plan's blocks, backlog tasks at none.
async function getSchedulableTasks(userId: string, planDate: string): Promise<RawTask[]> {
    const recentActive = await mostRecentActivePlan(userId, planDate);
    const taskSelect = {
        id: true,
        title: true,
        estimatedMins: true,
        progress: true,
        effort: true,
        priority: true,
        deadline: true,
        status: true,
    } as const;

    const [carriedOver, backlog] = await Promise.all([
        recentActive
            ? prisma.task.findMany({
                where: {
                    userId,
                    status: { not: 'DONE' },
                    plannedBlock: { dayPlanId: recentActive.id },
                },
                select: taskSelect,
            })
            : Promise.resolve([]),
        prisma.task.findMany({
            where: { userId, plannedBlockId: null, status: { not: 'DONE' } },
            select: taskSelect,
        }),
    ]);

    return [...carriedOver, ...backlog];
}

// The template blocks still schedulable at `nowHHmm`: fully elapsed blocks are
// dropped, an in-progress block is clamped to start now.
// "HH:mm" strings are zero-padded, so a lexical compare is chronological.
type EligibleBlock = {
    id: string;
    type: 'CONTAINER' | 'ANCHOR' | 'NO_TASK';
    name: string;
    startTime: string;
    endTime: string;
    energyLevel: 'HIGH' | 'MEDIUM' | 'LOW' | null;
};

async function getTemplateOrThrow(userId: string) {
    const template = await prisma.dayTemplate.findUnique({
        where: { userId },
        select: {
            wakeTime: true,
            sleepTime: true,
            blocks: {
                select: { id: true, type: true, name: true, startTime: true, endTime: true, energyLevel: true },
            },
        },
    });
    if (!template) throw new NoTemplateError();
    return template;
}

function eligibleBlocksOf(blocks: EligibleBlock[], nowHHmm: string): EligibleBlock[] {
    return blocks
        .filter(b => b.endTime > nowHHmm)
        .map(b => ({ ...b, startTime: b.startTime < nowHHmm ? nowHHmm : b.startTime }));
}

/**
 * Generates a plan proposal for `date` and returns it to the caller.
 *
 * Pure computation — nothing is written to the database. The proposal's blocks
 * are keyed by template block id; the client holds the proposal during review
 * and sends the final placements back via confirmPlan. Abandoning the flow
 * therefore requires no cleanup and cannot affect the active plan or backlog.
 *
 * Every schedulable task appears in the proposal exactly once: either placed in
 * a block or listed as unschedulable (tasks the agent dropped entirely are
 * added to unschedulable as a fallback).
 *
 * `deps` is the agent dependency seam, forwarded for tests; production omits it.
 *
 * @throws {NoTemplateError} If the user has no day template.
 * @throws {NoContainerBlocksError} If no CONTAINER block remains today.
 * @throws {AgentError} If the agent call fails or returns malformed output.
 */
export async function generatePlanProposal(
    userId: string,
    date: string,
    nowHHmm: string,
    deps?: ScheduleDeps,
): Promise<PlanProposal> {
    const template = await getTemplateOrThrow(userId);

    const eligible = eligibleBlocksOf(template.blocks, nowHHmm);
    if (!eligible.some(b => b.type === 'CONTAINER')) {
        throw new NoContainerBlocksError();
    }

    const tasks = await getSchedulableTasks(userId, date);

    const result = deps
        ? await generateSchedule(eligible, tasks, deps)
        : await generateSchedule(eligible, tasks);

    // Only honour assignments that reference an eligible CONTAINER block and a
    // schedulable task; dedupe so each task appears at most once.
    const containerIds = new Set(eligible.filter(b => b.type === 'CONTAINER').map(b => b.id));
    const taskById = new Map(tasks.map(t => [t.id, t]));
    const placedTaskIds = new Set<string>();
    const byBlock = new Map<string, { taskId: string; blockOrder: number }[]>();
    for (const a of result.assignments) {
        if (!containerIds.has(a.blockId) || !taskById.has(a.taskId) || placedTaskIds.has(a.taskId)) continue;
        placedTaskIds.add(a.taskId);
        const list = byBlock.get(a.blockId) ?? [];
        list.push({ taskId: a.taskId, blockOrder: a.blockOrder });
        byBlock.set(a.blockId, list);
    }

    const blocks: ProposalBlock[] = eligible.map(b => {
        const placements = (byBlock.get(b.id) ?? []).sort((x, y) => x.blockOrder - y.blockOrder);
        return {
            blockId: b.id,
            type: b.type,
            name: b.name,
            startTime: b.startTime,
            endTime: b.endTime,
            energyLevel: b.energyLevel,
            tasks: placements.map(p => {
                const t = taskById.get(p.taskId)!;
                return {
                    id: t.id,
                    title: t.title,
                    estimatedMins: t.estimatedMins,
                    remainingMins: remainingMinsOf(t.estimatedMins, t.progress),
                    status: t.status,
                };
            }),
        };
    });

    // Enrich the agent's unschedulable list with display fields, then append any
    // schedulable task the agent dropped entirely — the proposal is the client's
    // whole world during review, so every task must be accounted for.
    const unschedulable = result.unschedulable.flatMap(u => {
        const t = taskById.get(u.taskId);
        if (!t || placedTaskIds.has(u.taskId)) return [];
        placedTaskIds.add(u.taskId);
        return [{
            taskId: u.taskId,
            title: t.title,
            estimatedMins: t.estimatedMins,
            remainingMins: remainingMinsOf(t.estimatedMins, t.progress),
            reason: u.reason,
        }];
    });
    for (const t of tasks) {
        if (placedTaskIds.has(t.id)) continue;
        unschedulable.push({
            taskId: t.id,
            title: t.title,
            estimatedMins: t.estimatedMins,
            remainingMins: remainingMinsOf(t.estimatedMins, t.progress),
            reason: 'The agent did not place this task.',
        });
    }

    return {
        wakeTime: template.wakeTime,
        sleepTime: template.sleepTime,
        blocks,
        unschedulable,
    };
}

/**
 * Persists a confirmed plan for `date` in a single transaction. This is the
 * only mutation point of the planning flow.
 *
 * `assignments` maps tasks to template block ids (as returned in the proposal).
 * The server re-derives everything it needs from the template rather than
 * trusting client-sent blocks:
 *   - An assignment naming a block that is not a CONTAINER block of the user's
 *     template is rejected (client bug or forgery) with InvalidAssignmentError.
 *   - An assignment whose block has fully elapsed since the proposal was
 *     generated is silently dropped — the task simply stays in the backlog.
 *   - Assignments for tasks that vanished or were completed during review are
 *     silently dropped for the same reason: the world moved on, the task is
 *     still reachable.
 *   - Duplicate task ids keep the first occurrence.
 *
 * The confirmed plan spans the whole day. Elapsed template blocks are included
 * as history: on a same-day re-plan their task placements are carried over from
 * the superseded ACTIVE plan (matched by name + endTime); on a fresh plan they
 * are empty. Tasks still attached to the superseded plan's non-elapsed blocks
 * that were not re-assigned return to the backlog.
 *
 * Finally, ACTIVE plans from *earlier* dates are retired: their not-DONE tasks
 * return to the backlog (so nothing is stranded on an old plan) and the plans
 * are marked COMPLETED. DONE tasks keep their placement as history.
 *
 * @throws {NoTemplateError} If the user has no day template.
 * @throws {InvalidAssignmentError} If an assignment references a block that is
 *         not a CONTAINER block of the user's template.
 */
export async function confirmPlan(
    userId: string,
    date: string,
    nowHHmm: string,
    assignments: ConfirmAssignment[],
): Promise<DayPlan> {
    const template = await getTemplateOrThrow(userId);

    const templateBlockById = new Map(template.blocks.map(b => [b.id, b]));
    for (const a of assignments) {
        const block = templateBlockById.get(a.blockId);
        if (!block || block.type !== 'CONTAINER') throw new InvalidAssignmentError();
    }

    // Drop assignments to blocks that elapsed during review, dedupe task ids,
    // and drop tasks that no longer exist / no longer belong / are DONE.
    const stillOpen = assignments.filter(a => templateBlockById.get(a.blockId)!.endTime > nowHHmm);
    const seen = new Set<string>();
    const deduped = stillOpen.filter(a => {
        if (seen.has(a.taskId)) return false;
        seen.add(a.taskId);
        return true;
    });
    const validTasks = await prisma.task.findMany({
        where: { id: { in: deduped.map(a => a.taskId) }, userId, status: { not: 'DONE' } },
        select: { id: true },
    });
    const validTaskIds = new Set(validTasks.map(t => t.id));
    const confirmed = deduped.filter(a => validTaskIds.has(a.taskId));
    const confirmedTaskIds = new Set(confirmed.map(a => a.taskId));

    const planId = await prisma.$transaction(async (tx) => {
        // ── Capture and release the superseded same-day ACTIVE plan ──
        const oldActive = await tx.dayPlan.findFirst({
            where: { userId, date, status: 'ACTIVE' },
            select: {
                id: true,
                blocks: {
                    select: {
                        id: true, name: true, endTime: true,
                        tasks: { select: { id: true, blockOrder: true } },
                    },
                },
            },
        });

        // Task placements of the old plan's *elapsed* blocks, keyed by
        // name|endTime so they can be re-pointed at the new plan's copy.
        const elapsedHistory = new Map<string, { id: string; blockOrder: number | null }[]>();
        if (oldActive) {
            for (const b of oldActive.blocks) {
                if (b.endTime <= nowHHmm && b.tasks.length > 0) {
                    elapsedHistory.set(`${b.name}|${b.endTime}`, b.tasks);
                }
            }
            const oldBlockIds = oldActive.blocks.map(b => b.id);
            await tx.task.updateMany({
                where: { plannedBlockId: { in: oldBlockIds } },
                data: { plannedBlockId: null, blockOrder: null },
            });
            await tx.plannedBlock.deleteMany({ where: { dayPlanId: oldActive.id } });
            await tx.dayPlan.delete({ where: { id: oldActive.id } });
        }

        // ── Retire ACTIVE plans from earlier dates ──
        // Their not-DONE tasks return to the backlog so nothing is stranded on a
        // plan that carry-over will no longer look at. DONE tasks stay as history.
        const pastActives = await tx.dayPlan.findMany({
            where: { userId, status: 'ACTIVE', date: { lt: date } },
            select: { id: true, date: true, blocks: { select: { id: true } } },
        });
        for (const plan of pastActives) {
            const blockIds = plan.blocks.map(b => b.id);
            if (blockIds.length > 0) {
                await tx.task.updateMany({
                    where: { plannedBlockId: { in: blockIds }, status: { not: 'DONE' } },
                    data: { plannedBlockId: null, blockOrder: null },
                });
            }
            // A COMPLETED plan for this date may already exist (if the device date
            // moved backwards between confirms), which would collide with @@unique
            // on the ACTIVE→COMPLETED update — so drop the stale COMPLETED row first.
            const staleCompleted = await tx.dayPlan.findFirst({
                where: { userId, date: plan.date, status: 'COMPLETED' },
                select: { id: true, blocks: { select: { id: true } } },
            });
            if (staleCompleted) {
                const staleBlockIds = staleCompleted.blocks.map(b => b.id);
                if (staleBlockIds.length > 0) {
                    await tx.task.updateMany({
                        where: { plannedBlockId: { in: staleBlockIds } },
                        data: { plannedBlockId: null, blockOrder: null },
                    });
                    await tx.plannedBlock.deleteMany({ where: { dayPlanId: staleCompleted.id } });
                }
                await tx.dayPlan.delete({ where: { id: staleCompleted.id } });
            }
            await tx.dayPlan.update({ where: { id: plan.id }, data: { status: 'COMPLETED' } });
        }

        // ── Create the new plan spanning the whole day ──
        // Elapsed blocks keep their template times (history); open blocks are
        // clamped to start no earlier than now, mirroring the proposal.
        const plan = await tx.dayPlan.create({
            data: {
                userId,
                date,
                wakeTime: template.wakeTime,
                sleepTime: template.sleepTime,
                status: 'ACTIVE',
                blocks: {
                    create: template.blocks.map(b => ({
                        type: b.type,
                        name: b.name,
                        startTime: b.endTime > nowHHmm && b.startTime < nowHHmm ? nowHHmm : b.startTime,
                        endTime: b.endTime,
                        energyLevel: b.energyLevel,
                    })),
                },
            },
            select: {
                id: true,
                blocks: { select: { id: true, name: true, endTime: true } },
            },
        });

        // Template block id → created block id, via the template ordering (the
        // created blocks come back in insertion order is not guaranteed, so match
        // by name + endTime which is unique within a valid template).
        const createdByKey = new Map(plan.blocks.map(b => [`${b.name}|${b.endTime}`, b.id]));

        // ── Restore elapsed history from the superseded plan ──
        for (const [key, placements] of elapsedHistory) {
            const newBlockId = createdByKey.get(key);
            if (!newBlockId) continue;
            for (const p of placements) {
                if (confirmedTaskIds.has(p.id)) continue; // the confirmed placement wins
                await tx.task.update({
                    where: { id: p.id },
                    data: { plannedBlockId: newBlockId, blockOrder: p.blockOrder },
                });
            }
        }

        // ── Apply the confirmed placements ──
        // Renumber per block so blockOrder is a contiguous 0..n-1 regardless of
        // what the client sent.
        const byBlock = new Map<string, ConfirmAssignment[]>();
        for (const a of confirmed) {
            const list = byBlock.get(a.blockId) ?? [];
            list.push(a);
            byBlock.set(a.blockId, list);
        }
        for (const [templateBlockId, list] of byBlock) {
            const tb = templateBlockById.get(templateBlockId)!;
            const newBlockId = createdByKey.get(`${tb.name}|${tb.endTime}`);
            if (!newBlockId) continue;
            list.sort((a, b) => a.blockOrder - b.blockOrder);
            for (let i = 0; i < list.length; i++) {
                await tx.task.update({
                    where: { id: list[i].taskId },
                    data: { plannedBlockId: newBlockId, blockOrder: i },
                });
            }
        }

        return plan.id;
    });

    const populated = await fetchPopulatedPlan({ id: planId });
    return toDayPlan(populated as RawPopulatedPlan);
}
