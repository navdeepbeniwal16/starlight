import { applyCreated, applyProgress, applyToggle, bucketOf, createSequencer, groupForReconcile, patchTask, restoreTask, withoutTask } from "./backlogState";
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

    it("drops a deleted task from the reconcile group its bucket feeds", () => {
        const buckets: BacklogBuckets = {
            carriedOver: [],
            scheduled: [scheduled('a')],
            remaining: [task('b'), task('c', { status: 'IN_PROGRESS', progress: 40 })],
            doneToday: [task('d', { status: 'DONE', progress: 100 })],
        };
        const groups = groupForReconcile(withoutTask(buckets, 'c'));
        expect(groups.pickUp.map(t => t.id)).toEqual(['a']);
        expect(groups.everythingElse.map(t => t.id)).toEqual(['b']);
        expect(groups.doneToday.map(t => t.id)).toEqual(['d']);
    });

    it("removes a deleted task from the doneToday group", () => {
        const buckets = { ...empty(), doneToday: [task('a', { status: 'DONE' }), task('b', { status: 'DONE' })] };
        const groups = groupForReconcile(withoutTask(buckets, 'a'));
        expect(groups.doneToday.map(t => t.id)).toEqual(['b']);
    });
});

describe("restoreTask", () => {
    it("puts a deleted task back at its original slot in its bucket", () => {
        const snapshot = { ...empty(), remaining: [task('a'), task('b'), task('c')] };
        const current = withoutTask(snapshot, 'b');
        const next = restoreTask(current, snapshot, 'b');
        expect(next.remaining.map(t => t.id)).toEqual(['a', 'b', 'c']);
    });

    it("keeps concurrent edits to other cards made while the delete was in flight", () => {
        const snapshot = { ...empty(), remaining: [task('a'), task('b')] };
        const current = patchTask(withoutTask(snapshot, 'a'), 'b', detail({ id: 'b', status: 'IN_PROGRESS', progress: 50 }));
        const next = restoreTask(current, snapshot, 'a');
        expect(next.remaining.map(t => t.id)).toEqual(['a', 'b']);
        expect(next.remaining[1]).toMatchObject({ status: 'IN_PROGRESS', progress: 50 });
    });

    it("restores into the correct typed bucket", () => {
        const snapshot = { ...empty(), scheduled: [scheduled('a'), scheduled('b')] };
        const next = restoreTask(withoutTask(snapshot, 'a'), snapshot, 'a');
        expect(next.scheduled.map(t => t.id)).toEqual(['a', 'b']);
        expect(next.scheduled[0]).toMatchObject({ blockStartTime: '09:00', blockName: 'Deep Work' });
    });

    it("no-ops when a refetch already brought the task back", () => {
        const snapshot = { ...empty(), remaining: [task('a')] };
        const current = { ...empty(), remaining: [task('a')] };
        const next = restoreTask(current, snapshot, 'a');
        expect(next.remaining.map(t => t.id)).toEqual(['a']);
    });

    it("does not mutate current", () => {
        const snapshot = { ...empty(), remaining: [task('a'), task('b')] };
        const current = withoutTask(snapshot, 'a');
        restoreTask(current, snapshot, 'a');
        expect(current.remaining.map(t => t.id)).toEqual(['b']);
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

describe("applyProgress", () => {
    it("sends a completed task (100) to the top of doneToday, settled", () => {
        const buckets = { ...empty(), remaining: [task('a', { status: 'IN_PROGRESS', progress: 40 })], doneToday: [task('old', { status: 'DONE', progress: 100 })] };
        const { buckets: next, dest, settled } = applyProgress(buckets, buckets.remaining[0], detail({ id: 'a', status: 'DONE', progress: 100 }));
        expect(dest).toBe('doneToday');
        expect(settled).toBe(true);
        expect(next.remaining).toHaveLength(0);
        expect(next.doneToday.map(t => t.id)).toEqual(['a', 'old']);
        expect(next.doneToday[0]).toMatchObject({ status: 'DONE', progress: 100 });
    });

    it("parks a partially-progressed task (1–99) in remaining as in-progress, unsettled", () => {
        const buckets = { ...empty(), remaining: [task('a')] };
        const { buckets: next, dest, settled } = applyProgress(buckets, buckets.remaining[0], detail({ id: 'a', status: 'IN_PROGRESS', progress: 50 }));
        expect(dest).toBe('remaining');
        expect(settled).toBe(false);
        expect(next.remaining[0]).toMatchObject({ status: 'IN_PROGRESS', progress: 50 });
    });

    it("returns a cleared task (0) to remaining as todo", () => {
        const buckets = { ...empty(), remaining: [task('a', { status: 'IN_PROGRESS', progress: 60 })] };
        const { buckets: next, dest } = applyProgress(buckets, buckets.remaining[0], detail({ id: 'a', status: 'TODO', progress: 0 }));
        expect(dest).toBe('remaining');
        expect(next.remaining[0]).toMatchObject({ status: 'TODO', progress: 0 });
    });

    it("does not mutate the input buckets", () => {
        const buckets = { ...empty(), remaining: [task('a')] };
        applyProgress(buckets, buckets.remaining[0], detail({ id: 'a', status: 'DONE', progress: 100 }));
        expect(buckets.remaining).toHaveLength(1);
        expect(buckets.doneToday).toHaveLength(0);
    });
});

describe("patchTask", () => {
    it("updates status and progress without changing bucket or order", () => {
        const buckets = { ...empty(), remaining: [task('a'), task('b'), task('c')] };
        const next = patchTask(buckets, 'b', detail({ id: 'b', status: 'IN_PROGRESS', progress: 50 }));
        expect(next.remaining.map(t => t.id)).toEqual(['a', 'b', 'c']);
        expect(next.remaining[1]).toMatchObject({ status: 'IN_PROGRESS', progress: 50 });
    });

    it("patches a task wherever it sits", () => {
        const buckets = { ...empty(), scheduled: [scheduled('a')] };
        const next = patchTask(buckets, 'a', detail({ id: 'a', status: 'IN_PROGRESS', progress: 30 }));
        expect(next.scheduled[0]).toMatchObject({ status: 'IN_PROGRESS', progress: 30 });
    });

    it("does not mutate the input buckets", () => {
        const buckets = { ...empty(), remaining: [task('a')] };
        patchTask(buckets, 'a', detail({ id: 'a', status: 'IN_PROGRESS', progress: 50 }));
        expect(buckets.remaining[0]).toMatchObject({ status: 'TODO', progress: 0 });
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
