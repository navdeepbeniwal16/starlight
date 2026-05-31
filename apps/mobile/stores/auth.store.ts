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

/* 
create() builds the store and returns a hook (useAuthStore) for use in components.
It takes a function that receives Zustand's set updater and returns the initial state + actions.
Calling set() merges the new values into state and notifies all subscribed components to re-render.
*/
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