import { BlockType, EnergyLevel } from '@prisma/client';
export { BlockType, EnergyLevel } from '@prisma/client';

export type BlockInput = {
    type: BlockType;
    name: string;
    startTime: string;
    endTime: string;
    energyLevel?: EnergyLevel;
};