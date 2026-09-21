export type CreateProjectInput = {
    name: string;
    goal?: string;
    notes?: string;
};

export type UpdateProjectInput = {
    name?: string;
    goal?: string | null;   // null = clear goal
    notes?: string | null;  // null = clear notes
};

export type ProjectDetail = {
    id: string;
    name: string;
    goal: string | null;
    notes: string | null;
    isInFocus: boolean;
};
