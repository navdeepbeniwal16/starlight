import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../lib/jwt";
import { JsonWebTokenError } from "jsonwebtoken";

export function authenticate(req: Request, res: Response, next: NextFunction) : void {
    const authHeader = req.headers.authorization;

    if(!authHeader?.startsWith("Bearer ")) {
        res.status(401).json({error: "Missing or invalid authorization token"});
        return;
    }

    const token = authHeader.slice(7);

    try {
        const payload = verifyToken(token);
        req.user = { sub: payload.sub as string, email: payload.email as string};
        next();
    } catch (error) {
        if(error instanceof JsonWebTokenError) {
            res.status(401).json({error: "Invalid or expired token"});
            return;
        } else {
            next(error);
        }
    }
}