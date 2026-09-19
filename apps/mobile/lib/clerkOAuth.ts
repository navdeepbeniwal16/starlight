import { clerkErrorMessage } from "./clerkErrors";

// Clerk's experimental SSO flow throws a ClerkError on failure and activates the
// session itself on success — so, unlike the password flow, there is nothing to
// finalize here. A browser the user dismisses resolves with a null
// createdSessionId and no throw; that is a silent cancel, not an error, so we
// return null and leave the screen untouched. On success the layout guards react
// to the now-active session. Kept hook-free so it stays unit-testable.
type SSOResult = { createdSessionId: string | null };

export async function runClerkOAuthFlow(startSSOFlow: () => Promise<SSOResult>): Promise<string | null> {
    try {
        await startSSOFlow();
        return null;
    } catch (error) {
        return clerkErrorMessage(error);
    }
}
