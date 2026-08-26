import { signToken } from "../lib/jwt";
import { prisma } from "../lib/prisma"
import bcrypt from "bcrypt";

export class EmailAlreadyInUseError extends Error {}
export class InvalidCredentialsError extends Error {}
export class UserNotFoundError extends Error {}

const HASHING_SALT = 12;

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
            lastName: user.lastName,
            onboardedAt: user.onboardedAt
        }
    };
}

export async function login( data:{
    email: string,
    password: string
}) {
    const user = await prisma.user.findUnique({where: { email: data.email }});
    if(!user) {
        throw new InvalidCredentialsError();
    }
    
    const areEqual = await bcrypt.compare(data.password, user.passwordHash);
    if(!areEqual) {
        throw new InvalidCredentialsError();
    }
    
    const token = signToken({sub: user.id, email: user.email});

    return {
        token,
        user: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            onboardedAt: user.onboardedAt
        }
    };
}

export async function getMe(userId:string) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, email: true, firstName: true, lastName: true, onboardedAt: true }
        });

        if (!user) throw new UserNotFoundError();

        return user;
}

// Idempotent: the first confirmed plan stamps completion; the null guard keeps
// the original timestamp so re-running onboarding can't move it.
export async function markOnboarded(userId: string) {
    await prisma.user.updateMany({
        where: { id: userId, onboardedAt: null },
        data: { onboardedAt: new Date() }
    });

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, firstName: true, lastName: true, onboardedAt: true }
    });

    if (!user) throw new UserNotFoundError();

    return user;
}