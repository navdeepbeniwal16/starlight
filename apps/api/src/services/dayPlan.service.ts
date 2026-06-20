import { prisma } from "../lib/prisma";
import type { DayPlan } from "../types/dayPlan.types";

export class NoTemplateError extends Error {}
export class NoContainerBlocksError extends Error {}

export async function createDraftPlan(
    userId: string,
    date: string,
    nowHHmm: string,
): Promise<{ id: string }> {
    const template = await prisma.dayTemplate.findUnique({
        where: { userId },
        select: {
            wakeTime: true,
            sleepTime: true,
            blocks: {
                select: { type: true, name: true, startTime: true, endTime: true, energyLevel: true },
            },
        },
    });

    if (!template) throw new NoTemplateError();

    const eligibleBlocks = template.blocks
        .filter(b => b.endTime > nowHHmm)
        .map(b => ({
            type: b.type,
            name: b.name,
            startTime: b.startTime < nowHHmm ? nowHHmm : b.startTime,
            endTime: b.endTime,
            energyLevel: b.energyLevel,
        }));

    if (!eligibleBlocks.some(b => b.type === 'CONTAINER')) {
        throw new NoContainerBlocksError();
    }

    const plan = await prisma.$transaction(async (tx) => {
        const oldDraft = await tx.dayPlan.findFirst({
            where: { userId, date, status: 'DRAFT' },
            select: { id: true, blocks: { select: { id: true } } },
        });

        if (oldDraft) {
            const blockIds = oldDraft.blocks.map(b => b.id);
            await tx.task.updateMany({
                where: { plannedBlockId: { in: blockIds } },
                data: { plannedBlockId: null, blockOrder: null },
            });
            await tx.plannedBlock.deleteMany({ where: { dayPlanId: oldDraft.id } });
            await tx.dayPlan.delete({ where: { id: oldDraft.id } });
        }

        return tx.dayPlan.create({
            data: {
                userId,
                date,
                wakeTime: template.wakeTime,
                sleepTime: template.sleepTime,
                status: 'DRAFT',
                blocks: { create: eligibleBlocks },
            },
            select: { id: true },
        });
    });

    return { id: plan.id };
}

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
