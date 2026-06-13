import type { Priority, TaskStatus } from '@prisma/client';
export type { Priority, TaskStatus };

export type BacklogTask = {
    id: string;
    title: string;
    status: TaskStatus;
    priority: Priority | null;
    deadline: Date | null;
    progress: number | null;
    estimatedMins: number;
};
