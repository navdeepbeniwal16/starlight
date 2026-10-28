import { BlockInput, BlockType, DayShape, EnergyLevel } from "../types/dayTemplate.types";

export class DayTemplateValidationError extends Error { }
export class DayShapeValidationError extends Error { }

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

export const MAX_TEMPLATE_NAME_LENGTH = 50;

export type DayTemplateInput = {
    name: string;
    wakeTime: string;
    sleepTime: string;
    blocks: BlockInput[];
};

type Fail = (message: string) => never;

// `fail` throws the caller's own error type so each surfaces its own validation error.
function validateStructure(
    data: { wakeTime: string; sleepTime: string; blocks: BlockInput[] },
    fail: Fail,
): void {
    const { wakeTime, sleepTime, blocks } = data;

    if (!isValidHHmm(wakeTime)) fail("wakeTime must be a valid HH:mm string");
    if (!isValidHHmm(sleepTime)) fail("sleepTime must be a valid HH:mm string");
    if (toMins(wakeTime) >= toMins(sleepTime)) fail("wakeTime must be before sleepTime");

    if (!Array.isArray(blocks) || blocks.length === 0) fail("blocks must be a non-empty array");

    blocks.forEach((block, i) => {
        if (!block || typeof block !== "object") fail(`Block at index ${i} is invalid`);
        if (!validBlockTypes.includes(block.type)) fail(`Block at index ${i} has invalid type`);
        if (typeof block.name !== "string" || !block.name.trim()) fail(`Block at index ${i} must have a non-empty name`);
        if (!isValidHHmm(block.startTime)) fail(`Block at index ${i} has invalid startTime`);
        if (!isValidHHmm(block.endTime)) fail(`Block at index ${i} has invalid endTime`);
        if (toMins(block.startTime) >= toMins(block.endTime)) fail(`Block at index ${i} must start before it ends`);
        if (block.energyLevel !== undefined && !validEnergyLevels.includes(block.energyLevel)) fail(`Block at index ${i} has invalid energyLevel`);
        if (block.type === "CONTAINER" && !block.energyLevel) fail(`Block at index ${i} (CONTAINER) requires an energyLevel`);
        if (toMins(block.startTime) < toMins(wakeTime) || toMins(block.endTime) > toMins(sleepTime)) fail(`Block at index ${i} falls outside the wake/sleep window`);
    });

    if (!blocks.some((b) => b.type === "CONTAINER")) fail("At least one CONTAINER block is required");

    for (let i = 0; i < blocks.length - 1; i++) {
        for (let j = i + 1; j < blocks.length; j++) {
            const a = blocks[i];
            const b = blocks[j];
            if (toMins(a.startTime) < toMins(b.endTime) && toMins(a.endTime) > toMins(b.startTime)) {
                fail(`Block at index ${i} (${a.startTime}-${a.endTime}) overlaps block at index ${j} (${b.startTime}-${b.endTime})`);
            }
        }
    }
}

/**
 * Validates a day template.
 *
 * Throws {@link DayTemplateValidationError} on the first violation.
 */
export function validateDayTemplate(data: DayTemplateInput): void {
    const { name, wakeTime, sleepTime, blocks } = data;
    const fail: Fail = (message) => { throw new DayTemplateValidationError(message); };

    const trimmedName = typeof name === "string" ? name.trim() : "";
    if (trimmedName.length === 0) fail("Template name must not be empty");
    if (trimmedName.length > MAX_TEMPLATE_NAME_LENGTH) fail(`Template name must be at most ${MAX_TEMPLATE_NAME_LENGTH} characters`);

    validateStructure({ wakeTime, sleepTime, blocks }, fail);
}

/**
 * Validates a client-submitted day shape.
 * 
 * Throws {@link DayShapeValidationError} on the first violation.
 */
export function validateDayShape(shape: DayShape): void {
    const fail: Fail = (message) => { throw new DayShapeValidationError(message); };

    validateStructure(shape, fail);

    const ids = new Set<string>();
    shape.blocks.forEach((block, i) => {
        if (typeof block.id !== "string" || !block.id.trim()) fail(`Block at index ${i} must have a non-empty id`);
        if (ids.has(block.id)) fail(`Block at index ${i} has a duplicate id`);
        ids.add(block.id);
    });
}
