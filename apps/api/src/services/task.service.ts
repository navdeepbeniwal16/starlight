import { prisma } from "../lib/prisma";
import type { BacklogTask } from "../types/task.types";

export async function getBacklog(userId: string): Promise<BacklogTask[]> {
    return prisma.task.findMany({
        where: { userId },
        select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            deadline: true,
            progress: true,
            estimatedMins: true,
        },
    });
}
