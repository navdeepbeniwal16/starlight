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

export type TaskDetail = {
    id: string;
    title: string;
    status: TaskStatus;
    priority: Priority | null;
    deadline: Date | null;
    progress: number | null;
    estimatedMins: number;
    notes: string | null;
    effort: EnergyLevel | null;
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

export type UpdateTaskInput = {
    title?: string;
    notes?: string | null;
    estimatedMins?: number;
    priority?: Priority | null;
    effort?: EnergyLevel | null;
    deadline?: string | null;  // null = clear deadline
    progress?: number;
};
