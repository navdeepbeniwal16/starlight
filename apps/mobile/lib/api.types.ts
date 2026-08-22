export type ApiResult<T> = { ok: true, data: T } | { ok: false, error: string, status?: number };

export type SignupResponse = ApiResult<{
    token: string;
    user: {
        id: string
        email: string;
        firstName: string;
        lastName: string;
    }
}>;

export type LoginResponse = ApiResult<{
    token: string;
    user: {
        id: string;
        email: string;
        firstName: string;
        lastName: string;
    }
}>;

export type MeResponse = ApiResult<{
    id: string,
    email: string,
    firstName: string,
    lastName: string
}>;

export type BlockType = 'CONTAINER' | 'ANCHOR' | 'NO_TASK';
export type EnergyLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export type BlockInput = {
    type: BlockType;
    name: string;
    startTime: string;
    endTime: string;
    energyLevel?: EnergyLevel;
};

export type DayTemplateBlock = BlockInput & { id: string };

export type DayTemplate = {
    id: string;
    wakeTime: string;
    sleepTime: string;
    blocks: DayTemplateBlock[];
};

export type GetDayTemplateResponse = ApiResult<DayTemplate>;
export type CreateDayTemplateResponse = ApiResult<DayTemplate>;
export type UpdateDayTemplateResponse = ApiResult<DayTemplate>;

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type DayPlanStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED';

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

export type GetDayPlanResponse = ApiResult<DayPlan>;
export type ConfirmPlanResponse = ApiResult<DayPlan>;

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

// A block of the proposed plan. `blockId` is the template block id — the
// proposal is never persisted, so template blocks are the only stable keys
// shared with the confirm endpoint.
export type ProposalBlock = {
    blockId: string;
    type: BlockType;
    name: string;
    startTime: string;
    endTime: string;
    energyLevel: EnergyLevel | null;
    tasks: ProposalTask[];
};

// The full output of plan generation. Held client-side during review;
// nothing about it exists on the server until confirm.
export type PlanProposal = {
    wakeTime: string;
    sleepTime: string;
    blocks: ProposalBlock[];
    unschedulable: UnschedulableTask[];
};
export type GeneratePlanResponse = ApiResult<PlanProposal>;

// One task placement sent to the confirm endpoint. `blockId` references a
// template block, matching ProposalBlock.blockId.
export type ConfirmAssignment = {
    taskId: string;
    blockId: string;
    blockOrder: number;
};

export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';

export type BacklogTask = {
    id: string;
    title: string;
    status: TaskStatus;
    priority: Priority | null;
    deadline: string | null;  // ISO datetime string (YYYY-MM-DDT00:00:00.000Z)
    progress: number | null;  // 0–100
    estimatedMins: number;
};

export type ScheduledTask = BacklogTask & {
    blockStartTime: string;  // HH:mm
    blockName: string;
};

// Server-computed, mutually exclusive; the client renders each array as-is.
export type BacklogBuckets = {
    carriedOver: BacklogTask[];
    scheduled: ScheduledTask[];
    remaining: BacklogTask[];
    doneToday: BacklogTask[];
};

export type GetBacklogResponse = ApiResult<BacklogBuckets>;

export type GetAllTasksResponse = ApiResult<BacklogTask[]>;

export type CreateTaskInput = {
    title: string;
    estimatedMins: number;
    priority?: Priority;
    effort?: EnergyLevel;
    deadline?: string;   // ISO datetime string
    progress?: number;   // 0–100
    notes?: string;
};

export type CreateTaskResponse = ApiResult<BacklogTask>;

export type TaskDetail = BacklogTask & {
    notes: string | null;
    effort: EnergyLevel | null;
};
export type GetTaskDetailResponse = ApiResult<TaskDetail>;

export type ReviewTask = BacklogTask;

export type ReviewTasksData = {
    carriedOver: ReviewTask[];
    backlog: ReviewTask[];
};
export type GetReviewTasksResponse = ApiResult<ReviewTasksData>;

export type UpdateTaskInput = {
    title?: string;
    notes?: string | null;
    estimatedMins?: number;
    priority?: Priority | null;
    effort?: EnergyLevel | null;
    deadline?: string | null;
    progress?: number;
};
export type UpdateTaskResponse = ApiResult<TaskDetail>;
