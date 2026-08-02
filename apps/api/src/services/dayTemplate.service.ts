import { prisma } from "../lib/prisma";
import { BlockInput } from "../types/dayTemplate.types";
import { validateDayTemplate } from "./dayTemplate.validator";

export class DayTemplateNotFoundError extends Error { };
export class DayTemplateAlreadyExistsError extends Error { };

export async function getDayTemplate(userId: string) {
    const template = await prisma.dayTemplate.findUnique({
        where: { userId },
        include: { blocks: true }
    });

    if (!template) throw new DayTemplateNotFoundError();

    return template;
}

export async function createDayTemplate(data: {
    userId: string,
    wakeTime: string,
    sleepTime: string,
    blocks: BlockInput[]
}) {
    validateDayTemplate({
        wakeTime: data.wakeTime,
        sleepTime: data.sleepTime,
        blocks: data.blocks,
    });

    // Validate no pre-existing day template for user
    const exists = await prisma.dayTemplate.findUnique({
        where: { userId: data.userId }
    });

    if (exists) {
        throw new DayTemplateAlreadyExistsError();
    }

    // Create template & blocks in a transaction
    const result = await prisma.$transaction(async (tx) => {
        const template = await tx.dayTemplate.create({
            data: {
                userId: data.userId,
                wakeTime: data.wakeTime,
                sleepTime: data.sleepTime
            }
        });

        await tx.block.createMany({
            data: data.blocks.map(block => ({
                dayTemplateId: template.id,
                type: block.type,
                name: block.name,
                startTime: block.startTime,
                endTime: block.endTime,
                energyLevel: block.energyLevel
            }))
        });

        return template;
    });

    return result;
}