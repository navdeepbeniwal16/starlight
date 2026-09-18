import { create } from "zustand";
import { useTemplateStore } from "./template.store";
import { useOnboardingTasksStore } from "./onboardingTasks.store";

// Session-scoped state that is NOT identity — Clerk owns the user and token.
// Holds the onboarding flag the index gate resolves from GET /me/onboarding, and
// a cross-store reset run at sign-out so the next account never inherits the
// previous user's cached day template or onboarding drafts.
type SessionState = {
    onboardedAt: string | null;
    setOnboardedAt: (onboardedAt: string | null) => void;
    reset: () => void;
};

export const useSessionStore = create<SessionState>((set) => ({
    onboardedAt: null,
    setOnboardedAt: (onboardedAt) => set({ onboardedAt }),
    reset: () => {
        useTemplateStore.getState().clear();
        useOnboardingTasksStore.getState().reset();
        set({ onboardedAt: null });
    },
}));
