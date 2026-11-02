import { create } from "zustand";
import type { PlanProposal } from "../lib/api.types";

// Holds the generated plan proposal between the Review Tasks screen (which
// calls POST /day-plan/generate) and the Review Plan screen. The proposal only
// exists client-side — the server persists nothing until confirm — so this
// store is the single source of truth during review. It survives screen
// remounts and is cleared when the flow is confirmed or dismissed.
//
// `templateId` is the template the shape was generated from; confirm must echo
// the same id, so it rides alongside the proposal rather than being re-resolved.
type PlanningState = {
    proposal: PlanProposal | null;
    templateId: string | null;
    setProposal: (proposal: PlanProposal) => void;
    setTemplateId: (templateId: string) => void;
    clear: () => void;
};

export const usePlanningStore = create<PlanningState>((set) => ({
    proposal: null,
    templateId: null,
    setProposal: (proposal) => set({ proposal }),
    setTemplateId: (templateId) => set({ templateId }),
    clear: () => set({ proposal: null, templateId: null }),
}));
