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
        const email = typeof sessionClaims?.["email"] === "string" ? sessionClaims["email"] : undefined;

        const user = await resolveLocalUser(clerkUserId, email);

        req.user = { sub: user.id };
        res.locals["userId"] = user.id;
        next();
    } catch (error) {
        next(error);
    }
}
