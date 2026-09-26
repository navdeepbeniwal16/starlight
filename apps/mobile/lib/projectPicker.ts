import type { Project } from "./api.types";

// The task project picker. A `null` id means unassigned; the picker presents that as a
// neutral "None" clear option rather than "Todos", because Todos is only a grouping in
// the Backlog's Groups view — not a project a task can belong to.
export const NONE_LABEL = "None";

export type ProjectPickerOption = {
    id: string | null;
    label: string;
};

export function projectPickerOptions(projects: Project[]): ProjectPickerOption[] {
    return [
        { id: null, label: NONE_LABEL },
        ...projects.map(p => ({ id: p.id, label: p.name })),
    ];
}

// The FieldRow value for the current selection. A null/undefined or unresolvable id
// (e.g. its project was deleted server-side) reads as unassigned.
export function selectedProjectLabel(projects: Project[], projectId: string | null | undefined): string {
    if (projectId == null) return NONE_LABEL;
    return projects.find(p => p.id === projectId)?.name ?? NONE_LABEL;
}
