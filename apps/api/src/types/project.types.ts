export type CreateProjectInput = {
    name: string;
    goal?: string;
};

export type UpdateProjectInput = {
    name?: string;
    goal?: string | null;  // null = clear goal
};

export type ProjectDetail = {
    id: string;
    name: string;
    goal: string | null;
    isInFocus: boolean;
};
