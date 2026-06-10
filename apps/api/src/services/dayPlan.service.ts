import { prisma } from "../lib/prisma";

export async function getDayPlan(userId: string, date: string) {
    return prisma.dayPlan.findUnique({
        where: { userId_date: { userId, date } },
        include: {
            blocks: {
                orderBy: { startTime: 'asc' },
                include: { tasks: { orderBy: { order: 'asc' } } }
            }
        }
    });
}
