import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { BlockInput } from "../types/dayTemplate.types";
import { validateDayTemplate } from "./dayTemplate.validator";

export class DayTemplateNotFoundError extends Error { }
export class DuplicateTemplateNameError extends Error { }
export class CannotDeleteLastTemplateError extends Error { }

// Name uniqueness is enforced by @@unique([userId, name]) on a citext column, so
// a colliding write surfaces as Prisma's P2002 rather than an in-code check.
function isDuplicateName(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function blockRows(dayTemplateId: string, blocks: BlockInput[]) {
    return blocks.map(block => ({
        dayTemplateId,
        type: block.type,
        name: block.name,
        startTime: block.startTime,
        endTime: block.endTime,
        energyLevel: block.energyLevel,
    }));
}

export async function listDayTemplates(userId: string) {
    return prisma.dayTemplate.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
        include: { blocks: true },
    });
}

export async function getDayTemplateById(userId: string, id: string) {
    const template = await prisma.dayTemplate.findFirst({
        where: { id, userId },
        include: { blocks: true },
    });

    // it 404s rather than revealing that the template exists.
    if (!template) throw new DayTemplateNotFoundError();
    return template;
}

export async function createDayTemplate(data: {
    userId: string,
    name: string,
    wakeTime: string,
    sleepTime: string,
    blocks: BlockInput[],
}) {
    const name = data.name.trim();
    validateDayTemplate({ name, wakeTime: data.wakeTime, sleepTime: data.sleepTime, blocks: data.blocks });

    let createdId: string;
    try {
        createdId = await prisma.$transaction(async (tx) => {
            const template = await tx.dayTemplate.create({
                data: { userId: data.userId, name, wakeTime: data.wakeTime, sleepTime: data.sleepTime },
            });
            await tx.block.createMany({ data: blockRows(template.id, data.blocks) });
            return template.id;
        });
    } catch (error) {
        if (isDuplicateName(error)) throw new DuplicateTemplateNameError();
        throw error;
    }

    return getDayTemplateById(data.userId, createdId);
}

export async function updateDayTemplate(data: {
    userId: string,
    id: string,
    name: string,
    wakeTime: string,
    sleepTime: string,
    blocks: BlockInput[],
}) {
    const name = data.name.trim();
    validateDayTemplate({ name, wakeTime: data.wakeTime, sleepTime: data.sleepTime, blocks: data.blocks });

    const existing = await prisma.dayTemplate.findFirst({
        where: { id: data.id, userId: data.userId },
        select: { id: true },
    });
    if (!existing) throw new DayTemplateNotFoundError();

    try {
        await prisma.$transaction(async (tx) => {
            await tx.dayTemplate.update({
                where: { id: data.id },
                data: { name, wakeTime: data.wakeTime, sleepTime: data.sleepTime },
            });
            // An edit replaces the whole block set — the template itself survives, so
            // the delete-on-template cascade never fires here; blocks are cleared by hand.
            await tx.block.deleteMany({ where: { dayTemplateId: data.id } });
            await tx.block.createMany({ data: blockRows(data.id, data.blocks) });
        });
    } catch (error) {
        if (isDuplicateName(error)) throw new DuplicateTemplateNameError();
        throw error;
    }

    return getDayTemplateById(data.userId, data.id);
}

export async function deleteDayTemplate(userId: string, id: string) {
    const existing = await prisma.dayTemplate.findFirst({ where: { id, userId }, select: { id: true } });
    if (!existing) throw new DayTemplateNotFoundError();

    // The user must always be left with at least one template, so a schedule can
    // still be generated. The count includes the target, so one means it's the last.
    if (await prisma.dayTemplate.count({ where: { userId } }) === 1) {
        throw new CannotDeleteLastTemplateError();
    }

    await prisma.dayTemplate.delete({ where: { id } });
}