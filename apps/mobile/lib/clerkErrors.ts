// Clerk's headless (Future) auth methods resolve with a `ClerkError` on failure
// — a breached or too-short password, wrong credentials, a taken email — rather
// than throwing. We duck-type its shape (`clerkError: true`) instead of importing
// the SDK so this module stays React-Native-free and unit-testable, and prefer
// `longMessage` (Clerk's user-facing sentence) over the terse `message`.
type ClerkErrorLike = { clerkError: true; message?: string; longMessage?: string };

function isClerkError(error: unknown): error is ClerkErrorLike {
    return typeof error === "object" && error !== null && (error as { clerkError?: unknown }).clerkError === true;
}

export function clerkErrorMessage(error: unknown): string {
    if (isClerkError(error)) {
        return error.longMessage ?? error.message ?? "Something went wrong. Please try again.";
    }
    return "Network error. Please check your connection.";
}
