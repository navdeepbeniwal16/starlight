import type { Project } from "./api.types";

// The task Project picker. A `null` id is Todos — the unassigned default — so the picker
// stays low-friction: choosing nothing (or clearing) leaves the task in Todos.
export const TODOS_LABEL = "Todos";

export type ProjectPickerOption = {
    id: string | null;
    label: string;
};

// Todos leads, then one option per project in the given order (the server's createdAt
// order, mirroring the Backlog's Groups view).
export function projectPickerOptions(projects: Project[]): ProjectPickerOption[] {
    return [
        { id: null, label: TODOS_LABEL },
        ...projects.map(p => ({ id: p.id, label: p.name })),
    ];
}

// The FieldRow value for the current selection. A null/undefined or unresolvable id
// (e.g. its project was deleted server-side) degrades to Todos.
export function selectedProjectLabel(projects: Project[], projectId: string | null | undefined): string {
    if (projectId == null) return TODOS_LABEL;
    return projects.find(p => p.id === projectId)?.name ?? TODOS_LABEL;
}
