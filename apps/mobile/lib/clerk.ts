import { getClerkInstance } from "@clerk/expo";

// The publishable key is safe to ship in the client. ClerkProvider and this
// non-hook singleton must be built from the same key so getToken() reads the
// very session the provider established. Expo inlines EXPO_PUBLIC_* at build
// time; keys inside node_modules are not inlined, which is why Clerk requires us
// to pass it in explicitly rather than let the SDK read the env itself.
const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
if (!publishableKey) {
    throw new Error("Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY. Set it in apps/mobile/.env.local.");
}

export const CLERK_PUBLISHABLE_KEY = publishableKey;

// The API client runs outside React, so it cannot read the session through the
// useAuth() hook. This singleton exposes the active session's token for the
// Authorization header; Clerk refreshes it under the hood.
const clerkInstance = getClerkInstance({ publishableKey });

export async function getToken(): Promise<string | null> {
    return (await clerkInstance.session?.getToken()) ?? null;
}
