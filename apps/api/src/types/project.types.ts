export type CreateProjectInput = {
    name: string;
    goal?: string;
};

export type ProjectDetail = {
    id: string;
    name: string;
    goal: string | null;
    isInFocus: boolean;
};
