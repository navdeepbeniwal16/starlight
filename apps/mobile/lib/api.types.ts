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
