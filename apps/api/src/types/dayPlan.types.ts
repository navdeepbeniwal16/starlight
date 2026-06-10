import { BlockType, EnergyLevel, DayPlanStatus, TaskStatus } from '@prisma/client';
export { BlockType, EnergyLevel, DayPlanStatus, TaskStatus } from '@prisma/client';

export type PlannedTask = {
    id: string;
    title: string;
    estimatedMins: number;
    order: number;
    status: TaskStatus;
};

export type PlannedBlock = {
    id: string;
    type: BlockType;
    name: string;
    startTime: string;
    endTime: string;
    energyLevel: EnergyLevel | null;
    tasks: PlannedTask[];
};

export type DayPlan = {
    id: string;
    date: string;
    wakeTime: string;
    sleepTime: string;
    status: DayPlanStatus;
    blocks: PlannedBlock[];
};
