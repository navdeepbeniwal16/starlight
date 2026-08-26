import { create } from "zustand";
import { deleteToken, saveToken } from "../lib/auth-token";
import { useTemplateStore } from "./template.store";
import { useOnboardingTasksStore } from "./onboardingTasks.store";

type User = {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    onboardedAt: string | null;
};

type AuthState = {
    user: User | null;
    token: string | null;
    setAuth: (user: User, token: string) => Promise<void>;
    clearAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
    user: null,
    token: null,

    setAuth: async (user, token) => {
        await saveToken(token);
        useTemplateStore.getState().clear();
        useOnboardingTasksStore.getState().reset();
        set({ user, token });
    },

    clearAuth: async () => {
        await deleteToken();
        set({ user: null, token: null });
    }
}));