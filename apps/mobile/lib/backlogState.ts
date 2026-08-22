import type { BacklogBuckets, BacklogTask, TaskDetail } from "./api.types";

// Presentation-only regrouping of the four server buckets; never round-trips.
export type ReconcileGroups = {
    pickUp: BacklogTask[];
    everythingElse: BacklogTask[];
    doneToday: BacklogTask[];
};

export function groupForReconcile(buckets: BacklogBuckets): ReconcileGroups {
    return {
        pickUp: [
            ...buckets.carriedOver,
            ...buckets.scheduled,
            ...buckets.remaining.filter(t => t.status === 'IN_PROGRESS'),
        ],
        everythingElse: buckets.remaining.filter(t => t.status === 'TODO'),
        doneToday: buckets.doneToday,
    };
}

export function withoutTask(buckets: BacklogBuckets, taskId: string): BacklogBuckets {
    return {
        carriedOver: buckets.carriedOver.filter(t => t.id !== taskId),
        scheduled: buckets.scheduled.filter(t => t.id !== taskId),
        remaining: buckets.remaining.filter(t => t.id !== taskId),
        doneToday: buckets.doneToday.filter(t => t.id !== taskId),
    };
}

// Undo for an optimistic delete: puts the task back at its snapshot slot, merging
// into `current` so edits made to other cards while the delete was in flight aren't
// lost to a blanket snapshot restore. No-ops if a refetch already brought it back.
export function restoreTask(current: BacklogBuckets, snapshot: BacklogBuckets, taskId: string): BacklogBuckets {
    if (bucketOf(current, taskId)) return current;
    const reinsert = <T extends BacklogTask>(cur: T[], snap: T[]): T[] => {
        const i = snap.findIndex(t => t.id === taskId);
        if (i === -1) return cur;
        const next = [...cur];
        next.splice(Math.min(i, next.length), 0, snap[i]);
        return next;
    };
    return {
        carriedOver: reinsert(current.carriedOver, snapshot.carriedOver),
        scheduled: reinsert(current.scheduled, snapshot.scheduled),
        remaining: reinsert(current.remaining, snapshot.remaining),
        doneToday: reinsert(current.doneToday, snapshot.doneToday),
    };
}

// `dest` is where the mutation optimistically places the task, so the caller's
// arrival cue reveals exactly that bucket. `settled` says whether `dest` is the
// task's final home: when false, only the next refresh knows the true bucket, so
// the caller must re-target the cue against reconciled data (see bucketOf).
export type Placement = { buckets: BacklogBuckets; dest: 'doneToday' | 'remaining'; settled: boolean };

export function applyProgress(buckets: BacklogBuckets, task: BacklogTask, updated: TaskDetail): Placement {
    const next = withoutTask(buckets, task.id);
    const patched: BacklogTask = { ...task, status: updated.status, progress: updated.progress };
    const done = updated.status === 'DONE';
    const dest = done ? 'doneToday' : 'remaining';
    next[dest] = [patched, ...next[dest]];
    return { buckets: next, dest, settled: done };
}

export function applyToggle(buckets: BacklogBuckets, task: BacklogTask, updated: TaskDetail): Placement {
    return applyProgress(buckets, task, updated);
}

// Updates a task where it sits, preserving its bucket and order, so scrubbing an
// already-in-progress card doesn't yank it to the top. A todo crossing into
// in-progress still regroups via groupForReconcile — commitProgress animates that.
export function patchTask(buckets: BacklogBuckets, taskId: string, updated: TaskDetail): BacklogBuckets {
    const patch = <T extends BacklogTask>(t: T): T =>
        t.id === taskId ? { ...t, status: updated.status, progress: updated.progress } : t;
    return {
        carriedOver: buckets.carriedOver.map(patch),
        scheduled: buckets.scheduled.map(patch),
        remaining: buckets.remaining.map(patch),
        doneToday: buckets.doneToday.map(patch),
    };
}

export function applyCreated(buckets: BacklogBuckets, task: BacklogTask): Placement {
    return task.status === 'DONE'
        ? { buckets: { ...buckets, doneToday: [task, ...buckets.doneToday] }, dest: 'doneToday', settled: true }
        : { buckets: { ...buckets, remaining: [...buckets.remaining, task] }, dest: 'remaining', settled: true };
}

// The bucket a task currently sits in, or null if absent — used to re-target the
// arrival cue after a refresh reconciles an optimistic move to its true bucket.
export function bucketOf(buckets: BacklogBuckets, taskId: string): keyof BacklogBuckets | null {
    for (const key of Object.keys(buckets) as (keyof BacklogBuckets)[]) {
        if (buckets[key].some(t => t.id === taskId)) return key;
    }
    return null;
}

// Token gate so out-of-order fetch responses can't clobber fresher state: only
// the most recently issued token is current().
export type Sequencer = { next: () => number; isCurrent: (token: number) => boolean };

export function createSequencer(): Sequencer {
    let latest = 0;
    return {
        next: () => ++latest,
        isCurrent: (token: number) => token === latest,
    };
}
