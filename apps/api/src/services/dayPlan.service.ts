import { prisma } from "../lib/prisma";
import type { BlockType, EnergyLevel } from "@prisma/client";
import type { DayPlan, GeneratePlanResult, PlannedTaskPlacement, ReviewTasks } from "../types/dayPlan.types";
import { generateSchedule, remainingMinsOf, type RawTask, type ScheduleDeps } from "./planAgent.service";
import { TaskNotFoundError } from "./task.service";

export class NoTemplateError extends Error {}
export class NoContainerBlocksError extends Error {}
export class PlanNotFoundError extends Error {}
export class PlanNotInDraftError extends Error {}
export class InvalidBlockError extends Error {}

export async function createDraftPlan(
    userId: string,
    date: string,
    nowHHmm: string,
): Promise<{ id: string }> {
    const template = await prisma.dayTemplate.findUnique({
        where: { userId },
        select: {
            wakeTime: true,
            sleepTime: true,
            blocks: {
                select: { type: true, name: true, startTime: true, endTime: true, energyLevel: true },
            },
        },
    });

    if (!template) throw new NoTemplateError();

    const eligibleBlocks = template.blocks
        .filter(b => b.endTime > nowHHmm)
        .map(b => ({
            type: b.type,
            name: b.name,
            startTime: b.startTime < nowHHmm ? nowHHmm : b.startTime,
            endTime: b.endTime,
            energyLevel: b.energyLevel,
        }));

    if (!eligibleBlocks.some(b => b.type === 'CONTAINER')) {
        throw new NoContainerBlocksError();
    }

    const plan = await prisma.$transaction(async (tx) => {
        const oldDraft = await tx.dayPlan.findFirst({
            where: { userId, date, status: 'DRAFT' },
            select: { id: true, blocks: { select: { id: true } } },
        });

        if (oldDraft) {
            const blockIds = oldDraft.blocks.map(b => b.id);
            await tx.task.updateMany({
                where: { plannedBlockId: { in: blockIds } },
                data: { plannedBlockId: null, blockOrder: null },
            });
            await tx.plannedBlock.deleteMany({ where: { dayPlanId: oldDraft.id } });
            await tx.dayPlan.delete({ where: { id: oldDraft.id } });
        }

        return tx.dayPlan.create({
            data: {
                userId,
                date,
                wakeTime: template.wakeTime,
                sleepTime: template.sleepTime,
                status: 'DRAFT',
                blocks: { create: eligibleBlocks },
            },
            select: { id: true },
        });
    });

    return { id: plan.id };
}

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

export async function getPlanTasks(userId: string, planId: string): Promise<ReviewTasks> {
    const plan = await prisma.dayPlan.findFirst({
        where: { id: planId, userId },
        select: { date: true },
    });
    if (!plan) throw new PlanNotFoundError();

    const recentActive = await mostRecentActivePlan(userId, plan.date);

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

// Fetches schedulable tasks for a draft: carry-over (unfinished tasks from the most
// recent ACTIVE plan) plus backlog (unscheduled, not DONE). The two sets are
// disjoint — carry-over tasks still point at that plan's blocks, backlog tasks at none.
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

// Invokes the AI agent to schedule tasks into the draft's CONTAINER blocks and
// writes the assignments back to the DB. Returns the populated draft plus the list
// of tasks the agent could not place. Only the draft is mutated — retiring a prior
// ACTIVE plan happens at confirm time, when the new plan actually goes live.
//
// `deps` is the agent dependency seam, forwarded for tests; production omits it.
export async function generatePlan(
    userId: string,
    planId: string,
    deps?: ScheduleDeps,
): Promise<GeneratePlanResult> {
    const plan = await prisma.dayPlan.findFirst({
        where: { id: planId, userId },
        select: {
            date: true,
            status: true,
            blocks: {
                select: { id: true, type: true, name: true, startTime: true, endTime: true, energyLevel: true },
            },
        },
    });
    if (!plan) throw new PlanNotFoundError();
    if (plan.status !== 'DRAFT') throw new PlanNotInDraftError();

    const tasks = await getSchedulableTasks(userId, plan.date);

    const result = deps
        ? await generateSchedule(plan.blocks, tasks, deps)
        : await generateSchedule(plan.blocks, tasks);

    // Only honour assignments that reference a real CONTAINER block and a
    // schedulable task; dedupe so each task is written at most once.
    const containerBlockIds = new Set(plan.blocks.filter(b => b.type === 'CONTAINER').map(b => b.id));
    const taskIds = new Set(tasks.map(t => t.id));
    const assignedTaskIds = new Set<string>();
    const writes = [];
    for (const a of result.assignments) {
        if (!containerBlockIds.has(a.blockId) || !taskIds.has(a.taskId) || assignedTaskIds.has(a.taskId)) continue;
        assignedTaskIds.add(a.taskId);
        writes.push(prisma.task.update({
            where: { id: a.taskId },
            data: { plannedBlockId: a.blockId, blockOrder: a.blockOrder },
        }));
    }

    if (writes.length > 0) {
        await prisma.$transaction(writes);
    }

    const populated = await fetchPopulatedPlan({ id: planId });

    // The agent returns only taskIds + reason; enrich with display fields so the
    // response is self-contained (the reason isn't persisted anywhere).
    const taskById = new Map(tasks.map(t => [t.id, t]));
    const unschedulable = result.unschedulable.flatMap(u => {
        const t = taskById.get(u.taskId);
        return t ? [{
            taskId: u.taskId,
            title: t.title,
            estimatedMins: t.estimatedMins,
            remainingMins: remainingMinsOf(t.estimatedMins, t.progress),
            reason: u.reason,
        }] : [];
    });

    return { plan: toDayPlan(populated as RawPopulatedPlan), unschedulable };
}

/**
 * Moves a task within a DRAFT plan, or returns it to the backlog.
 *
 * The server owns ordering: each affected block is renumbered to a contiguous
 * 0..n-1 sequence, so blockOrder never collides or leaves gaps regardless of the
 * caller. Callers should issue one call per move — not a batch of per-task renumbers.
 *
 * @param userId - Owner of the plan and task.
 * @param planId - The DRAFT plan being adjusted.
 * @param taskId - The task to place.
 * @param blockId - Target CONTAINER block, or null to return the task to the backlog.
 * @param blockOrder - Desired slot within the block, clamped into range. Ignored when blockId is null.
 * @returns The task's resulting placement (plannedBlockId and blockOrder).
 * @throws {PlanNotFoundError} If the plan does not exist or is not owned by the user.
 * @throws {PlanNotInDraftError} If the plan is not a DRAFT.
 * @throws {TaskNotFoundError} If the task does not exist or is not owned by the user.
 * @throws {InvalidBlockError} If blockId is set but is not a CONTAINER block of the plan.
 */
export async function adjustPlanTask(
    userId: string,
    planId: string,
    taskId: string,
    blockId: string | null,
    blockOrder: number,
): Promise<PlannedTaskPlacement> {
    const plan = await prisma.dayPlan.findFirst({
        where: { id: planId, userId },
        select: { status: true, blocks: { select: { id: true, type: true } } },
    });
    if (!plan) throw new PlanNotFoundError();
    if (plan.status !== 'DRAFT') throw new PlanNotInDraftError();

    const task = await prisma.task.findFirst({
        where: { id: taskId, userId },
        select: { id: true, plannedBlockId: true },
    });
    if (!task) throw new TaskNotFoundError();

    if (blockId !== null) {
        const block = plan.blocks.find(b => b.id === blockId);
        if (!block || block.type !== 'CONTAINER') throw new InvalidBlockError();
    }

    const sourceBlockId = task.plannedBlockId;

    return prisma.$transaction(async (tx) => {
        const orderedIds = async (blk: string, exceptId?: string): Promise<string[]> => {
            const rows = await tx.task.findMany({
                where: { plannedBlockId: blk, ...(exceptId ? { id: { not: exceptId } } : {}) },
                orderBy: { blockOrder: 'asc' },
                select: { id: true },
            });
            return rows.map(r => r.id);
        };
        const renumber = async (ids: string[]): Promise<void> => {
            for (let i = 0; i < ids.length; i++) {
                await tx.task.update({ where: { id: ids[i] }, data: { blockOrder: i } });
            }
        };

        if (blockId === null) {
            await tx.task.update({ where: { id: taskId }, data: { plannedBlockId: null, blockOrder: null } });
            if (sourceBlockId) await renumber(await orderedIds(sourceBlockId));
        } else {
            const siblings = await orderedIds(blockId, taskId);
            const insertAt = Math.min(Math.max(blockOrder, 0), siblings.length);
            const next = [...siblings.slice(0, insertAt), taskId, ...siblings.slice(insertAt)];
            await tx.task.update({ where: { id: taskId }, data: { plannedBlockId: blockId } });
            await renumber(next);
            if (sourceBlockId && sourceBlockId !== blockId) await renumber(await orderedIds(sourceBlockId));
        }

        return tx.task.findUniqueOrThrow({
            where: { id: taskId },
            select: { id: true, plannedBlockId: true, blockOrder: true },
        });
    });
}

/**
 * Promotes a DRAFT plan to ACTIVE, becoming the live day plan.
 *
 * The confirmed plan always spans the whole day, including time that has already
 * elapsed. Blocks whose endTime is at or before `nowHHmm` are copied into the
 * draft so the timeline shows them as history:
 *   - Re-plan (an ACTIVE plan already exists today): elapsed blocks are taken from
 *     the old plan *with* their task assignments (blockOrder preserved). Tasks still
 *     sitting in the old plan's not-yet-elapsed blocks were not re-planned, so they
 *     are unscheduled. The old ACTIVE plan is then deleted.
 *   - Fresh plan: elapsed blocks are taken (empty) from the day template, so the
 *     user can still see the blocks they had but never scheduled into.
 *
 * Elapsed blocks the draft already represents (a block that was upcoming when the
 * draft was created but has since elapsed) are skipped — the draft's own copy,
 * with any tasks scheduled into it, wins. All of this runs in one transaction.
 *
 * @param userId - Owner of the plan.
 * @param planId - The DRAFT plan to confirm.
 * @param nowHHmm - Current local time ("HH:mm") used to decide which blocks have elapsed.
 * @returns The now-ACTIVE, fully populated plan.
 * @throws {PlanNotFoundError} If the plan does not exist or is not owned by the user.
 * @throws {PlanNotInDraftError} If the plan is not a DRAFT.
 */
type ElapsedSourceBlock = {
    type: BlockType;
    name: string;
    startTime: string;
    endTime: string;
    energyLevel: EnergyLevel | null;
    tasks: { id: string; blockOrder: number | null }[];
};

export async function confirmPlan(
    userId: string,
    planId: string,
    nowHHmm: string,
): Promise<DayPlan> {
    const draft = await prisma.dayPlan.findFirst({
        where: { id: planId, userId },
        select: { id: true, date: true, status: true },
    });
    if (!draft) throw new PlanNotFoundError();
    if (draft.status !== 'DRAFT') throw new PlanNotInDraftError();

    await prisma.$transaction(async (tx) => {
        const oldActive = await tx.dayPlan.findFirst({
            where: { userId, date: draft.date, status: 'ACTIVE' },
            select: {
                id: true,
                blocks: {
                    select: {
                        type: true, name: true, startTime: true, endTime: true, energyLevel: true,
                        tasks: { select: { id: true, blockOrder: true } },
                    },
                },
            },
        });

        // Where the elapsed blocks come from: the old plan (with task history) on a
        // re-plan, or the day template (empty) on a fresh plan.
        // "HH:mm" strings are zero-padded, so a lexical compare is chronological.
        let elapsedSource: ElapsedSourceBlock[];
        if (oldActive) {
            elapsedSource = oldActive.blocks.filter(b => b.endTime <= nowHHmm);
        } else {
            const template = await tx.dayTemplate.findUnique({
                where: { userId },
                select: { blocks: { select: { type: true, name: true, startTime: true, endTime: true, energyLevel: true } } },
            });
            elapsedSource = (template?.blocks ?? [])
                .filter(b => b.endTime <= nowHHmm)
                .map(b => ({ ...b, tasks: [] }));
        }

        // Skip elapsed blocks the draft already represents (matched by name + endTime,
        // which clamping leaves intact) so they aren't duplicated.
        const draftBlocks = await tx.plannedBlock.findMany({
            where: { dayPlanId: draft.id },
            select: { name: true, endTime: true },
        });
        const draftKeys = new Set(draftBlocks.map(b => `${b.name}|${b.endTime}`));

        for (const block of elapsedSource) {
            if (draftKeys.has(`${block.name}|${block.endTime}`)) continue;
            const copy = await tx.plannedBlock.create({
                data: {
                    dayPlanId: draft.id,
                    type: block.type,
                    name: block.name,
                    startTime: block.startTime,
                    endTime: block.endTime,
                    energyLevel: block.energyLevel,
                },
                select: { id: true },
            });
            for (const t of block.tasks) {
                await tx.task.update({
                    where: { id: t.id },
                    data: { plannedBlockId: copy.id, blockOrder: t.blockOrder },
                });
            }
        }

        if (oldActive) {
            // Anything still pointing at the old plan's blocks lives in a non-elapsed
            // block (elapsed tasks were re-pointed above) and was not re-planned.
            const remainingBlockIds = (
                await tx.plannedBlock.findMany({
                    where: { dayPlanId: oldActive.id },
                    select: { id: true },
                })
            ).map(b => b.id);
            if (remainingBlockIds.length > 0) {
                await tx.task.updateMany({
                    where: { plannedBlockId: { in: remainingBlockIds } },
                    data: { plannedBlockId: null, blockOrder: null },
                });
                await tx.plannedBlock.deleteMany({ where: { dayPlanId: oldActive.id } });
            }
            await tx.dayPlan.delete({ where: { id: oldActive.id } });
        }

        await tx.dayPlan.update({ where: { id: draft.id }, data: { status: 'ACTIVE' } });
    });

    const populated = await fetchPopulatedPlan({ id: planId });
    return toDayPlan(populated as RawPopulatedPlan);
}
