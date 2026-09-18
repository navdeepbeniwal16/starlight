import { clerkErrorMessage } from "./clerkErrors";

// Mirrors the runtime shape of Clerk's ClerkError without importing the SDK
// (which pulls in React Native). `clerkError: true` is the discriminator the SDK
// stamps on its errors; message/longMessage/code sit directly on the instance.
function clerkError(fields: { code?: string; message?: string; longMessage?: string }) {
    return { clerkError: true as const, ...fields };
}

describe("clerkErrorMessage", () => {
    it("surfaces the user-facing longMessage for a breached password", () => {
        const error = clerkError({
            code: "form_password_pwned",
            message: "Password has been found in an online data breach.",
            longMessage:
                "Password has been found in an online data breach. For account safety, please use a different password.",
        });

        expect(clerkErrorMessage(error)).toBe(
            "Password has been found in an online data breach. For account safety, please use a different password.",
        );
    });

    it("falls back to message when longMessage is absent", () => {
        const error = clerkError({ code: "form_identifier_not_found", message: "Couldn't find your account." });

        expect(clerkErrorMessage(error)).toBe("Couldn't find your account.");
    });

    it("returns a network message for a non-Clerk error (e.g. fetch rejection)", () => {
        expect(clerkErrorMessage(new TypeError("Network request failed"))).toBe(
            "Network error. Please check your connection.",
        );
    });

    it("returns a generic message for a Clerk error carrying no message text", () => {
        expect(clerkErrorMessage(clerkError({ code: "unknown" }))).toBe("Something went wrong. Please try again.");
    });
});
