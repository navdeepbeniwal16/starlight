import { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { resolveLocalUser } from "../services/user.service";

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
    // Verified from cached JWKS by clerkMiddleware — no per-request call to Clerk.
    const { userId: clerkUserId, sessionClaims } = getAuth(req);

    if (!clerkUserId) {
        res.status(401).json({ error: "Missing or invalid authorization token" });
        return;
    }

    try {
        // These custom claims must be added to the Clerk session token template
        // (Dashboard → Sessions). first/last name only arrive once name-bearing
        // claims are configured; a social sign-in supplies them from the provider.
        const claim = (key: string): string | undefined =>
            typeof sessionClaims?.[key] === "string" ? (sessionClaims[key] as string) : undefined;

        const user = await resolveLocalUser(clerkUserId, {
            email: claim("email"),
            firstName: claim("first_name"),
            lastName: claim("last_name"),
        });

        req.user = { sub: user.id };
        res.locals["userId"] = user.id;
        next();
    } catch (error) {
        next(error);
    }
}
