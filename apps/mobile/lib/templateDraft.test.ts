import { isTemplateDirty, isTemplateValid, isWakeBeforeSleep, blocksOutOfBounds, computeGaps, buildTimeline, hasContainer, MIN_GAP_MINUTES, TemplateDraft } from "./templateDraft";

function draft(): TemplateDraft {
    return {
        wakeTime: '07:00',
        sleepTime: '23:00',
        blocks: [
            { type: 'CONTAINER', name: 'Deep Work', startTime: '09:00', endTime: '12:00', energyLevel: 'HIGH' },
            { type: 'ANCHOR', name: 'Lunch', startTime: '12:00', endTime: '13:00' },
            { type: 'NO_TASK', name: 'Wind Down', startTime: '20:00', endTime: '22:00' },
        ],
    };
}

describe("isTemplateDirty", () => {
    it("is false for identical baseline and draft", () => {
        expect(isTemplateDirty(draft(), draft())).toBe(false);
    });

    it("is false when null", () => {
        expect(isTemplateDirty(null, draft())).toBe(false);
        expect(isTemplateDirty(draft(), null)).toBe(false);
    });

    it("is true when a block field changed", () => {
        const edited = draft();
        edited.blocks[0] = { ...edited.blocks[0], name: 'Focus' };
        expect(isTemplateDirty(draft(), edited)).toBe(true);
    });

    it("is true when wake/sleep changed", () => {
        const edited = draft();
        edited.wakeTime = '06:30';
        expect(isTemplateDirty(draft(), edited)).toBe(true);
    });

    it("is false when an edit is reverted to the original value", () => {
        const reverted = draft();
        reverted.blocks[0] = { ...reverted.blocks[0], name: 'Changed' };
        reverted.blocks[0] = { ...reverted.blocks[0], name: 'Deep Work' };
        expect(isTemplateDirty(draft(), reverted)).toBe(false);
    });
});

describe("isTemplateValid", () => {
    it("is true for a valid draft", () => {
        expect(isTemplateValid(draft())).toBe(true);
    });

    it("is false when no CONTAINER block remains", () => {
        const d = draft();
        d.blocks = d.blocks.filter((b) => b.type !== 'CONTAINER');
        expect(isTemplateValid(d)).toBe(false);
    });

    it("is false when two blocks overlap", () => {
        const d = draft();
        d.blocks[1] = { ...d.blocks[1], startTime: '11:30', endTime: '12:30' };
        expect(isTemplateValid(d)).toBe(false);
    });

    it("is false when a block falls outside the wake/sleep window", () => {
        const d = draft();
        d.blocks[2] = { ...d.blocks[2], endTime: '23:30' };
        expect(isTemplateValid(d)).toBe(false);
    });

    it("is false when a CONTAINER block has no energy level", () => {
        const d = draft();
        d.blocks[0] = { type: 'CONTAINER', name: 'Deep Work', startTime: '09:00', endTime: '12:00' };
        expect(isTemplateValid(d)).toBe(false);
    });

    it("is false when wake is not before sleep", () => {
        const d = draft();
        d.wakeTime = '23:30';
        expect(isTemplateValid(d)).toBe(false);
    });

    it("is false for null", () => {
        expect(isTemplateValid(null)).toBe(false);
    });
});

describe("isWakeBeforeSleep", () => {
    it("is true when wake precedes sleep", () => {
        expect(isWakeBeforeSleep(draft())).toBe(true);
    });

    it("is false when wake equals or follows sleep", () => {
        expect(isWakeBeforeSleep({ ...draft(), wakeTime: '23:00', sleepTime: '23:00' })).toBe(false);
        expect(isWakeBeforeSleep({ ...draft(), wakeTime: '23:30', sleepTime: '07:00' })).toBe(false);
    });
});

describe("blocksOutOfBounds", () => {
    it("returns nothing when all blocks sit within the window", () => {
        expect(blocksOutOfBounds(draft())).toEqual([]);
    });

    it("flags a block that starts before wake, with its index", () => {
        const d = draft();
        d.wakeTime = '09:30'; // Deep Work starts 09:00, now before wake
        const out = blocksOutOfBounds(d);
        expect(out).toHaveLength(1);
        expect(out[0].index).toBe(0);
        expect(out[0].block.name).toBe('Deep Work');
    });

    it("flags a block that ends after sleep", () => {
        const d = draft();
        d.sleepTime = '21:00'; // Wind Down ends 22:00, now after sleep
        const out = blocksOutOfBounds(d);
        expect(out.map((o) => o.block.name)).toEqual(['Wind Down']);
    });
});

describe("computeGaps", () => {
    it("returns the leading, interior, and trailing free spans", () => {
        // draft(): wake 07:00, sleep 23:00; blocks 09:00-12:00, 12:00-13:00, 20:00-22:00.
        const gaps = computeGaps(draft());
        expect(gaps).toEqual([
            { startTime: '07:00', endTime: '09:00', durationMinutes: 120 }, // wake → first block
            { startTime: '13:00', endTime: '20:00', durationMinutes: 420 }, // between blocks
            { startTime: '22:00', endTime: '23:00', durationMinutes: 60 },  // last block → sleep
        ]);
    });

    it("emits no leading/trailing gap when a block sits flush against wake or sleep", () => {
        const d: TemplateDraft = {
            wakeTime: '09:00',
            sleepTime: '13:00',
            blocks: [
                { type: 'CONTAINER', name: 'Deep Work', startTime: '09:00', endTime: '12:00', energyLevel: 'HIGH' },
                { type: 'ANCHOR', name: 'Lunch', startTime: '12:00', endTime: '13:00' },
            ],
        };
        expect(computeGaps(d)).toEqual([]);
    });

    it("returns a single full-window gap when there are no blocks", () => {
        const d: TemplateDraft = { wakeTime: '07:00', sleepTime: '23:00', blocks: [] };
        expect(computeGaps(d)).toEqual([{ startTime: '07:00', endTime: '23:00', durationMinutes: 960 }]);
    });

    it("returns nothing for a fully-allocated day", () => {
        const d: TemplateDraft = {
            wakeTime: '08:00',
            sleepTime: '10:00',
            blocks: [
                { type: 'CONTAINER', name: 'A', startTime: '08:00', endTime: '09:00', energyLevel: 'HIGH' },
                { type: 'CONTAINER', name: 'B', startTime: '09:00', endTime: '10:00', energyLevel: 'LOW' },
            ],
        };
        expect(computeGaps(d)).toEqual([]);
    });

    it("skips sub-threshold slivers below the minimum gap", () => {
        const d: TemplateDraft = {
            wakeTime: '08:00',
            sleepTime: '12:00',
            blocks: [
                { type: 'CONTAINER', name: 'A', startTime: '08:00', endTime: '09:50', energyLevel: 'HIGH' },
                // 10-minute sliver (09:50-10:00) is skipped; the wider gap after B is kept.
                { type: 'CONTAINER', name: 'B', startTime: '10:00', endTime: '11:00', energyLevel: 'LOW' },
            ],
        };
        expect(computeGaps(d)).toEqual([{ startTime: '11:00', endTime: '12:00', durationMinutes: 60 }]);
    });

    it("keeps a gap exactly at the minimum threshold", () => {
        const d: TemplateDraft = {
            wakeTime: '08:00',
            sleepTime: `08:${MIN_GAP_MINUTES}`,
            blocks: [],
        };
        expect(computeGaps(d)).toEqual([{ startTime: '08:00', endTime: `08:${MIN_GAP_MINUTES}`, durationMinutes: MIN_GAP_MINUTES }]);
    });

    it("does not produce spurious or negative gaps from out-of-bounds blocks", () => {
        const d: TemplateDraft = {
            wakeTime: '08:00',
            sleepTime: '18:00',
            // Block straddles wake (06:00-09:00): only 09:00→18:00 is free.
            blocks: [{ type: 'CONTAINER', name: 'Early', startTime: '06:00', endTime: '09:00', energyLevel: 'HIGH' }],
        };
        expect(computeGaps(d)).toEqual([{ startTime: '09:00', endTime: '18:00', durationMinutes: 540 }]);
    });

    it("returns nothing when wake is not before sleep", () => {
        expect(computeGaps({ ...draft(), wakeTime: '23:00', sleepTime: '07:00' })).toEqual([]);
        expect(computeGaps(null)).toEqual([]);
    });
});

describe("hasContainer", () => {
    it("is true when a CONTAINER block is present", () => {
        expect(hasContainer(draft())).toBe(true);
    });

    it("is false with no CONTAINER block or null", () => {
        const d = draft();
        d.blocks = d.blocks.filter((b) => b.type !== 'CONTAINER');
        expect(hasContainer(d)).toBe(false);
        expect(hasContainer(null)).toBe(false);
    });
});

describe("buildTimeline", () => {
    it("interleaves blocks and gaps in chronological order, preserving draft indices", () => {
        // draft(): blocks at 09:00-12:00, 12:00-13:00, 20:00-22:00 inside 07:00-23:00.
        const rows = buildTimeline(draft());
        expect(rows.map((r) => (r.kind === 'block' ? `block:${r.block.name}:${r.index}` : `gap:${r.startTime}`))).toEqual([
            'gap:07:00',            // wake → Deep Work
            'block:Deep Work:0',
            'block:Lunch:1',
            'gap:13:00',            // Lunch → Wind Down
            'block:Wind Down:2',
            'gap:22:00',            // Wind Down → sleep
        ]);
    });

    it("is empty for a null draft", () => {
        expect(buildTimeline(null)).toEqual([]);
    });
});
