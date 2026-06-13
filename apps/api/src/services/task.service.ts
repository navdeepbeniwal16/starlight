import { prisma } from "../lib/prisma";
import type { BacklogTask, CreateTaskInput } from "../types/task.types";
import { TaskStatus } from "@prisma/client";

export class InvalidProgressError extends Error {}
export class InvalidDeadlineError extends Error {}

export async function getBacklog(userId: string): Promise<BacklogTask[]> {
    return prisma.task.findMany({
        where: { userId },
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

    return prisma.$transaction(async (tx) => {
        const last = await tx.task.findFirst({
            where: { userId },
            orderBy: { order: 'desc' },
            select: { order: true },
        });
        const order = (last?.order ?? 0) + 1;

        return tx.task.create({
            data: {
                userId,
                title: input.title.trim(),
                estimatedMins: input.estimatedMins,
                status: deriveStatus(progress),
                progress,
                order,
                ...(input.priority && { priority: input.priority }),
                ...(input.effort   && { effort: input.effort }),
                ...(deadlineDate   && { deadline: deadlineDate }),
                ...(input.notes    && { notes: input.notes }),
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
    });
}
