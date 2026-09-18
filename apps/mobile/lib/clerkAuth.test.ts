import { runClerkPasswordFlow } from "./clerkAuth";

const clerkError = (longMessage: string) => ({ clerkError: true as const, longMessage });

describe("runClerkPasswordFlow", () => {
    it("returns null and finalizes when the attempt completes", async () => {
        const finalize = jest.fn().mockResolvedValue({ error: null });
        const message = await runClerkPasswordFlow({
            attempt: async () => ({ error: null }),
            isComplete: () => true,
            finalize,
            incompleteMessage: "unused",
        });

        expect(message).toBeNull();
        expect(finalize).toHaveBeenCalledTimes(1);
    });

    it("surfaces the attempt error and never finalizes", async () => {
        const finalize = jest.fn();
        const message = await runClerkPasswordFlow({
            attempt: async () => ({ error: clerkError("Password has been found in a data breach.") }),
            isComplete: () => true,
            finalize,
            incompleteMessage: "unused",
        });

        expect(message).toBe("Password has been found in a data breach.");
        expect(finalize).not.toHaveBeenCalled();
    });

    it("returns the incomplete message when the status is not complete", async () => {
        const finalize = jest.fn();
        const message = await runClerkPasswordFlow({
            attempt: async () => ({ error: null }),
            isComplete: () => false,
            finalize,
            incompleteMessage: "Additional verification is required.",
        });

        expect(message).toBe("Additional verification is required.");
        expect(finalize).not.toHaveBeenCalled();
    });

    it("surfaces a finalize error", async () => {
        const message = await runClerkPasswordFlow({
            attempt: async () => ({ error: null }),
            isComplete: () => true,
            finalize: async () => ({ error: clerkError("Could not start your session.") }),
            incompleteMessage: "unused",
        });

        expect(message).toBe("Could not start your session.");
    });
});
