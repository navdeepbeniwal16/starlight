import { prisma } from "../lib/prisma";
import type { BacklogTask, BacklogBuckets, ScheduledTask, TaskDetail, TaskPage, CreateTaskInput, UpdateTaskInput } from "../types/task.types";
import { TaskStatus, Priority } from "@prisma/client";
import { ProjectNotFoundError } from "./project.service";

export class InvalidProgressError extends Error { }
export class InvalidDeadlineError extends Error { }
export class TaskNotFoundError extends Error { }

async function assertProjectOwned(userId: string, projectId: string): Promise<void> {
    const owned = await prisma.project.findFirst({
        where: { id: projectId, userId },
        select: { id: true },
    });
    if (!owned) throw new ProjectNotFoundError();
}

const backlogTaskSelect = {
    id: true,
    title: true,
    status: true,
    priority: true,
    deadline: true,
    progress: true,
    estimatedMins: true,
    projectId: true,
    project: { select: { name: true } },
} as const;

function toBacklogTask<T extends { project: { name: string } | null }>(
    row: T,
): Omit<T, 'project'> & { projectName: string | null } {
    const { project, ...rest } = row;
    return { ...rest, projectName: project?.name ?? null };
}

// Detail carries the same project link as the backlog projections so the edit
// screen's picker can seed from and reflect the persisted assignment.
const taskDetailSelect = { ...backlogTaskSelect, notes: true, effort: true } as const;

const PRIORITY_ORDER: Record<Priority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

// Deadline first (nulls last), then priority (high → low, none last).
function byDeadlineThenPriority(a: BacklogTask, b: BacklogTask): number {
    if (a.deadline || b.deadline) {
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        const cmp = a.deadline.getTime() - b.deadline.getTime();
        if (cmp !== 0) return cmp;
    }
    const pa = a.priority !== null ? PRIORITY_ORDER[a.priority] : 3;
    const pb = b.priority !== null ? PRIORITY_ORDER[b.priority] : 3;
    return pa - pb;
}

// The UTC instant range [start, end) for the client's local day. `utcOffsetMins`
// is +600 for UTC+10; absent → server-local midnight.
function dayRangeUtc(date: string, utcOffsetMins?: number): { start: Date; end: Date } {
    const start = utcOffsetMins !== undefined
        ? new Date(new Date(`${date}T00:00:00Z`).getTime() - utcOffsetMins * 60 * 1000)
        : new Date(`${date}T00:00:00`);
    return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

/**
 * The backlog screen's four lifecycle buckets (carriedOver, scheduled,
 * remaining, doneToday), mutually exclusive with DONE winning. Done tasks from
 * previous days fall into no bucket, so the screen can't grow unbounded.
 *
 * doneToday keys on updatedAt, not a completedAt: editing an old done task
 * resurrects it here — add a completedAt column if that becomes a problem.
 */
export async function getBacklog(userId: string, date: string, utcOffsetMins?: number): Promise<BacklogBuckets> {
    const { start, end } = dayRangeUtc(date, utcOffsetMins);

    const [carriedOver, scheduledRaw, remaining, doneToday] = await Promise.all([
        prisma.task.findMany({
            where: {
                userId,
                status: { not: 'DONE' },
                plannedBlock: { dayPlan: { status: 'ACTIVE', date: { lt: date } } },
            },
            select: backlogTaskSelect,
        }),
        prisma.task.findMany({
            where: {
                userId,
                status: { not: 'DONE' },
                plannedBlock: { dayPlan: { status: 'ACTIVE', date } },
            },
            select: {
                ...backlogTaskSelect,
                blockOrder: true,
                plannedBlock: { select: { startTime: true, name: true } },
            },
        }),
        prisma.task.findMany({
            where: { userId, plannedBlockId: null, status: { not: 'DONE' } },
            select: backlogTaskSelect,
        }),
        prisma.task.findMany({
            where: { userId, status: 'DONE', updatedAt: { gte: start, lt: end } },
            select: backlogTaskSelect,
        }),
    ]);

    const scheduled: ScheduledTask[] = scheduledRaw
        .sort((a, b) =>
            a.plannedBlock!.startTime.localeCompare(b.plannedBlock!.startTime)
            || (a.blockOrder ?? 0) - (b.blockOrder ?? 0))
        .map(({ plannedBlock, blockOrder: _blockOrder, project, ...task }) => ({
            ...task,
            projectName: project?.name ?? null,
            blockStartTime: plannedBlock!.startTime,
            blockName: plannedBlock!.name,
        }));

    return {
        carriedOver: carriedOver.map(toBacklogTask).sort(byDeadlineThenPriority),
        scheduled,
        remaining: remaining.map(toBacklogTask).sort(byDeadlineThenPriority),
        doneToday: doneToday.map(toBacklogTask).sort(byDeadlineThenPriority),
    };
}

export const TASKS_PAGE_SIZE = 30;

export async function getAllTasks(
    userId: string,
    opts?: { cursor?: string; limit?: number },
): Promise<TaskPage> {
    const limit = Math.min(Math.max(opts?.limit ?? TASKS_PAGE_SIZE, 1), 100);

    // Over-fetch by one to learn whether a further page exists without a second query.
    const rows = await prisma.task.findMany({
        where: { userId },
        // id breaks updatedAt ties so the sort is total — a cursor can't skip or repeat rows.
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: backlogTaskSelect,
        take: limit + 1,
        ...(opts?.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
    });

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(toBacklogTask);
    return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

function deriveStatus(progress: number): TaskStatus {
    if (progress === 0) return 'TODO';
    if (progress === 100) return 'DONE';
    return 'IN_PROGRESS';
}

export async function createTask(userId: string, input: CreateTaskInput): Promise<BacklogTask> {
    const progress = input.progress ?? 0;

    if (progress < 0 || progress > 100 || !Number.isInteger(progress)) {
        throw new InvalidProgressError();
    }

    let deadlineDate: Date | undefined;
    if (input.deadline) {
        deadlineDate = new Date(input.deadline);
        if (isNaN(deadlineDate.getTime())) {
            throw new InvalidDeadlineError();
        }
    }

    if (input.projectId) {
        await assertProjectOwned(userId, input.projectId);
    }

    return prisma.task.create({
        data: {
            userId,
            title: input.title.trim(),
            estimatedMins: input.estimatedMins,
            status: deriveStatus(progress),
            progress,
            ...(input.priority && { priority: input.priority }),
            ...(input.effort && { effort: input.effort }),
            ...(deadlineDate && { deadline: deadlineDate }),
            ...(input.notes && { notes: input.notes }),
            ...(input.projectId && { projectId: input.projectId }),
        },
        select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            deadline: true,
            progress: true,
            estimatedMins: true,
        },
    });
}

export async function getTaskById(userId: string, taskId: string): Promise<TaskDetail | null> {
    const row = await prisma.task.findFirst({
        where: { id: taskId, userId },
        select: taskDetailSelect,
    });
    return row ? toBacklogTask(row) : null;
}

export async function deleteTask(userId: string, taskId: string): Promise<void> {
    const result = await prisma.task.deleteMany({ where: { id: taskId, userId } });
    if (result.count === 0) throw new TaskNotFoundError();
}

export async function updateTask(userId: string, taskId: string, input: UpdateTaskInput): Promise<TaskDetail> {
    const existing = await prisma.task.findFirst({ where: { id: taskId, userId }, select: { id: true } });
    if (!existing) throw new TaskNotFoundError();

    const data: Record<string, unknown> = {};

    if (input.title !== undefined) data.title = input.title.trim();
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.estimatedMins !== undefined) data.estimatedMins = input.estimatedMins;
    if (input.priority !== undefined) data.priority = input.priority;
    if (input.effort !== undefined) data.effort = input.effort;

    if (input.deadline !== undefined) {
        if (input.deadline === null) {
            data.deadline = null;
        } else {
            const d = new Date(input.deadline);
            if (isNaN(d.getTime())) throw new InvalidDeadlineError();
            data.deadline = d;
        }
    }

    if (input.progress !== undefined) {
        if (input.progress < 0 || input.progress > 100 || !Number.isInteger(input.progress)) {
            throw new InvalidProgressError();
        }
        data.progress = input.progress;
        data.status = deriveStatus(input.progress);
    }

    if (input.projectId !== undefined) {
        if (input.projectId === null) {
            data.projectId = null;
        } else {
            await assertProjectOwned(userId, input.projectId);
            data.projectId = input.projectId;
        }
    }

    const row = await prisma.task.update({
        where: { id: taskId },
        data,
        select: taskDetailSelect,
    });
    return toBacklogTask(row);
}
