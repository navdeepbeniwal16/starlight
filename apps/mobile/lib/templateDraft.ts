import { BlockInput } from "./api.types";
import { validateBlockDraft } from "./templateBlocks";
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
export function computeGaps(draft: TemplateDraft | null, minMinutes: number = MIN_GAP_MINUTES): TemplateGap[] {
    if (!draft) return [];
    const wake = toMins(draft.wakeTime);
    const sleep = toMins(draft.sleepTime);
    if (sleep <= wake) return [];

    const makeGap = (start: number, end: number): TemplateGap => ({
        startTime: fromMins(start),
        endTime: fromMins(end),
        durationMinutes: end - start,
    });

    const sorted = [...draft.blocks].sort((a, b) => toMins(a.startTime) - toMins(b.startTime));
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
