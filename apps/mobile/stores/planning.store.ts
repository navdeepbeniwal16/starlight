import { create } from "zustand";
import type { PlanProposal } from "../lib/api.types";

// Holds the generated plan proposal between the Review Tasks screen (which
// calls POST /day-plan/generate) and the Review Plan screen. The proposal only
// exists client-side — the server persists nothing until confirm — so this
// store is the single source of truth during review. It survives screen
// remounts and is cleared when the flow is confirmed or dismissed.
type PlanningState = {
    proposal: PlanProposal | null;
    setProposal: (proposal: PlanProposal) => void;
    clear: () => void;
};

export const usePlanningStore = create<PlanningState>((set) => ({
    proposal: null,
    setProposal: (proposal) => set({ proposal }),
    clear: () => set({ proposal: null }),
}));
