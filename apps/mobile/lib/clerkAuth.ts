import { clerkErrorMessage } from "./clerkErrors";

// Shared cascade for Clerk's headless password flows. Sign-in and sign-up are
// the same shape: the attempt resolves with `{ error }`, only a 'complete'
// status can be finalized, and finalize (which activates the session) also
// resolves with `{ error }`. Returns an inline message on failure, or null on
// success — at which point the layout guards react to the now-active session.
type ClerkAttempt = { error: unknown };

export async function runClerkPasswordFlow(step: {
    attempt: () => Promise<ClerkAttempt>;
    isComplete: () => boolean;
    finalize: () => Promise<ClerkAttempt>;
    incompleteMessage: string;
}): Promise<string | null> {
    const { error } = await step.attempt();
    if (error) return clerkErrorMessage(error);

    if (!step.isComplete()) return step.incompleteMessage;

    const { error: finalizeError } = await step.finalize();
    return finalizeError ? clerkErrorMessage(finalizeError) : null;
}
