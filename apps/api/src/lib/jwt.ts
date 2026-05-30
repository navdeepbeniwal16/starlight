import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET!;
const EXPIRES_IN = "30d";

export function signToken(payload: { sub: string, email: string}): string {
    return jwt.sign(payload, JWT_SECRET, {expiresIn: EXPIRES_IN});
}

export function verifyToken(token: string): jwt.JwtPayload {
    return jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
}