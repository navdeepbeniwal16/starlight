import { create } from "zustand";
import { BlockInput } from "../lib/api.types";

type OnboardingState = {
    wakeTime: string | null;
    sleepTime: string | null;
    blocks: BlockInput[];
    setWakeSleepTimes: (wakeTime: string, sleepTime: string) => void;
    setBlocks: (blocks: BlockInput[]) => void;
    addBlock: (block: BlockInput) => void;
    removeBlock: (index: number) => void;
    updateBlock: (index: number, block: BlockInput) => void;
    reset: () => void;
};

export const useOnboardingStore = create<OnboardingState>((set) => ({
    wakeTime: null,
    sleepTime: null,
    blocks: [],

    setWakeSleepTimes: (wakeTime, sleepTime) => {
        set({ wakeTime, sleepTime });
    },

    setBlocks: (blocks) => {
        set({ blocks });
    },

    addBlock: (block) => {
        set((state) => ({ blocks: [...state.blocks, block] }));
    },

    removeBlock: (index) => {
        set((state) => ({ blocks: state.blocks.filter((_, i) => i !== index) }));
    },

    updateBlock: (index, block) => {
        set((state) => ({ blocks: state.blocks.map((b, i) => i === index ? block : b) }));
    },

    reset: () => {
        set({ wakeTime: null, sleepTime: null, blocks: [] });
    },
}));
