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
