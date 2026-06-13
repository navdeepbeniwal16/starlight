import type { Priority, TaskStatus, EnergyLevel } from '@prisma/client';
export type { Priority, TaskStatus, EnergyLevel };

export type BacklogTask = {
    id: string;
    title: string;
    status: TaskStatus;
    priority: Priority | null;
    deadline: Date | null;
    progress: number | null;
    estimatedMins: number;
};

export type CreateTaskInput = {
    title: string;
    estimatedMins: number;
    priority?: Priority;
    effort?: EnergyLevel;
    deadline?: string;   // ISO datetime string
    progress?: number;   // 0–100
    notes?: string;
};
