import type { BacklogBuckets, BacklogTask, Project } from "./api.types";

// Regroupings of the backlog by project for the Groups view. Pure and presentation-
// only — never round-trips; the server stays the source of truth for bucket membership.

export type ProjectGroup = { project: Project; tasks: BacklogTask[] };
export type GroupedBacklog = { groups: ProjectGroup[]; todos: BacklogTask[] };

// The four lifecycle buckets as one list. They are mutually exclusive server-side, so
// a task appears exactly once; order follows lifecycle (carried over → scheduled →
// remaining → done today), which reads sensibly once nested under a project.
export function flattenBacklog(buckets: BacklogBuckets): BacklogTask[] {
    return [
        ...buckets.carriedOver,
        ...buckets.scheduled,
        ...buckets.remaining,
        ...buckets.doneToday,
    ];
}

// Group backlog tasks under their project, partitioning unassigned tasks into Todos.
// Group order mirrors `projects` (the server's createdAt order); a project with no
// tasks still gets an empty group so it stays visible and manageable.
export function groupBacklogByProject(buckets: BacklogBuckets, projects: Project[]): GroupedBacklog {
    const byProject = new Map<string, BacklogTask[]>();
    const todos: BacklogTask[] = [];

    for (const task of flattenBacklog(buckets)) {
        if (task.projectId == null) {
            todos.push(task);
            continue;
        }
        const existing = byProject.get(task.projectId);
        if (existing) existing.push(task);
        else byProject.set(task.projectId, [task]);
    }

    const groups = projects.map(project => ({
        project,
        tasks: byProject.get(project.id) ?? [],
    }));

    return { groups, todos };
}

// Count of tasks not assigned to any project — the Todos tally shown in both views.
export function todosCount(buckets: BacklogBuckets): number {
    return flattenBacklog(buckets).filter(t => t.projectId == null).length;
}
