import { create } from "zustand";

// One task the user drafted during onboarding. `serverId` is set once the task
// has been persisted, so a re-plan (after adjusting the day) reuses the existing
// backlog task instead of creating a duplicate.
export type OnboardingTask = {
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
    hydrate: (saved: OnboardingTask[]) => void;
    addTask: (task: { title: string; estimatedMins: number }) => void;
    removeTask: (index: number) => void;
    markCreated: (index: number, serverId: string) => void;
    reset: () => void;
};

export const useOnboardingTasksStore = create<OnboardingTasksState>((set) => ({
    pool: [],
    // Reconcile with the backlog (the source of truth for what gets scheduled):
    // persisted tasks come authoritatively from `saved`, and any not-yet-created
    // drafts the user is still holding are kept ahead of a lost local state.
    hydrate: (saved) =>
        set((s) => ({ pool: [...saved, ...s.pool.filter((t) => t.serverId === null)] })),
    addTask: (task) => set((s) => ({ pool: [...s.pool, { ...task, serverId: null }] })),
    removeTask: (index) => set((s) => ({ pool: s.pool.filter((_, i) => i !== index) })),
    markCreated: (index, serverId) =>
        set((s) => ({ pool: s.pool.map((t, i) => (i === index ? { ...t, serverId } : t)) })),
    reset: () => set({ pool: [] }),
}));
