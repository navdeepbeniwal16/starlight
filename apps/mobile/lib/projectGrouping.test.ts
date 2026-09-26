import { flattenBacklog, groupBacklogByProject, todosCount } from "./projectGrouping";
import type { BacklogBuckets, BacklogTask, Project, ScheduledTask } from "./api.types";

function task(id: string, over: Partial<BacklogTask> = {}): BacklogTask {
    return {
        id,
        title: id,
        status: 'TODO',
        priority: null,
        deadline: null,
        progress: 0,
        estimatedMins: 15,
        projectId: null,
        projectName: null,
        ...over,
    };
}

function project(id: string, over: Partial<Project> = {}): Project {
    return { id, name: id, goal: null, notes: null, isInFocus: false, ...over };
}

function buckets(over: Partial<BacklogBuckets> = {}): BacklogBuckets {
    return { carriedOver: [], scheduled: [], remaining: [], doneToday: [], ...over };
}

describe("flattenBacklog", () => {
    it("concatenates the buckets in lifecycle order", () => {
        const b = buckets({
            carriedOver: [task('c')],
            scheduled: [task('s') as ScheduledTask],
            remaining: [task('r')],
            doneToday: [task('d')],
        });
        expect(flattenBacklog(b).map(t => t.id)).toEqual(['c', 's', 'r', 'd']);
    });
});

describe("groupBacklogByProject", () => {
    it("nests tasks under their project and partitions unassigned into Todos", () => {
        const b = buckets({
            remaining: [
                task('t1', { projectId: 'p1' }),
                task('t2', { projectId: null }),
                task('t3', { projectId: 'p1' }),
            ],
            doneToday: [task('t4', { projectId: 'p2' })],
        });
        const { groups, todos } = groupBacklogByProject(b, [project('p1'), project('p2')]);

        expect(groups.map(g => g.project.id)).toEqual(['p1', 'p2']);
        expect(groups[0].tasks.map(t => t.id)).toEqual(['t1', 't3']);
        expect(groups[1].tasks.map(t => t.id)).toEqual(['t4']);
        expect(todos.map(t => t.id)).toEqual(['t2']);
    });

    it("keeps group order aligned to the projects list, not task order", () => {
        const b = buckets({ remaining: [task('t1', { projectId: 'p2' })] });
        const { groups } = groupBacklogByProject(b, [project('p1'), project('p2')]);
        expect(groups.map(g => g.project.id)).toEqual(['p1', 'p2']);
    });

    it("gives a project with no tasks an empty group so it stays visible", () => {
        const { groups } = groupBacklogByProject(buckets(), [project('p1')]);
        expect(groups).toHaveLength(1);
        expect(groups[0].tasks).toEqual([]);
    });

    it("treats a missing projectId (undefined) as Todos, like null", () => {
        const b = buckets({ remaining: [task('t1', { projectId: undefined })] });
        const { groups, todos } = groupBacklogByProject(b, [project('p1')]);
        expect(todos.map(t => t.id)).toEqual(['t1']);
        expect(groups[0].tasks).toEqual([]);
    });
});

describe("todosCount", () => {
    it("counts only unassigned tasks across all buckets", () => {
        const b = buckets({
            carriedOver: [task('a', { projectId: null })],
            remaining: [task('b', { projectId: 'p1' }), task('c', { projectId: null })],
        });
        expect(todosCount(b)).toBe(2);
    });
});
