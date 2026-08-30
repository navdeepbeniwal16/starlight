import { isTemplateDirty, isTemplateValid, isWakeBeforeSleep, blocksOutOfBounds, computeGaps, buildTimeline, hasContainer, MIN_GAP_MINUTES, offsetForTime, timeAtOffset, snap, computeGridLayout, seedBlockRange, computeOverlapPlan, describeOverlapPlan, resolveEdgeResize, resolveMove, TemplateDraft, OverlapChange } from "./templateDraft";

function draft(): TemplateDraft {
    return {
        wakeTime: '07:00',
        sleepTime: '23:00',
        blocks: [
            { type: 'CONTAINER', name: 'Deep Work', startTime: '09:00', endTime: '12:00', energyLevel: 'HIGH' },
            { type: 'ANCHOR', name: 'Lunch', startTime: '12:00', endTime: '13:00' },
            { type: 'ANCHOR', name: 'Wind Down', startTime: '20:00', endTime: '22:00' },
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

    describe("with excludeIndex (available ranges for the edited block)", () => {
        it("merges the excluded block's vacated span with the gaps before and after it", () => {
            // Lunch (12:00-13:00, index 1) sits flush after Deep Work (09:00-12:00).
            // Excluding it merges its span with the 13:00-20:00 gap into one 12:00-20:00 range.
            const gaps = computeGaps(draft(), MIN_GAP_MINUTES, 1);
            expect(gaps).toEqual([
                { startTime: '07:00', endTime: '09:00', durationMinutes: 120 },
                { startTime: '12:00', endTime: '20:00', durationMinutes: 480 },
                { startTime: '22:00', endTime: '23:00', durationMinutes: 60 },
            ]);
        });

        it("yields just the excluded block's own span when it has no adjacent free time", () => {
            const d: TemplateDraft = {
                wakeTime: '08:00',
                sleepTime: '11:00',
                blocks: [
                    { type: 'CONTAINER', name: 'A', startTime: '08:00', endTime: '09:00', energyLevel: 'HIGH' },
                    { type: 'ANCHOR', name: 'B', startTime: '09:00', endTime: '10:00' },
                    { type: 'CONTAINER', name: 'C', startTime: '10:00', endTime: '11:00', energyLevel: 'LOW' },
                ],
            };
            // Excluding B (09:00-10:00), wedged between A and C, frees exactly its own span.
            expect(computeGaps(d, MIN_GAP_MINUTES, 1)).toEqual([
                { startTime: '09:00', endTime: '10:00', durationMinutes: 60 },
            ]);
        });

        it("still filters sub-threshold slivers after exclusion", () => {
            const d: TemplateDraft = {
                wakeTime: '08:00',
                sleepTime: '12:00',
                blocks: [
                    { type: 'CONTAINER', name: 'A', startTime: '08:00', endTime: '09:00', energyLevel: 'HIGH' },
                    // 10-minute block, flush on both sides — excluding it frees only a 10-min sliver.
                    { type: 'ANCHOR', name: 'B', startTime: '09:00', endTime: '09:10' },
                    { type: 'CONTAINER', name: 'C', startTime: '09:10', endTime: '12:00', energyLevel: 'LOW' },
                ],
            };
            expect(computeGaps(d, MIN_GAP_MINUTES, 1)).toEqual([]);
        });

        it("behaves exactly as today when excludeIndex is undefined", () => {
            expect(computeGaps(draft(), MIN_GAP_MINUTES, undefined)).toEqual(computeGaps(draft()));
        });

        it("yields no ranges for a fully packed day even with an exclusion out of range", () => {
            const d: TemplateDraft = {
                wakeTime: '08:00',
                sleepTime: '10:00',
                blocks: [
                    { type: 'CONTAINER', name: 'A', startTime: '08:00', endTime: '09:00', energyLevel: 'HIGH' },
                    { type: 'CONTAINER', name: 'B', startTime: '09:00', endTime: '10:00', energyLevel: 'LOW' },
                ],
            };
            expect(computeGaps(d, MIN_GAP_MINUTES, 5)).toEqual([]);
        });

        it("handles blocks in start order regardless of input order", () => {
            const d: TemplateDraft = {
                wakeTime: '08:00',
                sleepTime: '14:00',
                blocks: [
                    // Given out of order: C, A, B.
                    { type: 'ANCHOR', name: 'C', startTime: '13:00', endTime: '14:00' },
                    { type: 'CONTAINER', name: 'A', startTime: '08:00', endTime: '09:00', energyLevel: 'HIGH' },
                    { type: 'ANCHOR', name: 'B', startTime: '11:00', endTime: '12:00' },
                ],
            };
            // Exclude B (index 2): its 11:00-12:00 span merges with 09:00-11:00 and 12:00-13:00.
            expect(computeGaps(d, MIN_GAP_MINUTES, 2)).toEqual([
                { startTime: '09:00', endTime: '13:00', durationMinutes: 240 },
            ]);
        });
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

describe("offsetForTime", () => {
    it("maps the wake time to the top edge and later times proportionally below it", () => {
        expect(offsetForTime('07:00', '07:00')).toBe(0);
        expect(offsetForTime('08:00', '07:00')).toBe(60);
        expect(offsetForTime('07:30', '07:00')).toBe(30);
    });

    it("scales with a custom points-per-hour", () => {
        expect(offsetForTime('09:00', '07:00', 80)).toBe(160);
    });
});

describe("timeAtOffset", () => {
    it("is the inverse of offsetForTime to the nearest minute", () => {
        expect(timeAtOffset(0, '07:00')).toBe('07:00');
        expect(timeAtOffset(90, '07:00')).toBe('08:30');
    });

    it("round-trips a time through an offset and back", () => {
        expect(timeAtOffset(offsetForTime('13:45', '06:00'), '06:00')).toBe('13:45');
    });
});

describe("snap", () => {
    it("rounds to the nearest 5-minute step", () => {
        expect(snap(0)).toBe(0);
        expect(snap(62)).toBe(60);
        expect(snap(63)).toBe(65);
        expect(snap(67)).toBe(65);
    });

    it("honours a custom step", () => {
        expect(snap(70, 15)).toBe(75);
    });
});

describe("computeGridLayout", () => {
    it("is empty for a null draft", () => {
        expect(computeGridLayout(null)).toEqual({ blocks: [], free: [], ticks: [], totalHeight: 0 });
    });

    it("spans the whole window and sizes blocks by duration", () => {
        const d: TemplateDraft = {
            wakeTime: '07:00',
            sleepTime: '10:00',
            blocks: [
                { type: 'CONTAINER', name: 'One hour', startTime: '07:00', endTime: '08:00', energyLevel: 'HIGH' },
                { type: 'CONTAINER', name: 'Two hours', startTime: '08:00', endTime: '10:00', energyLevel: 'LOW' },
            ],
        };
        const { blocks, totalHeight } = computeGridLayout(d);
        expect(totalHeight).toBe(180);
        expect(blocks[0].height).toBe(60);
        expect(blocks[1].height).toBe(120);
    });

    it("positions each block at its absolute clock offset", () => {
        const d: TemplateDraft = {
            wakeTime: '07:00',
            sleepTime: '10:00',
            blocks: [{ type: 'ANCHOR', name: 'Gym', startTime: '08:00', endTime: '09:00' }],
        };
        expect(computeGridLayout(d).blocks).toEqual([
            { index: 0, block: d.blocks[0], top: 60, height: 60 },
        ]);
    });

    it("returns free spans at their offsets and hour ticks strictly inside the window", () => {
        const d: TemplateDraft = {
            wakeTime: '07:00',
            sleepTime: '10:00',
            blocks: [{ type: 'ANCHOR', name: 'Gym', startTime: '08:00', endTime: '09:00' }],
        };
        const { free, ticks } = computeGridLayout(d);
        expect(free).toEqual([
            { top: 0, height: 60, startTime: '07:00', endTime: '08:00', durationMinutes: 60 },
            { top: 120, height: 60, startTime: '09:00', endTime: '10:00', durationMinutes: 60 },
        ]);
        expect(ticks).toEqual([
            { offset: 60, time: '08:00' },
            { offset: 120, time: '09:00' },
        ]);
    });

    it("keeps a short block at its true small height so it never spills over its neighbour", () => {
        const d: TemplateDraft = {
            wakeTime: '07:00',
            sleepTime: '08:00',
            blocks: [{ type: 'ANCHOR', name: 'Meds', startTime: '07:30', endTime: '07:35' }],
        };
        expect(computeGridLayout(d).blocks[0]).toEqual({
            index: 0,
            block: d.blocks[0],
            top: 30,
            height: 5,
        });
    });

    it("orders blocks by start time while preserving their draft index", () => {
        const d: TemplateDraft = {
            wakeTime: '08:00',
            sleepTime: '12:00',
            blocks: [
                { type: 'ANCHOR', name: 'Late', startTime: '11:00', endTime: '12:00' },
                { type: 'CONTAINER', name: 'Early', startTime: '08:00', endTime: '09:00', energyLevel: 'HIGH' },
            ],
        };
        expect(computeGridLayout(d).blocks.map((b) => [b.block.name, b.index])).toEqual([
            ['Early', 1],
            ['Late', 0],
        ]);
    });
});

describe("seedBlockRange", () => {
    // wake 07:00, sleep 23:00; blocks 09:00-12:00, 12:00-13:00 leave 07:00-09:00 and 13:00-23:00 free.
    function d(): TemplateDraft {
        return {
            wakeTime: '07:00',
            sleepTime: '23:00',
            blocks: [
                { type: 'CONTAINER', name: 'Deep Work', startTime: '09:00', endTime: '12:00', energyLevel: 'HIGH' },
                { type: 'ANCHOR', name: 'Lunch', startTime: '12:00', endTime: '13:00' },
            ],
        };
    }

    it("seeds a one-hour block, snapping the start to the nearest half hour", () => {
        // 14:20 is nearer 14:30 than 14:00; the block runs a full hour from there.
        expect(seedBlockRange(d(), '14:20')).toEqual({ startTime: '14:30', endTime: '15:30' });
    });

    it("snaps the start to the top of the hour when it is nearer", () => {
        expect(seedBlockRange(d(), '14:10')).toEqual({ startTime: '14:00', endTime: '15:00' });
    });

    it("clamps the end to the next block when the gap is shorter than an hour", () => {
        // 08:30 sits in the 07:00-09:00 gap; a full hour would hit Deep Work at 09:00.
        expect(seedBlockRange(d(), '08:30')).toEqual({ startTime: '08:30', endTime: '09:00' });
    });

    it("pulls the start back so the minimum still fits when the tap is near the gap end", () => {
        // A neighbour at 09:03 ends the gap there; tapping 09:01 (snaps to 09:00) would leave
        // only 3 minutes, so the start backs off to 08:58 to keep a 5-minute block.
        const tight: TemplateDraft = {
            wakeTime: '07:00', sleepTime: '23:00',
            blocks: [{ type: 'CONTAINER', name: 'Early', startTime: '09:03', endTime: '12:00', energyLevel: 'HIGH' }],
        };
        expect(seedBlockRange(tight, '09:01')).toEqual({ startTime: '08:58', endTime: '09:03' });
    });

    it("returns null when the tap lands on a block, not free space", () => {
        expect(seedBlockRange(d(), '10:00')).toBeNull();
    });

    it("returns null for a null draft", () => {
        expect(seedBlockRange(null, '10:00')).toBeNull();
    });
});

describe("computeOverlapPlan", () => {
    // Deep Work 09:00-12:00 (idx 0), Lunch 12:00-13:00 (idx 1).
    function d(): TemplateDraft {
        return {
            wakeTime: '07:00',
            sleepTime: '23:00',
            blocks: [
                { type: 'CONTAINER', name: 'Deep Work', startTime: '09:00', endTime: '12:00', energyLevel: 'HIGH' },
                { type: 'ANCHOR', name: 'Lunch', startTime: '12:00', endTime: '13:00' },
            ],
        };
    }

    it("reports clear when the candidate overlaps nothing", () => {
        expect(computeOverlapPlan(d(), { startTime: '14:00', endTime: '15:00' })).toEqual({ kind: 'clear' });
    });

    it("trims a neighbour's front when the candidate intrudes on its start", () => {
        // 08:30-09:30 overlaps Deep Work's start; push Deep Work to begin at 09:30.
        expect(computeOverlapPlan(d(), { startTime: '08:30', endTime: '09:30' })).toEqual({
            kind: 'adjust',
            changes: [
                { kind: 'trim', index: 0, block: { type: 'CONTAINER', name: 'Deep Work', startTime: '09:30', endTime: '12:00', energyLevel: 'HIGH' } },
            ],
        });
    });

    it("trims a neighbour's back when the candidate intrudes on its end", () => {
        // 11:30-12:00 overlaps Deep Work's end; pull Deep Work to end at 11:30.
        expect(computeOverlapPlan(d(), { startTime: '11:30', endTime: '12:00' })).toEqual({
            kind: 'adjust',
            changes: [
                { kind: 'trim', index: 0, block: { type: 'CONTAINER', name: 'Deep Work', startTime: '09:00', endTime: '11:30', energyLevel: 'HIGH' } },
            ],
        });
    });

    it("removes a block the candidate covers outright", () => {
        const single: TemplateDraft = { wakeTime: '07:00', sleepTime: '23:00', blocks: [{ type: 'ANCHOR', name: 'Gym', startTime: '09:00', endTime: '10:00' }] };
        expect(computeOverlapPlan(single, { startTime: '08:30', endTime: '10:30' })).toEqual({
            kind: 'adjust',
            changes: [{ kind: 'remove', index: 0, block: single.blocks[0] }],
        });
    });

    it("trims the leading part when the candidate sits wholly inside a block", () => {
        // 10:00-11:00 inside Deep Work; keep 09:00-10:00, drop the tail (single track can't split).
        expect(computeOverlapPlan(d(), { startTime: '10:00', endTime: '11:00' })).toEqual({
            kind: 'adjust',
            changes: [
                { kind: 'trim', index: 0, block: { type: 'CONTAINER', name: 'Deep Work', startTime: '09:00', endTime: '10:00', energyLevel: 'HIGH' } },
            ],
        });
    });

    it("adjusts every block when the candidate overlaps more than one", () => {
        // 11:30-12:30 clips Deep Work's end and Lunch's start.
        expect(computeOverlapPlan(d(), { startTime: '11:30', endTime: '12:30' })).toEqual({
            kind: 'adjust',
            changes: [
                { kind: 'trim', index: 0, block: { type: 'CONTAINER', name: 'Deep Work', startTime: '09:00', endTime: '11:30', energyLevel: 'HIGH' } },
                { kind: 'trim', index: 1, block: { type: 'ANCHOR', name: 'Lunch', startTime: '12:30', endTime: '13:00' } },
            ],
        });
    });

    it("removes rather than trims when trimming would leave a sub-minimum sliver", () => {
        // 08:00-11:58 would leave Deep Work only 11:58-12:00, under the 5-minute floor.
        expect(computeOverlapPlan(d(), { startTime: '08:00', endTime: '11:58' })).toEqual({
            kind: 'adjust',
            changes: [{ kind: 'remove', index: 0, block: d().blocks[0] }],
        });
    });

    it("skips the edited block itself via excludeIndex", () => {
        // Re-saving Deep Work at its own times must not read as a self-overlap.
        expect(computeOverlapPlan(d(), { startTime: '09:00', endTime: '12:00' }, 0)).toEqual({ kind: 'clear' });
    });
});

describe("resolveEdgeResize", () => {
    // Deep Work 09:00-12:00 (idx 0), Lunch 12:00-13:00 (idx 1) inside 07:00-23:00.
    function d(): TemplateDraft {
        return {
            wakeTime: '07:00',
            sleepTime: '23:00',
            blocks: [
                { type: 'CONTAINER', name: 'Deep Work', startTime: '09:00', endTime: '12:00', energyLevel: 'HIGH' },
                { type: 'ANCHOR', name: 'Lunch', startTime: '12:00', endTime: '13:00' },
            ],
        };
    }

    it("extends the end into open space, leaving neighbours untouched", () => {
        // Deep Work's end has a clear gap only up to Lunch at 12:00; drag to 11:30 stays clear.
        const out = resolveEdgeResize(d(), 0, 'end', '11:30');
        expect(out.blocks[0].endTime).toBe('11:30');
        expect(out.blocks[1]).toEqual(d().blocks[1]);
    });

    it("trims the following neighbour's front when the end presses into it", () => {
        const out = resolveEdgeResize(d(), 0, 'end', '12:30');
        expect(out.blocks[0].endTime).toBe('12:30');
        expect(out.blocks[1].startTime).toBe('12:30');
        expect(out.blocks[1].endTime).toBe('13:00');
    });

    it("clamps the end at the neighbour's 5-minute floor instead of swallowing it", () => {
        // Dragging the end to 13:30 would engulf Lunch; it holds at 12:55, flooring Lunch.
        const out = resolveEdgeResize(d(), 0, 'end', '13:30');
        expect(out.blocks[0].endTime).toBe('12:55');
        expect(out.blocks[1]).toEqual({ type: 'ANCHOR', name: 'Lunch', startTime: '12:55', endTime: '13:00' });
        expect(out.blocks).toHaveLength(2);
    });

    it("never shrinks the end below the block's own 5-minute floor", () => {
        const out = resolveEdgeResize(d(), 0, 'end', '08:00');
        expect(out.blocks[0].endTime).toBe('09:05');
    });

    it("clamps the end to the sleep boundary", () => {
        const single: TemplateDraft = {
            wakeTime: '07:00', sleepTime: '23:00',
            blocks: [{ type: 'ANCHOR', name: 'Gym', startTime: '21:00', endTime: '22:00' }],
        };
        expect(resolveEdgeResize(single, 0, 'end', '23:45').blocks[0].endTime).toBe('23:00');
    });

    it("trims the preceding neighbour's back when the start presses into it", () => {
        // Drag Lunch's start up to 11:30, pushing Deep Work's end back to 11:30.
        const out = resolveEdgeResize(d(), 1, 'start', '11:30');
        expect(out.blocks[1].startTime).toBe('11:30');
        expect(out.blocks[0].endTime).toBe('11:30');
    });

    it("clamps the start at the preceding neighbour's 5-minute floor", () => {
        // Dragging Lunch's start up to 08:00 would engulf Deep Work; it holds at 09:05.
        const out = resolveEdgeResize(d(), 1, 'start', '08:00');
        expect(out.blocks[1].startTime).toBe('09:05');
        expect(out.blocks[0]).toEqual({ type: 'CONTAINER', name: 'Deep Work', startTime: '09:00', endTime: '09:05', energyLevel: 'HIGH' });
    });

    it("clamps the start to the wake boundary", () => {
        const single: TemplateDraft = {
            wakeTime: '07:00', sleepTime: '23:00',
            blocks: [{ type: 'ANCHOR', name: 'Gym', startTime: '08:00', endTime: '09:00' }],
        };
        expect(resolveEdgeResize(single, 0, 'start', '06:15').blocks[0].startTime).toBe('07:00');
    });

    it("snaps the dragged edge to five minutes", () => {
        expect(resolveEdgeResize(d(), 0, 'end', '11:32').blocks[0].endTime).toBe('11:30');
        expect(resolveEdgeResize(d(), 0, 'end', '11:33').blocks[0].endTime).toBe('11:35');
    });
});

describe("resolveMove", () => {
    // Deep Work 09:00-12:00 (idx 0), Wind Down 20:00-22:00 (idx 1) inside 07:00-23:00.
    function d(): TemplateDraft {
        return {
            wakeTime: '07:00',
            sleepTime: '23:00',
            blocks: [
                { type: 'CONTAINER', name: 'Deep Work', startTime: '09:00', endTime: '12:00', energyLevel: 'HIGH' },
                { type: 'ANCHOR', name: 'Wind Down', startTime: '20:00', endTime: '22:00' },
            ],
        };
    }

    it("slides a block into open space, preserving its duration", () => {
        const out = resolveMove(d(), 0, '13:00');
        expect(out.blocks[0].startTime).toBe('13:00');
        expect(out.blocks[0].endTime).toBe('16:00');
    });

    it("keeps the moved block's other fields intact", () => {
        expect(resolveMove(d(), 0, '13:00').blocks[0]).toEqual({
            type: 'CONTAINER', name: 'Deep Work', startTime: '13:00', endTime: '16:00', energyLevel: 'HIGH',
        });
    });

    it("trims the following neighbour's front when the moved block presses into it", () => {
        // Move Deep Work (3h) down to 19:30 → ends 22:30, into Wind Down (20:00-22:00).
        // Wind Down floors at 21:55; Deep Work clamps to end there, keeping its 3h (18:55-21:55).
        const out = resolveMove(d(), 0, '19:30');
        expect(out.blocks[0]).toEqual({ type: 'CONTAINER', name: 'Deep Work', startTime: '18:55', endTime: '21:55', energyLevel: 'HIGH' });
        expect(out.blocks[1]).toEqual({ type: 'ANCHOR', name: 'Wind Down', startTime: '21:55', endTime: '22:00' });
        expect(out.blocks).toHaveLength(2);
    });

    it("trims the preceding neighbour's back when moving up into it", () => {
        // Wind Down (2h) up to 11:00 → starts inside Deep Work (09:00-12:00).
        // Deep Work floors at 09:05; Wind Down clamps to start there (09:05-11:05).
        const out = resolveMove(d(), 1, '08:00');
        expect(out.blocks[1]).toEqual({ type: 'ANCHOR', name: 'Wind Down', startTime: '09:05', endTime: '11:05' });
        expect(out.blocks[0]).toEqual({ type: 'CONTAINER', name: 'Deep Work', startTime: '09:00', endTime: '09:05', energyLevel: 'HIGH' });
    });

    it("clamps to the wake boundary rather than pushing it", () => {
        const out = resolveMove(d(), 0, '06:00');
        expect(out.blocks[0].startTime).toBe('07:00');
        expect(out.blocks[0].endTime).toBe('10:00');
    });

    it("clamps to the sleep boundary, keeping the block's full duration inside the window", () => {
        const single: TemplateDraft = {
            wakeTime: '07:00', sleepTime: '23:00',
            blocks: [{ type: 'CONTAINER', name: 'Deep Work', startTime: '09:00', endTime: '12:00', energyLevel: 'HIGH' }],
        };
        const out = resolveMove(single, 0, '22:30');
        expect(out.blocks[0].startTime).toBe('20:00');
        expect(out.blocks[0].endTime).toBe('23:00');
    });

    it("snaps the target start to five minutes", () => {
        expect(resolveMove(d(), 0, '13:02').blocks[0].startTime).toBe('13:00');
        expect(resolveMove(d(), 0, '13:03').blocks[0].startTime).toBe('13:05');
    });

    it("leaves the block unchanged when the target resolves to its current start", () => {
        expect(resolveMove(d(), 0, '09:00')).toEqual(d());
    });
});

describe("describeOverlapPlan", () => {
    const trim = (name: string): OverlapChange => ({ kind: 'trim', index: 0, block: { type: 'ANCHOR', name, startTime: '09:00', endTime: '10:00' } });
    const remove = (name: string): OverlapChange => ({ kind: 'remove', index: 0, block: { type: 'ANCHOR', name, startTime: '09:00', endTime: '10:00' } });

    it("names a single trimmed block", () => {
        expect(describeOverlapPlan([trim('Lunch')])).toBe('This will shorten Lunch.');
    });

    it("names a single removed block", () => {
        expect(describeOverlapPlan([remove('Gym')])).toBe('This will remove Gym.');
    });

    it("joins a trim and a removal", () => {
        expect(describeOverlapPlan([trim('Lunch'), remove('Gym')])).toBe('This will shorten Lunch and remove Gym.');
    });

    it("lists multiple names of the same kind", () => {
        expect(describeOverlapPlan([trim('Lunch'), trim('Reading')])).toBe('This will shorten Lunch and Reading.');
    });
});
