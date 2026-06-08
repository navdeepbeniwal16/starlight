import { prisma } from "../lib/prisma";
import { BlockInput } from "../types/dayTemplate.types";

export class ContainerBlockNotFoundError extends Error {};
export class BlockOverlapError extends Error {};
export class OutOfAwakeBoundsError extends Error {};
export class DayTemplateAlreadyExistsError extends Error {};

export async function createDayTemplate(data:{
    userId: string,
    wakeTime: string,
    sleepTime: string,
    blocks: BlockInput []
}) {
    // Validate at least one container block is passed
    const containerExist = data.blocks.some(b => b.type === 'CONTAINER');
    if(!containerExist) throw new ContainerBlockNotFoundError();
    
    // Validate no blocks overlap
    for(let i=0; i < data.blocks.length-1; i++) {
        for(let j=i+1; j < data.blocks.length; j++) {
            const blockA = data.blocks[i];
            const blockB = data.blocks[j];
            if(blockA.startTime < blockB.endTime && blockA.endTime > blockB.startTime) {
                throw new BlockOverlapError();
            }
        }
    }

    // Validate all blocks fall within wakeTime - sleepTime bounds
    for(const block of data.blocks) {
        if(block.startTime < data.wakeTime || block.endTime > data.sleepTime) {
            throw new OutOfAwakeBoundsError();
        }
    }

    // Validate no pre-existing day template for user
    const exists = await prisma.dayTemplate.findUnique({
        where: { userId: data.userId }
    });
    
    if(exists) {
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