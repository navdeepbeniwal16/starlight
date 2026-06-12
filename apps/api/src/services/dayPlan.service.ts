import { prisma } from "../lib/prisma";
import type { DayPlan } from "../types/dayPlan.types";

export async function getDayPlan(userId: string, date: string): Promise<DayPlan | null> {
    return prisma.dayPlan.findUnique({
        where: { userId_date: { userId, date } },
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
                        orderBy: { order: 'asc' },
                        select: {
                            id: true,
                            title: true,
                            estimatedMins: true,
                            order: true,
                            status: true,
                        }
                    }
                }
            }
        }
    });
}
