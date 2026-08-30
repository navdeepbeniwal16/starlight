import { create } from "zustand";
import { BlockInput, DayTemplate } from "../lib/api.types";
import { TemplateDraft, OverlapChange } from "../lib/templateDraft";

// Backs the Day Template editor: the loaded `baseline` (server truth)
// alongside a `draft` the user edits.
// Blocks are held without ids; ids are dropped on hydrate.
type TemplateState = {
    baseline: TemplateDraft | null;
    draft: TemplateDraft | null;
    blockKeys: string[];
    hydrate: (template: DayTemplate) => void;
    seed: (draft: TemplateDraft) => void;
    setWakeSleep: (wakeTime: string, sleepTime: string) => void;
    // Replace the whole draft (live drag/resolve path + Undo). blockKeys are left untouched
    // because the resolvers preserve block count and order.
    setDraft: (draft: TemplateDraft) => void;
    updateBlock: (index: number, block: BlockInput) => void;
    addBlock: (block: BlockInput) => void;
    removeBlock: (index: number) => void;
    // Seat an edited/created block and apply its overlap plan in one step, so the neighbour
    // trims/removals and the seated block land together and blockKeys never desync.
    resolveOverlap: (seat: { index: number | null; block: BlockInput }, changes: OverlapChange[]) => void;
    commit: () => void;  // adopt the current draft as the saved baseline
    reset: () => void;   // discard edits and restore the baseline
    clear: () => void;   // drop all state
};

let keySeq = 0;
const nextKey = () => `blk_${++keySeq}`;

function toDraft(t: { wakeTime: string; sleepTime: string; blocks: BlockInput[] }): TemplateDraft {
    return {
        wakeTime: t.wakeTime,
        sleepTime: t.sleepTime,
        blocks: t.blocks.map((b) => ({
            type: b.type,
            name: b.name,
            startTime: b.startTime,
            endTime: b.endTime,
            ...(b.energyLevel ? { energyLevel: b.energyLevel } : {}),
        })),
    };
}

export const useTemplateStore = create<TemplateState>((set) => ({
    baseline: null,
    draft: null,
    blockKeys: [],

    hydrate: (template) => {
        const draft = toDraft(template);
        set({ baseline: toDraft(template), draft, blockKeys: draft.blocks.map(nextKey) });
    },

    // Baseline mirrors the draft so the editor opens clean; onboarding gates Continue on
    // validity, not dirtiness.
    seed: (draft) => {
        set({ baseline: toDraft(draft), draft: toDraft(draft), blockKeys: draft.blocks.map(nextKey) });
    },

    setWakeSleep: (wakeTime, sleepTime) =>
        set((state) => (state.draft ? { draft: { ...state.draft, wakeTime, sleepTime } } : state)),

    setDraft: (draft) => set((state) => (state.draft ? { draft } : state)),

    updateBlock: (index, block) =>
        set((state) =>
            state.draft
                ? { draft: { ...state.draft, blocks: state.draft.blocks.map((b, i) => (i === index ? block : b)) } }
                : state
        ),

    addBlock: (block) =>
        set((state) =>
            state.draft
                ? {
                    draft: { ...state.draft, blocks: [...state.draft.blocks, block] },
                    blockKeys: [...state.blockKeys, nextKey()],
                }
                : state
        ),

    removeBlock: (index) =>
        set((state) =>
            state.draft
                ? {
                    draft: { ...state.draft, blocks: state.draft.blocks.filter((_, i) => i !== index) },
                    blockKeys: state.blockKeys.filter((_, i) => i !== index),
                }
                : state
        ),

    resolveOverlap: (seat, changes) =>
        set((state) => {
            if (!state.draft) return state;
            let blocks = state.draft.blocks.slice();
            let keys = state.blockKeys.slice();

            // Trims and the in-place edit keep array length, so the plan's original indices stay
            // valid while we apply them; the removal filter runs last, against those same indices.
            for (const c of changes) if (c.kind === 'trim') blocks[c.index] = c.block;
            if (seat.index === null) {
                blocks = [...blocks, seat.block];
                keys = [...keys, nextKey()];
            } else {
                blocks[seat.index] = seat.block;
            }
            const drop = new Set(changes.filter((c) => c.kind === 'remove').map((c) => c.index));
            blocks = blocks.filter((_, i) => !drop.has(i));
            keys = keys.filter((_, i) => !drop.has(i));

            return { draft: { ...state.draft, blocks }, blockKeys: keys };
        }),

    commit: () => set((state) => (state.draft ? { baseline: toDraft(state.draft) } : state)),

    reset: () =>
        set((state) => {
            if (!state.baseline) return state;
            const draft = toDraft(state.baseline);
            return { draft, blockKeys: draft.blocks.map(nextKey) };
        }),

    clear: () => set({ baseline: null, draft: null, blockKeys: [] }),
}));
