import type { BacklogBuckets, BacklogTask, TaskDetail } from "./api.types";

export function withoutTask(buckets: BacklogBuckets, taskId: string): BacklogBuckets {
    return {
        carriedOver: buckets.carriedOver.filter(t => t.id !== taskId),
        scheduled: buckets.scheduled.filter(t => t.id !== taskId),
        remaining: buckets.remaining.filter(t => t.id !== taskId),
        doneToday: buckets.doneToday.filter(t => t.id !== taskId),
    };
}

// A reopened task goes to remaining (not its true bucket) so it stays visible;
// the follow-up refresh, which knows its plan placement, reconciles it.
export function applyToggle(buckets: BacklogBuckets, task: BacklogTask, updated: TaskDetail): BacklogBuckets {
    const next = withoutTask(buckets, task.id);
    const patched: BacklogTask = { ...task, status: updated.status, progress: updated.progress };
    if (updated.status === 'DONE') {
        next.doneToday = [patched, ...next.doneToday];
    } else {
        next.remaining = [patched, ...next.remaining];
    }
    return next;
}

export function applyCreated(buckets: BacklogBuckets, task: BacklogTask): BacklogBuckets {
    return task.status === 'DONE'
        ? { ...buckets, doneToday: [task, ...buckets.doneToday] }
        : { ...buckets, remaining: [...buckets.remaining, task] };
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
