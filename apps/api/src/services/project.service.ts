import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { CreateProjectInput, UpdateProjectInput, ProjectDetail } from "../types/project.types";

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

export async function getAllProjects(userId: string): Promise<ProjectDetail[]> {
    return prisma.project.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: projectDetailSelect,
    });
}

export async function getProjectById(userId: string, projectId: string): Promise<ProjectDetail | null> {
    return prisma.project.findFirst({
        where: { id: projectId, userId },
        select: projectDetailSelect,
    });
}

export async function updateProject(userId: string, projectId: string, input: UpdateProjectInput): Promise<ProjectDetail> {
    const existing = await prisma.project.findFirst({ where: { id: projectId, userId }, select: { id: true } });
    if (!existing) throw new ProjectNotFoundError();

    const data: Prisma.ProjectUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.goal !== undefined) data.goal = input.goal;

    try {
        return await prisma.project.update({
            where: { id: projectId },
            data,
            select: projectDetailSelect,
        });
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            throw new DuplicateProjectNameError();
        }
        throw error;
    }
}

export async function deleteProject(userId: string, projectId: string): Promise<void> {
    const result = await prisma.project.deleteMany({ where: { id: projectId, userId } });
    if (result.count === 0) throw new ProjectNotFoundError();
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