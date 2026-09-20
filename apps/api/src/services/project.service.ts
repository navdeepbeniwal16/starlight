import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { CreateProjectInput, ProjectDetail } from "../types/project.types";

export class ProjectNotFoundError extends Error { }
export class DuplicateProjectNameError extends Error { }
export class InFocusLimitError extends Error { }

const MAX_IN_FOCUS = 3;
const MAX_SERIALIZATION_RETRIES = 3;

const projectDetailSelect = {
    id: true,
    name: true,
    goal: true,
    isInFocus: true,
} as const;

export async function createProject(userId: string, input: CreateProjectInput): Promise<ProjectDetail> {
    try {
        return await prisma.project.create({
            data: {
                userId,
                name: input.name.trim(),
                ...(input.goal && { goal: input.goal }),
            },
            select: projectDetailSelect,
        });
    } catch (error) {
        // The @@unique([userId, name]) index is the guard against duplicates
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw new DuplicateProjectNameError();
        }
        throw error;
    }
}

export async function setInFocus(userId: string, projectId: string, inFocus: boolean): Promise<ProjectDetail> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await prisma.$transaction(
                async (tx) => {
                    const project = await tx.project.findFirst({
                        where: { id: projectId, userId },
                        select: { isInFocus: true }
                    });
                    if (!project) {
                        throw new ProjectNotFoundError();
                    }

                    // Only a 'false' to 'true' toggle can breach the cap, as retoggling an already in focus project doesn't change the count
                    if (inFocus && !project.isInFocus) {
                        const inFocusCount = await tx.project.count({
                            where: { userId, isInFocus: true },
                        });
                        if (inFocusCount >= MAX_IN_FOCUS) {
                            throw new InFocusLimitError();
                        }
                    }

                    return await tx.project.update({
                        where: { id: projectId },
                        data: { isInFocus: inFocus },
                        select: projectDetailSelect
                    })
                },
                { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
            )
        } catch (error) {
            // P2034 = serialization failure: the DB aborted us to protect the max in-focus invariant.
            const isSerializationFailure = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
            if (isSerializationFailure && attempt < MAX_SERIALIZATION_RETRIES) {
                continue;
            }
            throw error;
        }
    }
}