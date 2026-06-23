import { prisma } from "../lib/prisma";
import type { DayPlan, GeneratePlanResult, ReviewTasks } from "../types/dayPlan.types";
import { generateSchedule, type RawTask, type ScheduleDeps } from "./planAgent.service";

export class NoTemplateError extends Error {}
export class NoContainerBlocksError extends Error {}
export class PlanNotFoundError extends Error {}
export class PlanNotInDraftError extends Error {}

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

function yesterdayOf(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 1);
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export async function getPlanTasks(userId: string, planId: string): Promise<ReviewTasks> {
    const plan = await prisma.dayPlan.findFirst({
        where: { id: planId, userId },
        select: { date: true },
    });
    if (!plan) throw new PlanNotFoundError();

    const yesterday = yesterdayOf(plan.date);

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
        prisma.task.findMany({
            where: {
                userId,
                status: { not: 'DONE' },
                plannedBlock: {
                    dayPlan: { date: yesterday, status: 'ACTIVE' },
                },
            },
            select: taskSelect,
        }),
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
                    blockOrder: true,
                    status: true,
                }
            }
        }
    }
} as const;

export async function getDayPlan(userId: string, date: string): Promise<DayPlan | null> {
    return prisma.dayPlan.findFirst({
        where: { userId, date, status: 'ACTIVE' },
        select: populatedPlanSelect,
    });
}

// Fetches schedulable tasks for a draft: carry-over (from yesterday's ACTIVE plan,
// not DONE) plus backlog (unscheduled, not DONE). The two sets are disjoint —
// carry-over tasks still point at yesterday's block, backlog tasks at none.
async function getSchedulableTasks(userId: string, planDate: string): Promise<RawTask[]> {
    const yesterday = yesterdayOf(planDate);
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
        prisma.task.findMany({
            where: {
                userId,
                status: { not: 'DONE' },
                plannedBlock: { dayPlan: { date: yesterday, status: 'ACTIVE' } },
            },
            select: taskSelect,
        }),
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

    const populated = await prisma.dayPlan.findUnique({
        where: { id: planId },
        select: populatedPlanSelect,
    });

    return { plan: populated as DayPlan, unschedulable: result.unschedulable };
}
