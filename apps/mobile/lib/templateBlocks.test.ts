import { hasOverlap, validateBlockDraft, blockDraftErrorMessage, toBlockInput, BlockDraft } from "./templateBlocks";
import type { BlockInput } from "./api.types";

const EXISTING: BlockInput[] = [
    { type: 'CONTAINER', name: 'Deep Work', startTime: '09:00', endTime: '12:00', energyLevel: 'HIGH' },
    { type: 'ANCHOR', name: 'Lunch', startTime: '12:00', endTime: '13:00' },
];

function draft(over: Partial<BlockDraft> = {}): BlockDraft {
    return {
        type: 'ANCHOR',
        name: 'Gym',
        startTime: '17:00',
        endTime: '18:00',
        ...over,
    };
}

const CTX = { wakeTime: '07:00', sleepTime: '23:00', existingBlocks: EXISTING };

describe("hasOverlap", () => {
    it("detects an intersecting window", () => {
        expect(hasOverlap({ startTime: '11:30', endTime: '12:30' }, EXISTING)).toBe(true);
    });

    it("treats touching edges as non-overlapping", () => {
        expect(hasOverlap({ startTime: '13:00', endTime: '14:00' }, EXISTING)).toBe(false);
    });

    it("skips the excluded index so a block never overlaps itself", () => {
        expect(hasOverlap({ startTime: '09:00', endTime: '12:00' }, EXISTING, 0)).toBe(false);
    });
});

describe("validateBlockDraft", () => {
    it("accepts a valid, non-overlapping block", () => {
        expect(validateBlockDraft(draft(), CTX)).toBeNull();
    });

    it("requires a name", () => {
        expect(validateBlockDraft(draft({ name: '  ' }), CTX)).toEqual({ code: 'NAME_REQUIRED' });
    });

    it("requires both times", () => {
        expect(validateBlockDraft(draft({ startTime: null }), CTX)).toEqual({ code: 'TIME_REQUIRED' });
    });

    it("requires end after start", () => {
        expect(validateBlockDraft(draft({ startTime: '18:00', endTime: '17:00' }), CTX)).toEqual({ code: 'END_BEFORE_START' });
    });

    it("rejects a start before wake time and carries the boundary", () => {
        expect(validateBlockDraft(draft({ startTime: '06:00', endTime: '06:30' }), CTX)).toEqual({ code: 'BEFORE_WAKE', boundary: '07:00' });
    });

    it("rejects an end after sleep time and carries the boundary", () => {
        expect(validateBlockDraft(draft({ startTime: '22:00', endTime: '23:30' }), CTX)).toEqual({ code: 'AFTER_SLEEP', boundary: '23:00' });
    });

    it("requires energy on container blocks", () => {
        expect(validateBlockDraft(draft({ type: 'CONTAINER', energyLevel: undefined }), CTX)).toEqual({ code: 'ENERGY_REQUIRED' });
    });

    it("rejects an overlapping block", () => {
        expect(validateBlockDraft(draft({ startTime: '11:00', endTime: '11:30' }), CTX)).toEqual({ code: 'OVERLAP' });
    });

    it("allows an edited block to keep its own slot via excludeIndex", () => {
        const editing = draft({ type: 'CONTAINER', name: 'Deep Work', startTime: '09:00', endTime: '12:00', energyLevel: 'HIGH' });
        expect(validateBlockDraft(editing, { ...CTX, excludeIndex: 0 })).toBeNull();
    });
});

describe("toBlockInput", () => {
    it("keeps energyLevel for containers", () => {
        const b = toBlockInput({ type: 'CONTAINER', name: 'Focus', startTime: '09:00', endTime: '10:00', energyLevel: 'MEDIUM' });
        expect(b).toEqual({ type: 'CONTAINER', name: 'Focus', startTime: '09:00', endTime: '10:00', energyLevel: 'MEDIUM' });
    });

    it("drops energyLevel for non-containers and trims the name", () => {
        const b = toBlockInput({ type: 'ANCHOR', name: '  Lunch  ', startTime: '12:00', endTime: '13:00', energyLevel: 'HIGH' });
        expect(b).toEqual({ type: 'ANCHOR', name: 'Lunch', startTime: '12:00', endTime: '13:00' });
    });
});
