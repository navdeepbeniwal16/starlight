import { create } from "zustand";

// One task the user drafted during onboarding. `id` is a stable client id so the
// pool is mutated by identity, never array index: hydrate() reorders the pool and
// the create loop stamps serverIds mid-flight, so an index-keyed write would land
// on the wrong entry. `serverId` is set once the task has been persisted, so a
// re-plan (after adjusting the day) reuses the existing backlog task instead of
// creating a duplicate.
export type OnboardingTask = {
    id: string;
    title: string;
    estimatedMins: number;
    serverId: string | null;
};

// Survives the first-task -> build round-trip a user takes when their day window
// has already elapsed: the pool would otherwise be lost on remount, stranding
// tasks that were already created in the backlog. Cleared when onboarding is
// confirmed.
type OnboardingTasksState = {
    pool: OnboardingTask[];
    hydrate: (saved: { title: string; estimatedMins: number; serverId: string }[]) => void;
    addTask: (task: { title: string; estimatedMins: number }) => void;
    removeTask: (id: string) => void;
    markCreated: (id: string, serverId: string) => void;
    reset: () => void;
};

let idSeq = 0;
const nextId = () => `otask_${++idSeq}`;

export const useOnboardingTasksStore = create<OnboardingTasksState>((set) => ({
    pool: [],
    // Reconcile with the backlog (the source of truth for what gets scheduled):
    // persisted tasks come authoritatively from `saved`, and any not-yet-created
    // drafts the user is still holding are kept ahead of a lost local state.
    hydrate: (saved) =>
        set((s) => ({
            pool: [...saved.map((t) => ({ ...t, id: nextId() })), ...s.pool.filter((t) => t.serverId === null)],
        })),
    addTask: (task) => set((s) => ({ pool: [...s.pool, { ...task, id: nextId(), serverId: null }] })),
    removeTask: (id) => set((s) => ({ pool: s.pool.filter((t) => t.id !== id) })),
    markCreated: (id, serverId) =>
        set((s) => ({ pool: s.pool.map((t) => (t.id === id ? { ...t, serverId } : t)) })),
    reset: () => set({ pool: [] }),
}));
