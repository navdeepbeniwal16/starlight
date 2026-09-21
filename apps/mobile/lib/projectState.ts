import type { Project } from "./api.types";

// The server caps in-focus projects at 3 (STA-13). The client mirrors the cap so
// the list can show remaining capacity (e.g. "2/3") and block a 4th toggle before
// it round-trips — the server 409 stays the source of truth.
export const MAX_IN_FOCUS = 3;

export function inFocusCount(projects: Project[]): number {
    return projects.filter(p => p.isInFocus).length;
}

export function focusCapReached(projects: Project[]): boolean {
    return inFocusCount(projects) >= MAX_IN_FOCUS;
}

// Turning a project ON is blocked only when it isn't already focused and the cap
// is full; turning one OFF is always allowed since it frees capacity — this is what
// lets the user swap focus without leaving the screen.
export function focusToggleBlocked(projects: Project[], projectId: string): boolean {
    const project = projects.find(p => p.id === projectId);
    if (!project || project.isInFocus) return false;
    return focusCapReached(projects);
}

// Optimistic list edits, mirroring lib/backlogState. Each returns a new array so
// the screen can apply the change immediately and reconcile on the next fetch.

export function applyCreated(projects: Project[], project: Project): Project[] {
    // GET /projects orders by createdAt asc, so a freshly created project sorts last.
    return [...projects, project];
}

export function replaceProject(projects: Project[], updated: Project): Project[] {
    return projects.map(p => (p.id === updated.id ? updated : p));
}

export function withoutProject(projects: Project[], projectId: string): Project[] {
    return projects.filter(p => p.id !== projectId);
}

// Optimistic focus flip before the server confirms; reconciled by the response, or
// reverted by flipping back on failure.
export function setFocus(projects: Project[], projectId: string, isInFocus: boolean): Project[] {
    return projects.map(p => (p.id === projectId ? { ...p, isInFocus } : p));
}
