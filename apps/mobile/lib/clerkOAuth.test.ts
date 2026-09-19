import { runClerkOAuthFlow } from "./clerkOAuth";

const clerkError = (longMessage: string) => ({ clerkError: true as const, longMessage });

describe("runClerkOAuthFlow", () => {
    it("returns null when the flow activates a session", async () => {
        const message = await runClerkOAuthFlow(async () => ({ createdSessionId: "sess_123" }));
        expect(message).toBeNull();
    });

    // A dismissed browser resolves with no session and no throw — a cancel, not a failure.
    it("returns null when the user dismisses the browser", async () => {
        const message = await runClerkOAuthFlow(async () => ({ createdSessionId: null }));
        expect(message).toBeNull();
    });

    it("surfaces a thrown Clerk error as an inline message", async () => {
        const message = await runClerkOAuthFlow(async () => {
            throw clerkError("This account is already linked to another user.");
        });
        expect(message).toBe("This account is already linked to another user.");
    });
});
