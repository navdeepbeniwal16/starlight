import { create } from "zustand";
import { BlockInput, DayTemplate } from "../lib/api.types";
import { TemplateDraft } from "../lib/templateDraft";

// Backs the Day Template editor: the loaded `baseline` (server truth)
// alongside a `draft` the user edits.
// Blocks are held without ids; ids are dropped on hydrate.
type TemplateState = {
    baseline: TemplateDraft | null;
    draft: TemplateDraft | null;
    blockKeys: string[];
    hydrate: (template: DayTemplate) => void;
    setWakeSleep: (wakeTime: string, sleepTime: string) => void;
    updateBlock: (index: number, block: BlockInput) => void;
    addBlock: (block: BlockInput) => void;
    removeBlock: (index: number) => void;
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

    setWakeSleep: (wakeTime, sleepTime) =>
        set((state) => (state.draft ? { draft: { ...state.draft, wakeTime, sleepTime } } : state)),

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

    commit: () => set((state) => (state.draft ? { baseline: toDraft(state.draft) } : state)),

    reset: () =>
        set((state) => {
            if (!state.baseline) return state;
            const draft = toDraft(state.baseline);
            return { draft, blockKeys: draft.blocks.map(nextKey) };
        }),

    clear: () => set({ baseline: null, draft: null, blockKeys: [] }),
}));
