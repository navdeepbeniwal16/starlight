import { BlockInput, BlockType, EnergyLevel } from "../types/dayTemplate.types";

export class DayTemplateValidationError extends Error { }

const timeRegex = /^\d{2}:\d{2}$/;
const validBlockTypes = Object.values(BlockType);
const validEnergyLevels = Object.values(EnergyLevel);

function isValidHHmm(value: unknown): value is string {
    if (typeof value !== "string" || !timeRegex.test(value)) return false;
    const [h, m] = value.split(":").map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function toMins(hhMm: string): number {
    const [h, m] = hhMm.split(":").map(Number);
    return h * 60 + m;
}

export type DayTemplateInput = {
    wakeTime: string;
    sleepTime: string;
    blocks: BlockInput[];
};

/**
 * The single authoritative validator for a day template. It owns all template invariants:
 *   - HH:mm format for wake/sleep and every block boundary
 *   - wakeTime strictly before sleepTime
 *   - non-empty block name; valid block-type and energy-level enums
 *   - each block's startTime strictly before its endTime
 *   - CONTAINER blocks carry an energyLevel
 *   - at least one CONTAINER block
 *   - no two blocks overlap
 *   - every block sits within the wake/sleep window
 *
 * Throws {@link DayTemplateValidationError} on the first violation.
 */
export function validateDayTemplate(data: DayTemplateInput): void {
    const { wakeTime, sleepTime, blocks } = data;

    if (!isValidHHmm(wakeTime)) {
        throw new DayTemplateValidationError("wakeTime must be a valid HH:mm string");
    }
    if (!isValidHHmm(sleepTime)) {
        throw new DayTemplateValidationError("sleepTime must be a valid HH:mm string");
    }
    if (toMins(wakeTime) >= toMins(sleepTime)) {
        throw new DayTemplateValidationError("wakeTime must be before sleepTime");
    }

    if (!Array.isArray(blocks) || blocks.length === 0) {
        throw new DayTemplateValidationError("blocks must be a non-empty array");
    }

    blocks.forEach((block, i) => {
        if (!block || typeof block !== "object") {
            throw new DayTemplateValidationError(`Block at index ${i} is invalid`);
        }
        if (!validBlockTypes.includes(block.type)) {
            throw new DayTemplateValidationError(`Block at index ${i} has invalid type`);
        }
        if (typeof block.name !== "string" || !block.name.trim()) {
            throw new DayTemplateValidationError(`Block at index ${i} must have a non-empty name`);
        }
        if (!isValidHHmm(block.startTime)) {
            throw new DayTemplateValidationError(`Block at index ${i} has invalid startTime`);
        }
        if (!isValidHHmm(block.endTime)) {
            throw new DayTemplateValidationError(`Block at index ${i} has invalid endTime`);
        }
        if (toMins(block.startTime) >= toMins(block.endTime)) {
            throw new DayTemplateValidationError(`Block at index ${i} must start before it ends`);
        }
        if (block.energyLevel !== undefined && !validEnergyLevels.includes(block.energyLevel)) {
            throw new DayTemplateValidationError(`Block at index ${i} has invalid energyLevel`);
        }
        if (block.type === "CONTAINER" && !block.energyLevel) {
            throw new DayTemplateValidationError(`Block at index ${i} (CONTAINER) requires an energyLevel`);
        }
        if (toMins(block.startTime) < toMins(wakeTime) || toMins(block.endTime) > toMins(sleepTime)) {
            throw new DayTemplateValidationError(`Block at index ${i} falls outside the wake/sleep window`);
        }
    });

    if (!blocks.some((b) => b.type === "CONTAINER")) {
        throw new DayTemplateValidationError("At least one CONTAINER block is required");
    }

    for (let i = 0; i < blocks.length - 1; i++) {
        for (let j = i + 1; j < blocks.length; j++) {
            const a = blocks[i];
            const b = blocks[j];
            if (toMins(a.startTime) < toMins(b.endTime) && toMins(a.endTime) > toMins(b.startTime)) {
                throw new DayTemplateValidationError("Blocks must not overlap");
            }
        }
    }
}
