import { applyCreated, applyToggle, bucketOf, createSequencer, groupForReconcile, withoutTask } from "./backlogState";
import type { BacklogBuckets, BacklogTask, ScheduledTask, TaskDetail } from "./api.types";

function task(id: string, over: Partial<BacklogTask> = {}): BacklogTask {
    return {
        id,
        title: id,
        status: 'TODO',
        priority: null,
        deadline: null,
        progress: 0,
        estimatedMins: 30,
        ...over,
    };
}

function scheduled(id: string): ScheduledTask {
    return { ...task(id), blockStartTime: '09:00', blockName: 'Deep Work' };
}

function detail(over: Partial<TaskDetail>): TaskDetail {
    return {
        id: 't', title: 't', status: 'TODO', priority: null, deadline: null,
        progress: 0, estimatedMins: 30, notes: null, effort: null, ...over,
    };
}

function empty(): BacklogBuckets {
    return { carriedOver: [], scheduled: [], remaining: [], doneToday: [] };
}

describe("groupForReconcile", () => {
    it("routes carried-over, scheduled, and in-progress remaining into pickUp", () => {
        const buckets: BacklogBuckets = {
            carriedOver: [task('a')],
            scheduled: [scheduled('b')],
            remaining: [task('c', { status: 'IN_PROGRESS', progress: 40 }), task('d')],
            doneToday: [task('e', { status: 'DONE', progress: 100 })],
        };
        const groups = groupForReconcile(buckets);
        expect(groups.pickUp.map(t => t.id)).toEqual(['a', 'b', 'c']);
        expect(groups.everythingElse.map(t => t.id)).toEqual(['d']);
        expect(groups.doneToday.map(t => t.id)).toEqual(['e']);
    });

    it("puts only todo remaining into everythingElse", () => {
        const buckets: BacklogBuckets = {
            carriedOver: [],
            scheduled: [],
            remaining: [task('a'), task('b', { status: 'IN_PROGRESS', progress: 20 })],
            doneToday: [],
        };
        const groups = groupForReconcile(buckets);
        expect(groups.everythingElse.map(t => t.id)).toEqual(['a']);
        expect(groups.pickUp.map(t => t.id)).toEqual(['b']);
    });

    it("does not mutate the input buckets", () => {
        const buckets = { ...empty(), remaining: [task('a'), task('b', { status: 'IN_PROGRESS' })] };
        groupForReconcile(buckets);
        expect(buckets.remaining.map(t => t.id)).toEqual(['a', 'b']);
    });
});

describe("withoutTask", () => {
    it("removes the task from every bucket and leaves others untouched", () => {
        const buckets: BacklogBuckets = {
            carriedOver: [task('a')],
            scheduled: [scheduled('b')],
            remaining: [task('c'), task('a')],
            doneToday: [task('d')],
        };
        const next = withoutTask(buckets, 'a');
        expect(next.carriedOver).toHaveLength(0);
        expect(next.remaining.map(t => t.id)).toEqual(['c']);
        expect(next.scheduled.map(t => t.id)).toEqual(['b']);
        expect(next.doneToday.map(t => t.id)).toEqual(['d']);
    });

    it("does not mutate the input", () => {
        const buckets = { ...empty(), remaining: [task('a')] };
        withoutTask(buckets, 'a');
        expect(buckets.remaining).toHaveLength(1);
    });
});

describe("applyToggle", () => {
    it("moves a completed task to the top of doneToday, settled (doneToday is authoritative)", () => {
        const buckets = { ...empty(), scheduled: [scheduled('a')], doneToday: [task('old')] };
        const { buckets: next, dest, settled } = applyToggle(buckets, buckets.scheduled[0], detail({ id: 'a', status: 'DONE', progress: 100 }));
        expect(dest).toBe('doneToday');
        expect(settled).toBe(true);
        expect(next.scheduled).toHaveLength(0);
        expect(next.doneToday.map(t => t.id)).toEqual(['a', 'old']);
        expect(next.doneToday[0]).toMatchObject({ status: 'DONE', progress: 100 });
    });

    it("parks a reopened task in remaining but is unsettled (true bucket known only on refresh)", () => {
        const buckets = { ...empty(), doneToday: [task('a', { status: 'DONE', progress: 100 })] };
        const { buckets: next, dest, settled } = applyToggle(buckets, buckets.doneToday[0], detail({ id: 'a', status: 'IN_PROGRESS', progress: 75 }));
        expect(dest).toBe('remaining');
        expect(settled).toBe(false);
        expect(next.doneToday).toHaveLength(0);
        expect(next.remaining.map(t => t.id)).toEqual(['a']);
        expect(next.remaining[0]).toMatchObject({ status: 'IN_PROGRESS', progress: 75 });
    });

    it("does not mutate the input buckets", () => {
        const buckets = { ...empty(), scheduled: [scheduled('a')] };
        applyToggle(buckets, buckets.scheduled[0], detail({ id: 'a', status: 'DONE', progress: 100 }));
        expect(buckets.scheduled).toHaveLength(1);
        expect(buckets.doneToday).toHaveLength(0);
    });
});

describe("applyCreated", () => {
    it("adds an open task to the end of remaining", () => {
        const buckets = { ...empty(), remaining: [task('a')] };
        const { buckets: next, dest } = applyCreated(buckets, task('b'));
        expect(dest).toBe('remaining');
        expect(next.remaining.map(t => t.id)).toEqual(['a', 'b']);
    });

    it("adds a done task to the top of doneToday", () => {
        const buckets = { ...empty(), doneToday: [task('a', { status: 'DONE' })] };
        const { buckets: next, dest } = applyCreated(buckets, task('b', { status: 'DONE', progress: 100 }));
        expect(dest).toBe('doneToday');
        expect(next.doneToday.map(t => t.id)).toEqual(['b', 'a']);
    });
});

describe("bucketOf", () => {
    it("finds the bucket a task currently occupies", () => {
        const buckets = { ...empty(), scheduled: [scheduled('a')], remaining: [task('b')] };
        expect(bucketOf(buckets, 'a')).toBe('scheduled');
        expect(bucketOf(buckets, 'b')).toBe('remaining');
    });

    it("returns null when the task is absent", () => {
        expect(bucketOf(empty(), 'ghost')).toBeNull();
    });
});

describe("createSequencer", () => {
    it("treats only the most recently issued token as current", () => {
        const seq = createSequencer();
        const first = seq.next();
        const second = seq.next();
        expect(seq.isCurrent(second)).toBe(true);
        expect(seq.isCurrent(first)).toBe(false);
    });

    it("keeps the newest current even when an older token is checked afterwards", () => {
        const seq = createSequencer();
        const a = seq.next();
        const b = seq.next();
        // b resolves, then the slower a resolves — a must not be applied.
        expect(seq.isCurrent(b)).toBe(true);
        expect(seq.isCurrent(a)).toBe(false);
    });
});
