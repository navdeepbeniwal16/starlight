import type { BacklogBuckets, BacklogTask, TaskDetail } from "./api.types";

export function withoutTask(buckets: BacklogBuckets, taskId: string): BacklogBuckets {
    return {
        carriedOver: buckets.carriedOver.filter(t => t.id !== taskId),
        scheduled: buckets.scheduled.filter(t => t.id !== taskId),
        remaining: buckets.remaining.filter(t => t.id !== taskId),
        doneToday: buckets.doneToday.filter(t => t.id !== taskId),
    };
}

// `dest` is where the mutation optimistically places the task, so the caller's
// arrival cue reveals exactly that bucket. `settled` says whether `dest` is the
// task's final home: when false, only the next refresh knows the true bucket, so
// the caller must re-target the cue against reconciled data (see bucketOf).
export type Placement = { buckets: BacklogBuckets; dest: 'doneToday' | 'remaining'; settled: boolean };

// A reopened task goes to remaining (not its true bucket) so it stays visible;
// the follow-up refresh, which knows its plan placement, reconciles it — hence
// `settled` is only true for a completion, whose doneToday home is authoritative.
export function applyToggle(buckets: BacklogBuckets, task: BacklogTask, updated: TaskDetail): Placement {
    const next = withoutTask(buckets, task.id);
    const patched: BacklogTask = { ...task, status: updated.status, progress: updated.progress };
    const done = updated.status === 'DONE';
    const dest = done ? 'doneToday' : 'remaining';
    next[dest] = [patched, ...next[dest]];
    return { buckets: next, dest, settled: done };
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
