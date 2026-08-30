import { BlockInput, BlockType, EnergyLevel } from "./api.types";
import { toMins, formatTime } from "./time";

// Shared presentation constants for day-template block editing.
export const BLOCK_TYPES: BlockType[] = ['CONTAINER', 'ANCHOR'];
export const ENERGY_LEVELS: EnergyLevel[] = ['HIGH', 'MEDIUM', 'LOW'];

// Shortest block the grid allows, in minutes — unified across create, move, and resize
// so a block can capture a brief routine (medication) but never collapse to nothing.
export const MIN_BLOCK_MINUTES = 5;

export const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
    CONTAINER: 'Container',
    ANCHOR: 'Anchor',
};

export const BLOCK_TYPE_DESCRIPTIONS: Record<BlockType, string> = {
    CONTAINER: 'Time slots for Starlight to schedule your tasks into.',
    ANCHOR: 'A fixed daily event e.g lunch, dinner or the gym.',
};

export const ENERGY_LABELS: Record<EnergyLevel, string> = {
    HIGH: 'High',
    MEDIUM: 'Medium',
    LOW: 'Low',
};

/** A block being edited, before it is known to be valid (times may be unset). */
export type BlockDraft = {
    type: BlockType;
    name: string;
    startTime: string | null;
    endTime: string | null;
    energyLevel?: EnergyLevel;
};

export type BlockValidationContext = {
    wakeTime: string | null;
    sleepTime: string | null;
    existingBlocks: BlockInput[];
    excludeIndex?: number;
};

/**
 * True if candidate `block`'s [start, end) window intersects any block in `existing`.
 * `excludeIndex` skips the block being edited so it doesn't overlap itself.
 */
export function hasOverlap(
    candidate: { startTime: string; endTime: string },
    existing: BlockInput[],
    excludeIndex?: number,
): boolean {
    return existing.some((b, i) => {
        if (i === excludeIndex) return false;
        return toMins(candidate.startTime) < toMins(b.endTime) && toMins(candidate.endTime) > toMins(b.startTime);
    });
}

/**
 * A single block-draft validation failure, as a stable code plus any data the
 * user-facing message needs. Presentation-free: the UI maps codes to copy, and
 * `boundary` carries the raw HH:mm time to be formatted at that boundary.
 */
export type BlockDraftError =
    | { code: 'NAME_REQUIRED' }
    | { code: 'TIME_REQUIRED' }
    | { code: 'END_BEFORE_START' }
    | { code: 'TOO_SHORT' }
    | { code: 'BEFORE_WAKE'; boundary: string }
    | { code: 'AFTER_SLEEP'; boundary: string }
    | { code: 'ENERGY_REQUIRED' }
    | { code: 'OVERLAP' };

/**
 * Validates a single block draft against the rules the editor UI enforces:
 * name, time range, wake/sleep bounds, container energy, and overlap.
 *
 * @param draft - The in-progress block being added or edited.
 * @param ctx - The surrounding template state to validate against (wake/sleep
 * window, sibling blocks, and the index to exclude when editing in place).
 * @returns The first violation as a typed {@link BlockDraftError}, or `null`
 * when the draft is valid.
 *
 * @remarks
 * use {@link blockDraftErrorMessage} to render user facing messages from {@link BlockDraftError}.
 */
export function validateBlockDraft(draft: BlockDraft, ctx: BlockValidationContext): BlockDraftError | null {
    if (!draft.name.trim()) {
        return { code: 'NAME_REQUIRED' };
    }
    if (!draft.startTime || !draft.endTime) {
        return { code: 'TIME_REQUIRED' };
    }
    if (toMins(draft.startTime) >= toMins(draft.endTime)) {
        return { code: 'END_BEFORE_START' };
    }
    if (toMins(draft.endTime) - toMins(draft.startTime) < MIN_BLOCK_MINUTES) {
        return { code: 'TOO_SHORT' };
    }
    if (ctx.wakeTime && toMins(draft.startTime) < toMins(ctx.wakeTime)) {
        return { code: 'BEFORE_WAKE', boundary: ctx.wakeTime };
    }
    if (ctx.sleepTime && toMins(draft.endTime) > toMins(ctx.sleepTime)) {
        return { code: 'AFTER_SLEEP', boundary: ctx.sleepTime };
    }
    if (draft.type === 'CONTAINER' && !draft.energyLevel) {
        return { code: 'ENERGY_REQUIRED' };
    }
    if (hasOverlap({ startTime: draft.startTime, endTime: draft.endTime }, ctx.existingBlocks, ctx.excludeIndex)) {
        return { code: 'OVERLAP' };
    }
    return null;
}

/** Renders a {@link BlockDraftError} as the user-facing message shown in the editor. */
export function blockDraftErrorMessage(error: BlockDraftError): string {
    switch (error.code) {
        case 'NAME_REQUIRED': return 'Block name is required';
        case 'TIME_REQUIRED': return 'Start and end time are required';
        case 'END_BEFORE_START': return 'End time must be after start time';
        case 'TOO_SHORT': return `A block must be at least ${MIN_BLOCK_MINUTES} minutes long`;
        case 'BEFORE_WAKE': return `Block must start at or after your wake time (${formatTime(error.boundary)})`;
        case 'AFTER_SLEEP': return `Block must end by your sleep time (${formatTime(error.boundary)})`;
        case 'ENERGY_REQUIRED': return 'Energy level is required for container blocks';
        case 'OVERLAP': return 'This block overlaps with an existing one';
    }
}

/** Builds the persisted block shape from a validated draft (drops energy for non-containers). */
export function toBlockInput(draft: BlockDraft & { startTime: string; endTime: string }): BlockInput {
    return {
        type: draft.type,
        name: draft.name.trim(),
        startTime: draft.startTime,
        endTime: draft.endTime,
        ...(draft.type === 'CONTAINER' ? { energyLevel: draft.energyLevel } : {}),
    };
}
