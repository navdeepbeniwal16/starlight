import { prisma } from "../lib/prisma";
import type { DayPlan } from "../types/dayPlan.types";

export async function getDayPlan(userId: string, date: string): Promise<DayPlan | null> {
    return prisma.dayPlan.findFirst({
        where: { userId, date, status: 'ACTIVE' },
        select: {
            id: true,
            date: true,
            wakeTime: true,
            sleepTime: true,
            status: true,
            blocks: {
                orderBy: { startTime: 'asc' },
                select: {
                    id: true,
                    type: true,
                    name: true,
                    startTime: true,
                    endTime: true,
                    energyLevel: true,
                    tasks: {
                        orderBy: { blockOrder: 'asc' },
                        select: {
                            id: true,
                            title: true,
                            estimatedMins: true,
                            blockOrder: true,
                            status: true,
                        }
                    }
                }
            }
        }
    });
}
