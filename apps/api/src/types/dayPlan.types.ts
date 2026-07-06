import { BlockType, EnergyLevel, DayPlanStatus, TaskStatus } from '@prisma/client';
export { BlockType, EnergyLevel, DayPlanStatus, TaskStatus } from '@prisma/client';
import type { BacklogTask } from './task.types';

export type ReviewTasks = {
    carriedOver: BacklogTask[];
    backlog: BacklogTask[];
};

export type PlannedTask = {
    id: string;
    title: string;
    estimatedMins: number;
    remainingMins: number;
    blockOrder: number | null;
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

export type UnschedulableTask = {
    taskId: string;
    title: string;
    estimatedMins: number;
    remainingMins: number;
    reason: string;
};

// A task slot inside a proposed (not yet persisted) plan.
export type ProposalTask = {
    id: string;
    title: string;
    estimatedMins: number;
    remainingMins: number;
    status: TaskStatus;
};

// A block of the proposed plan. `blockId` is the *template* block id — the
// proposal is never persisted, so template blocks are the only stable keys the
// client and confirm endpoint can agree on.
export type ProposalBlock = {
    blockId: string;
    type: BlockType;
    name: string;
    startTime: string;
    endTime: string;
    energyLevel: EnergyLevel | null;
    tasks: ProposalTask[];
};

export type PlanProposal = {
    wakeTime: string;
    sleepTime: string;
    blocks: ProposalBlock[];
    unschedulable: UnschedulableTask[];
};

// One task placement sent back by the client at confirm time.
// `blockId` references a template block, matching ProposalBlock.blockId.
export type ConfirmAssignment = {
    taskId: string;
    blockId: string;
    blockOrder: number;
};
