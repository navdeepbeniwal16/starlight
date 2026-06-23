import type { GeneratePlanResult } from "./api.types";

// In-memory handoff for the generated DRAFT between the Review Tasks screen
// (which calls POST /day-plan/:id/generate) and the Review Plan screen (T-07).
// Avoids serialising the populated plan through navigation params. Consumed once.
let generated: GeneratePlanResult | null = null;

export function setGeneratedPlan(result: GeneratePlanResult): void {
    generated = result;
}

export function takeGeneratedPlan(): GeneratePlanResult | null {
    const result = generated;
    generated = null;
    return result;
}
