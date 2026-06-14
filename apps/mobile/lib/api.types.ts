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

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type DayPlanStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED';

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

export type GetDayPlanResponse = ApiResult<DayPlan>;

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

export type GetBacklogResponse = ApiResult<BacklogTask[]>;

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
