import { signToken } from "../lib/jwt";
import { prisma } from "../lib/prisma"
import bcrypt from "bcrypt";

export class EmailAlreadyInUseError extends Error {}

export async function signup(userData:{
    email: string,
    password: string,
    firstName: string,
    lastName: string
}) {
    const existing = await prisma.user.findUnique({ where: { email: userData.email }});
    if(existing) {
        throw new EmailAlreadyInUseError();
    }

    const HASHING_SALT = 12;
    const passwordHash = await bcrypt.hash(userData.password, HASHING_SALT);

    const user = await prisma.user.create({
        data: {
            email: userData.email,
            passwordHash,
            firstName: userData.firstName,
            lastName: userData.lastName
        }
    });

    const token = signToken({sub: user.id, email: user.email});

    return {
        token,
        user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName
        }
    };
}