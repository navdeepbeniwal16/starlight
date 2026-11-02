import { prisma } from "../lib/prisma";
import type { ConfirmPlan, DayPlan, PlanProposal, ProposalBlock, ReviewTasks } from "../types/dayPlan.types";
import type { DayShape, ShapeBlock } from "../types/dayTemplate.types";
import { generateSchedule, remainingMinsOf, type RawTask, type ScheduleDeps } from "./planAgent.service";
import { getDayTemplateById } from "./dayTemplate.service";
import { validateDayShape } from "./dayTemplate.validator";

export class NoContainerBlocksError extends Error { }
export class InvalidPlacementError extends Error { }

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
        notes: true,
        createdAt: true,
        status: true,
        // Eager-load the Project so buildAgentInput can nest tasks under it.
        project: { select: { id: true, name: true, goal: true, notes: true, isInFocus: true } },
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
    type: 'CONTAINER' | 'ANCHOR';
    name: string;
    startTime: string;
    endTime: string;
    energyLevel: 'HIGH' | 'MEDIUM' | 'LOW' | null;
};

function shapeToEligibleBlocks(blocks: ShapeBlock[]): EligibleBlock[] {
    return blocks.map(b => ({
        id: b.id,
        type: b.type,
        name: b.name,
        startTime: b.startTime,
        endTime: b.endTime,
        energyLevel: b.energyLevel ?? null,
    }));
}

function eligibleBlocksOf(blocks: EligibleBlock[], nowHHmm: string): EligibleBlock[] {
    return blocks
        .filter(b => b.endTime > nowHHmm)
        .map(b => ({ ...b, startTime: b.startTime < nowHHmm ? nowHHmm : b.startTime }));
}

/**
 * Generates a plan proposal for `date` and returns it to the caller.
 *
 * Runs from the client-submitted `shape` (base template + today's edits). Pure computation: nothing is written to the
 * database. The proposal's blocks are keyed by shape block id; the client holds
 * the proposal during review and sends the final placements back via confirmPlan.
 * Abandoning the flow needs no cleanup and cannot affect the active plan or backlog.
 *
 * Every schedulable task appears in the proposal exactly once: either placed in
 * a block or listed as unschedulable (tasks the agent dropped entirely are
 * added to unschedulable as a fallback).
 *
 * `nowHHmm` is the user's local wall clock, used to drop elapsed blocks; `now` is
 * the server's current instant (ISO), handed to the agent as its urgency/staleness
 * anchor. `deps` is the agent dependency seam, forwarded for tests; production omits it.
 *
 * @throws {DayShapeValidationError} If `shape` is structurally invalid.
 * @throws {DayTemplateNotFoundError} If `templateId` isn't the caller's template.
 * @throws {NoContainerBlocksError} If no CONTAINER block remains today.
 * @throws {AgentError} If the agent call fails or returns malformed output.
 */
export async function generatePlanProposal(
    userId: string,
    date: string,
    nowHHmm: string,
    now: string,
    templateId: string,
    shape: DayShape,
    deps?: ScheduleDeps,
): Promise<PlanProposal> {
    validateDayShape(shape);
    await getDayTemplateById(userId, templateId); // ownership gate; blocks go unused

    const eligible = eligibleBlocksOf(shapeToEligibleBlocks(shape.blocks), nowHHmm);
    if (!eligible.some(b => b.type === 'CONTAINER')) {
        throw new NoContainerBlocksError();
    }

    const tasks = await getSchedulableTasks(userId, date);

    const result = deps
        ? await generateSchedule(eligible, tasks, now, deps)
        : await generateSchedule(eligible, tasks, now);

    const taskById = new Map(tasks.map(t => [t.id, t]));
    const placedTaskIds = new Set<string>();
    const byBlock = new Map<string, { taskId: string; blockOrder: number }[]>();
    for (const a of result.assignments) {
        placedTaskIds.add(a.taskId);
        const list = byBlock.get(a.blockId) ?? [];
        list.push({ taskId: a.taskId, blockOrder: a.blockOrder });
        byBlock.set(a.blockId, list);
    }

    const eligibleById = new Map(eligible.map(b => [b.id, b]));
    const blocks: ProposalBlock[] = shape.blocks.map(sb => {
        const elig = eligibleById.get(sb.id);
        if (!elig) {
            return {
                blockId: sb.id,
                type: sb.type,
                name: sb.name,
                startTime: sb.startTime,
                endTime: sb.endTime,
                energyLevel: sb.energyLevel ?? null,
                tasks: [],
                elapsed: true,
            };
        }
        const placements = (byBlock.get(elig.id) ?? []).sort((x, y) => x.blockOrder - y.blockOrder);
        return {
            blockId: elig.id,
            type: elig.type,
            name: elig.name,
            startTime: elig.startTime,
            endTime: elig.endTime,
            energyLevel: elig.energyLevel,
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
            elapsed: false,
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
        wakeTime: shape.wakeTime,
        sleepTime: shape.sleepTime,
        blocks,
        unschedulable,
    };
}

/**
 * Persists a confirmed plan for `date` in a single transaction. This is the
 * only mutation point of the planning flow.
 *
 * `plan` is the client's edited proposal — the resolved day shape with each
 * CONTAINER block's task placements nested as `taskIds` (array index = the
 * intended blockOrder). The server persists from that plan, trusting only task
 * ids (task content is re-read from the DB) and `templateId` as provenance:
 *   - `taskIds` on a non-CONTAINER block, or the same task placed more than once
 *     (within or across blocks), is a client bug → InvalidPlacementError.
 *   - Placements are honored as submitted, including into a block that elapsed
 *     during review — that block is still part of the persisted day, so the task
 *     stays where the user put it rather than silently bouncing to the backlog.
 *   - Placements for tasks that vanished, were completed, or aren't the caller's
 *     are silently dropped: those tasks genuinely can't be placed.
 *
 * The confirmed plan spans the whole day. Elapsed blocks are included as history:
 * on a same-day re-plan their task placements carry over from the superseded
 * ACTIVE plan (matched by name + endTime); on a fresh plan they are empty. Tasks
 * still attached to the superseded plan's non-elapsed blocks that were not
 * re-placed return to the backlog.
 *
 * Finally, ACTIVE plans from *earlier* dates are retired: their not-DONE tasks
 * return to the backlog (so nothing is stranded on an old plan) and the plans
 * are marked COMPLETED. DONE tasks keep their placement as history.
 *
 * @throws {DayShapeValidationError} If `plan` is structurally invalid.
 * @throws {DayTemplateNotFoundError} If `templateId` isn't the caller's template.
 * @throws {InvalidPlacementError} If a placement is structurally illegal: a task
 *         on a non-CONTAINER block, or the same task placed more than once.
 */
export async function confirmPlan(
    userId: string,
    date: string,
    nowHHmm: string,
    templateId: string,
    plan: ConfirmPlan,
): Promise<DayPlan> {
    validateDayShape(plan);
    await getDayTemplateById(userId, templateId); // ownership gate; blocks go unused

    const blockById = new Map(plan.blocks.map(b => [b.id, b]));

    // Flatten the nested plan to (blockId, taskId, blockOrder) placements while
    // enforcing placement legality: tasks ride only on CONTAINER blocks, and no
    // task is placed twice. Array index is the intended blockOrder.
    type Placement = { taskId: string; blockId: string; blockOrder: number };
    const placements: Placement[] = [];
    const placed = new Set<string>();
    for (const block of plan.blocks) {
        const taskIds = block.taskIds ?? [];
        if (taskIds.length > 0 && block.type !== 'CONTAINER') throw new InvalidPlacementError();
        taskIds.forEach((taskId, blockOrder) => {
            if (placed.has(taskId)) throw new InvalidPlacementError();
            placed.add(taskId);
            placements.push({ taskId, blockId: block.id, blockOrder });
        });
    }

    // Only drop tasks that cannot be placed: vanished, done or does not belong with requesting user
    const validTasks = await prisma.task.findMany({
        where: { id: { in: placements.map(p => p.taskId) }, userId, status: { not: 'DONE' } },
        select: { id: true },
    });
    const validTaskIds = new Set(validTasks.map(t => t.id));
    const confirmed = placements.filter(p => validTaskIds.has(p.taskId));
    const confirmedTaskIds = new Set(confirmed.map(p => p.taskId));

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
        for (const pastPlan of pastActives) {
            const blockIds = pastPlan.blocks.map(b => b.id);
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
                where: { userId, date: pastPlan.date, status: 'COMPLETED' },
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
            await tx.dayPlan.update({ where: { id: pastPlan.id }, data: { status: 'COMPLETED' } });
        }

        // ── Create the new plan spanning the whole day ──
        // Snapshot the submitted plan's blocks. Elapsed blocks keep their times
        // (history); an in-progress block is clamped to start no earlier than now.
        const created = await tx.dayPlan.create({
            data: {
                userId,
                date,
                dayTemplateId: templateId,
                wakeTime: plan.wakeTime,
                sleepTime: plan.sleepTime,
                status: 'ACTIVE',
                blocks: {
                    create: plan.blocks.map(b => ({
                        type: b.type,
                        name: b.name,
                        startTime: b.endTime > nowHHmm && b.startTime < nowHHmm ? nowHHmm : b.startTime,
                        endTime: b.endTime,
                        energyLevel: b.energyLevel ?? null,
                    })),
                },
            },
            select: {
                id: true,
                blocks: { select: { id: true, name: true, endTime: true } },
            },
        });

        // Submitted block → created block, matched by name + endTime (unique
        // within a valid, non-overlapping plan since insertion order isn't
        // guaranteed). Also keys the cross-re-plan elapsed-history restore.
        const createdByKey = new Map(created.blocks.map(b => [`${b.name}|${b.endTime}`, b.id]));

        // ── Restore elapsed history from the superseded plan ──
        for (const [key, oldPlacements] of elapsedHistory) {
            const newBlockId = createdByKey.get(key);
            if (!newBlockId) continue;
            for (const p of oldPlacements) {
                if (confirmedTaskIds.has(p.id)) continue; // the confirmed placement wins
                await tx.task.update({
                    where: { id: p.id },
                    data: { plannedBlockId: newBlockId, blockOrder: p.blockOrder },
                });
            }
        }

        // ── Apply the confirmed placements ──
        // Renumber per block so blockOrder is a contiguous 0..n-1 after any
        // elapsed/invalid placements were dropped above.
        const byBlock = new Map<string, Placement[]>();
        for (const p of confirmed) {
            const list = byBlock.get(p.blockId) ?? [];
            list.push(p);
            byBlock.set(p.blockId, list);
        }
        for (const [blockId, list] of byBlock) {
            const block = blockById.get(blockId)!;
            const newBlockId = createdByKey.get(`${block.name}|${block.endTime}`);
            if (!newBlockId) continue;
            list.sort((a, b) => a.blockOrder - b.blockOrder);
            for (let i = 0; i < list.length; i++) {
                await tx.task.update({
                    where: { id: list[i].taskId },
                    data: { plannedBlockId: newBlockId, blockOrder: i },
                });
            }
        }

        return created.id;
    });

    const populated = await fetchPopulatedPlan({ id: planId });
    return toDayPlan(populated as RawPopulatedPlan);
}
