import { create } from "zustand";
import { deleteToken, saveToken } from "../lib/auth-token";

type User = {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
};

type AuthState = {
    user: User | null;
    token: string | null;
    setAuth: (user: User, token: string) => Promise<void>;
    clearAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
    // Initial state
    user: null,
    token: null,

    // Persists token to SecureStore first, then updates in-memory state
    setAuth: async (user, token) => {
        await saveToken(token);
        set({user, token});
    },

    // Deletes token from SecureStore first, then wipes in-memory state
    clearAuth: async () => {
        await deleteToken();
        set({ user: null, token: null });
    }
}));