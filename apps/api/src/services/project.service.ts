import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { CreateProjectInput, ProjectDetail } from "../types/project.types";

export class DuplicateProjectNameError extends Error { }

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
