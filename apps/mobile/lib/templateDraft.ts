import { BlockInput } from "./api.types";
import { validateBlockDraft, MIN_BLOCK_MINUTES } from "./templateBlocks";
import { fromMins, toMins } from "./time";

// A day template being edited. Its blocks carry no id.
export type TemplateDraft = {
    wakeTime: string;
    sleepTime: string;
    blocks: BlockInput[];
};

// A free span of time, with its length in minutes.
export type TemplateGap = { startTime: string; endTime: string; durationMinutes: number };

// One timeline entry: a block at its index, or a free-time gap.
export type TimelineRow =
    | { kind: 'block'; startTime: string; block: BlockInput; index: number }
    | { kind: 'gap'; startTime: string; gap: TemplateGap };

// Minimum length, in minutes, for a gap to count as usable free time.
export const MIN_GAP_MINUTES = 15;

// Calendar-grid geometry. The grid is time-proportional at a fixed vertical scale
// (points of height per hour), so a longer block is visibly taller and the day reads
// as a finite space. Boundaries sit at the physical edges: wake at the top, sleep at
// the bottom.
export const POINTS_PER_HOUR = 60;

// Snap granularity (minutes), unified across create, move, and resize.
export const SNAP_MINUTES = 5;

// Free spans at least this long (minutes) earn an "Xh free" caption; shorter slivers
// render as bare background. Governs labelling only — not what is creatable.
export const FREE_LABEL_MIN_MINUTES = 30;

export function offsetForTime(time: string, wakeTime: string, pointsPerHour = POINTS_PER_HOUR): number {
    return ((toMins(time) - toMins(wakeTime)) / 60) * pointsPerHour;
}

// The time at a vertical offset below the wake boundary — the inverse of offsetForTime,
// resolved to the nearest minute.
export function timeAtOffset(offset: number, wakeTime: string, pointsPerHour = POINTS_PER_HOUR): string {
    return fromMins(toMins(wakeTime) + Math.round((offset / pointsPerHour) * 60));
}

export function snap(minutes: number, step = SNAP_MINUTES): number {
    return Math.round(minutes / step) * step;
}

// A block placed on the grid at its true clock offset, its height its true duration — never
// inflated, so a short block never spills over its neighbour. Fitting the label into a small
// height is the renderer's job (it shrinks/condenses), not the layout's.
export type GridBlock = { index: number; block: BlockInput; top: number; height: number };

// A span of unplanned time, positioned for its "Xh free" caption.
export type GridFree = { top: number; height: number; startTime: string; endTime: string; durationMinutes: number };

export type GridTick = { offset: number; time: string };

export type GridLayout = { blocks: GridBlock[]; free: GridFree[]; ticks: GridTick[]; totalHeight: number };

// Places every block at its absolute clock position (top = offset of its start, height =
// its duration) rather than flowing them, so a fixed hour ruler lines up with block edges
// by construction. Blocks come back sorted by start so the caller can paint later blocks
// over earlier ones. Free spans and interior hour ticks are returned alongside for the
// ruler and free-time captions.
export function computeGridLayout(
    draft: TemplateDraft | null,
    pointsPerHour = POINTS_PER_HOUR,
): GridLayout {
    if (!draft) return { blocks: [], free: [], ticks: [], totalHeight: 0 };
    const wake = toMins(draft.wakeTime);
    const sleep = toMins(draft.sleepTime);
    const totalHeight = Math.max(0, ((sleep - wake) / 60) * pointsPerHour);

    const blocks: GridBlock[] = draft.blocks
        .map((block, index) => {
            // Clamp the top into the window so an out-of-bounds block (flagged elsewhere)
            // still renders inside the canvas rather than above the wake edge.
            const top = Math.max(0, offsetForTime(block.startTime, draft.wakeTime, pointsPerHour));
            const bottom = offsetForTime(block.endTime, draft.wakeTime, pointsPerHour);
            return { index, block, top, height: Math.max(0, bottom - top) };
        })
        .sort((a, b) => a.top - b.top);

    // Every positive gap, so short slivers still position; the caller captions only the
    // spans past FREE_LABEL_MIN_MINUTES.
    const free: GridFree[] = computeGaps(draft, 1).map((gap) => ({
        top: offsetForTime(gap.startTime, draft.wakeTime, pointsPerHour),
        height: (gap.durationMinutes / 60) * pointsPerHour,
        startTime: gap.startTime,
        endTime: gap.endTime,
        durationMinutes: gap.durationMinutes,
    }));

    // Hour lines strictly inside the window; wake and sleep carry their own edge markers.
    const ticks: GridTick[] = [];
    for (let m = Math.ceil(wake / 60) * 60; m < sleep; m += 60) {
        const offset = ((m - wake) / 60) * pointsPerHour;
        if (offset > 0) ticks.push({ offset, time: fromMins(m) });
    }

    return { blocks, free, ticks, totalHeight };
}

// Default length (minutes) of a tap-created block before it is clamped to fit.
export const DEFAULT_BLOCK_MINUTES = 60;

// The half-hour grid a tap-created block's start snaps onto, so new blocks land on clean
// hour or half-hour boundaries.
const SEED_SNAP_MINUTES = 30;

// Seeds a tap-to-create block: DEFAULT_BLOCK_MINUTES starting at the tapped time snapped to the
// nearest hour or half-hour, then clamped to the free gap it lands in so it never runs into the
// next block — shrinking to as little as MIN_BLOCK_MINUTES when the tap is close to a neighbour.
// Returns null when the tap isn't inside a gap that can hold the minimum block (on a block, or a
// sliver too small to fill).
export function seedBlockRange(
    draft: TemplateDraft | null,
    tappedTime: string,
): { startTime: string; endTime: string } | null {
    if (!draft) return null;
    const t = toMins(tappedTime);
    const gap = computeGaps(draft, MIN_BLOCK_MINUTES).find(
        (g) => toMins(g.startTime) <= t && t < toMins(g.endTime),
    );
    if (!gap) return null;

    const gapEnd = toMins(gap.endTime);
    // Snap to the nearest half-hour, then pull back if that lands so near the gap's end that the
    // minimum wouldn't fit (or before its start).
    const start = Math.max(toMins(gap.startTime), Math.min(snap(t, SEED_SNAP_MINUTES), gapEnd - MIN_BLOCK_MINUTES));
    const end = Math.min(start + DEFAULT_BLOCK_MINUTES, gapEnd);
    return { startTime: fromMins(start), endTime: fromMins(end) };
}

// What seating an edit does to one neighbour it collided with: `trim` shrinks the neighbour to
// its new form; `remove` drops it because nothing usable would remain (the edit covers it, or a
// trim would leave a sliver under MIN_BLOCK_MINUTES). Both carry the neighbour's original block
// so the confirm step can name it.
export type OverlapChange =
    | { kind: 'trim'; index: number; block: BlockInput }
    | { kind: 'remove'; index: number; block: BlockInput };

// How to seat `candidate` against the existing blocks. `clear` — it fits as typed; `adjust` —
// the active edit wins and these neighbour changes make room for it.
export type OverlapPlan =
    | { kind: 'clear' }
    | { kind: 'adjust'; changes: OverlapChange[] };

// Resolves an overlap by adjusting every block the candidate collides with — the active edit
// always wins, so there is no unresolvable case and no rule the user must know: each neighbour
// is trimmed off the intruded edge, or removed when trimming would leave nothing usable.
export function computeOverlapPlan(
    draft: TemplateDraft,
    candidate: { startTime: string; endTime: string },
    excludeIndex?: number,
): OverlapPlan {
    const cs = toMins(candidate.startTime);
    const ce = toMins(candidate.endTime);

    const changes: OverlapChange[] = draft.blocks
        .map((block, index) => ({ block, index }))
        .filter(({ block, index }) => index !== excludeIndex && cs < toMins(block.endTime) && ce > toMins(block.startTime))
        .map(({ block, index }): OverlapChange => {
            const ns = toMins(block.startTime);
            const ne = toMins(block.endTime);

            // Candidate covers the block outright — nothing to keep.
            if (cs <= ns && ce >= ne) return { kind: 'remove', index, block };

            // Candidate sits inside the block: keep the leading part, drop the trailing part
            // (a single track can't split a block in two).
            if (cs > ns && ce < ne) {
                return cs - ns < MIN_BLOCK_MINUTES
                    ? { kind: 'remove', index, block }
                    : { kind: 'trim', index, block: { ...block, endTime: candidate.startTime } };
            }

            // Overlaps the front — push the block's start past the candidate's end.
            if (cs <= ns) {
                return ne - ce < MIN_BLOCK_MINUTES
                    ? { kind: 'remove', index, block }
                    : { kind: 'trim', index, block: { ...block, startTime: candidate.endTime } };
            }

            // Overlaps the back — pull the block's end back to the candidate's start.
            return cs - ns < MIN_BLOCK_MINUTES
                ? { kind: 'remove', index, block }
                : { kind: 'trim', index, block: { ...block, endTime: candidate.startTime } };
        });

    return changes.length === 0 ? { kind: 'clear' } : { kind: 'adjust', changes };
}

// Plain-language summary of a plan's consequences for the confirm step, in active voice so the
// action reads as the user's own: e.g. "This will shorten Lunch and remove Gym."
export function describeOverlapPlan(changes: OverlapChange[]): string {
    const join = (names: string[]) =>
        names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    const trimmed = changes.filter((c) => c.kind === 'trim').map((c) => c.block.name);
    const removed = changes.filter((c) => c.kind === 'remove').map((c) => c.block.name);
    const clauses = [
        trimmed.length ? `shorten ${join(trimmed)}` : null,
        removed.length ? `remove ${join(removed)}` : null,
    ].filter(Boolean);
    return `This will ${clauses.join(' and ')}.`;
}

// The immediate neighbour ahead of / behind the block at `index`. Relies on the draft being
// non-overlapping, which is what lets "start at or after this block's start" pick the next block.
function nextNeighbour(draft: TemplateDraft, index: number): { index: number; block: BlockInput } | null {
    const s0 = toMins(draft.blocks[index].startTime);
    let best: { index: number; block: BlockInput } | null = null;
    draft.blocks.forEach((block, i) => {
        if (i === index || toMins(block.startTime) < s0) return;
        if (!best || toMins(block.startTime) < toMins(best.block.startTime)) best = { index: i, block };
    });
    return best;
}

function prevNeighbour(draft: TemplateDraft, index: number): { index: number; block: BlockInput } | null {
    const e0 = toMins(draft.blocks[index].endTime);
    let best: { index: number; block: BlockInput } | null = null;
    draft.blocks.forEach((block, i) => {
        if (i === index || toMins(block.endTime) > e0) return;
        if (!best || toMins(block.endTime) > toMins(best.block.endTime)) best = { index: i, block };
    });
    return best;
}

// Drags one edge of a block to `targetTime` (snapped): the neighbour on that side live-trims to
// make room, down to its 5-minute floor, then the edge clamps there rather than swallowing it.
// Block count/order are preserved, so the caller's parallel block keys stay aligned.
export function resolveEdgeResize(
    draft: TemplateDraft,
    index: number,
    edge: 'start' | 'end',
    targetTime: string,
): TemplateDraft {
    const block = draft.blocks[index];
    const wake = toMins(draft.wakeTime);
    const sleep = toMins(draft.sleepTime);
    const s0 = toMins(block.startTime);
    const e0 = toMins(block.endTime);
    const target = snap(toMins(targetTime));
    const blocks = draft.blocks.slice();

    if (edge === 'end') {
        let end = Math.min(Math.max(target, s0 + MIN_BLOCK_MINUTES), sleep);
        const nb = nextNeighbour(draft, index);
        if (nb && end > toMins(nb.block.startTime)) {
            // Capping the end at the neighbour's floor both trims the neighbour and clamps the edge.
            end = Math.min(end, toMins(nb.block.endTime) - MIN_BLOCK_MINUTES);
            blocks[nb.index] = { ...nb.block, startTime: fromMins(end) };
        }
        blocks[index] = { ...block, endTime: fromMins(end) };
    } else {
        let start = Math.max(Math.min(target, e0 - MIN_BLOCK_MINUTES), wake);
        const nb = prevNeighbour(draft, index);
        if (nb && start < toMins(nb.block.endTime)) {
            start = Math.max(start, toMins(nb.block.startTime) + MIN_BLOCK_MINUTES);
            blocks[nb.index] = { ...nb.block, endTime: fromMins(start) };
        }
        blocks[index] = { ...block, startTime: fromMins(start) };
    }

    return { ...draft, blocks };
}

// Slides a block whole (duration preserved) so its start lands at `targetStart` (snapped), first
// clamped inside the window — a moved block can never push a boundary. The leading end presses the
// neighbour ahead down to its 5-minute floor, then clamps rather than swallowing or leaping it.
export function resolveMove(draft: TemplateDraft, index: number, targetStart: string): TemplateDraft {
    const block = draft.blocks[index];
    const wake = toMins(draft.wakeTime);
    const sleep = toMins(draft.sleepTime);
    const s0 = toMins(block.startTime);
    const duration = toMins(block.endTime) - s0;

    let start = Math.max(wake, Math.min(snap(toMins(targetStart)), sleep - duration));
    let end = start + duration;
    const blocks = draft.blocks.slice();

    if (start > s0) {
        const nb = nextNeighbour(draft, index);
        if (nb && end > toMins(nb.block.startTime)) {
            const cap = toMins(nb.block.endTime) - MIN_BLOCK_MINUTES;
            if (end > cap) { end = cap; start = end - duration; }
            blocks[nb.index] = { ...nb.block, startTime: fromMins(end) };
        }
    } else if (start < s0) {
        const nb = prevNeighbour(draft, index);
        if (nb && start < toMins(nb.block.endTime)) {
            const cap = toMins(nb.block.startTime) + MIN_BLOCK_MINUTES;
            if (start < cap) { start = cap; end = start + duration; }
            blocks[nb.index] = { ...nb.block, endTime: fromMins(start) };
        }
    }

    blocks[index] = { ...block, startTime: fromMins(start), endTime: fromMins(end) };
    return { ...draft, blocks };
}

// Checks whether wake time is strictly before sleep time.
export function isWakeBeforeSleep(draft: TemplateDraft | null): boolean {
    if (!draft) return false;
    return toMins(draft.wakeTime) < toMins(draft.sleepTime);
}

// Checks whether the draft holds at least one CONTAINER block.
export function hasContainer(draft: TemplateDraft | null): boolean {
    return !!draft && draft.blocks.some((b) => b.type === 'CONTAINER');
}

// Checks whether the draft differs in value from the baseline.
// Compared by value, so restoring an edited field to its original
// reads as equal even though the surrounding objects are new.
export function isTemplateDirty(baseline: TemplateDraft | null, draft: TemplateDraft | null): boolean {
    if (!baseline || !draft) return false;
    return JSON.stringify(baseline) !== JSON.stringify(draft);
}

// Whether the draft is fully valid
export function isTemplateValid(draft: TemplateDraft | null): boolean {
    if (!draft || draft.blocks.length === 0) return false;
    if (!isWakeBeforeSleep(draft)) return false;
    if (!hasContainer(draft)) return false;

    const { wakeTime, sleepTime, blocks } = draft;
    return blocks.every((b, i) =>
        validateBlockDraft(
            { type: b.type, name: b.name, startTime: b.startTime, endTime: b.endTime, energyLevel: b.energyLevel },
            { wakeTime, sleepTime, existingBlocks: blocks, excludeIndex: i },
        ) === null
    );
}

// The free spans between blocks within the wake/sleep window, each at least minMinutes long.
// Blocks are swept in start order behind a forward-only cursor,
// so overlapping or out-of-range blocks never yield negative gaps.
//
// `excludeIndex` drops the block at that index from the occupiers before the sweep
// (mirroring `hasOverlap`/`validateBlockDraft`), so its vacated span merges with the
// gaps immediately before and after it into one contiguous range — the block's full
// set of valid placements when it is the one being retimed.
export function computeGaps(
    draft: TemplateDraft | null,
    minMinutes: number = MIN_GAP_MINUTES,
    excludeIndex?: number,
): TemplateGap[] {
    if (!draft) return [];
    const wake = toMins(draft.wakeTime);
    const sleep = toMins(draft.sleepTime);
    if (sleep <= wake) return [];

    const makeGap = (start: number, end: number): TemplateGap => ({
        startTime: fromMins(start),
        endTime: fromMins(end),
        durationMinutes: end - start,
    });

    const sorted = draft.blocks
        .filter((_, i) => i !== excludeIndex)
        .sort((a, b) => toMins(a.startTime) - toMins(b.startTime));
    const gaps: TemplateGap[] = [];
    let cursor = wake;
    for (const block of sorted) {
        const start = toMins(block.startTime);
        if (start > cursor) gaps.push(makeGap(cursor, start));
        cursor = Math.max(cursor, toMins(block.endTime));
    }
    if (sleep > cursor) gaps.push(makeGap(cursor, sleep));

    return gaps.filter((g) => g.durationMinutes >= minMinutes);
}

// Blocks and gaps merged into a single list ordered by start time.
// Each block keeps its index into draft.blocks.
export function buildTimeline(draft: TemplateDraft | null): TimelineRow[] {
    if (!draft) return [];
    const rows: TimelineRow[] = [
        ...draft.blocks.map((block, index): TimelineRow => ({ kind: 'block', startTime: block.startTime, block, index })),
        ...computeGaps(draft).map((gap): TimelineRow => ({ kind: 'gap', startTime: gap.startTime, gap })),
    ];
    return rows.sort((a, b) => toMins(a.startTime) - toMins(b.startTime));
}

// The blocks that start before wake or end after sleep, each with its index.
export function blocksOutOfBounds(draft: TemplateDraft | null): { index: number; block: BlockInput }[] {
    if (!draft) return [];
    const wake = toMins(draft.wakeTime);
    const sleep = toMins(draft.sleepTime);
    return draft.blocks
        .map((block, index) => ({ index, block }))
        .filter(({ block }) => toMins(block.startTime) < wake || toMins(block.endTime) > sleep);
}
