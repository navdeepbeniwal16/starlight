import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { GeneratePlanRequest } from "./api.types";
import { usePlanningStore } from "../stores/planning.store";

// The caller owns post-success navigation because the two call sites (planning
// Step 2 and onboarding first-task) go to different screens from here.
export function usePlanGeneration() {
    const setProposal = usePlanningStore(s => s.setProposal);
    const setTemplateId = usePlanningStore(s => s.setTemplateId);

    const [generating, setGenerating] = useState(false);
    const [generateError, setGenerateError] = useState<string | null>(null);
    const [generateErrorCode, setGenerateErrorCode] = useState<string | null>(null);
    const run = useRef<AbortController | null>(null);

    const generate = useCallback(async (req: GeneratePlanRequest, onSuccess: () => void) => {
        if (run.current) return;
        const active = new AbortController();
        run.current = active;
        setGenerating(true);
        setGenerateError(null);
        setGenerateErrorCode(null);
        const result = await api.generatePlan(req, active.signal);
        // Drop the result if this run was superseded, so an aborted request
        // (cancel) or a stale one never errors or navigates.
        if (run.current !== active) return;
        run.current = null;
        setGenerating(false);
        if (result.ok) {
            setProposal(result.data);
            // Carry the template forward so confirm echoes the same id.
            setTemplateId(req.templateId);
            onSuccess();
        } else {
            setGenerateError(result.error);
            setGenerateErrorCode(result.code ?? null);
        }
    }, [setProposal, setTemplateId]);

    const cancel = useCallback(() => {
        run.current?.abort();
        run.current = null;
        setGenerating(false);
    }, []);

    // Drop an in-flight run on unmount (e.g. Android hardware-back mid-generation).
    // Nulling run.current makes the pending resolve hit the stale-run guard, so it
    // never navigates or setStates a screen that's gone. Deliberately not cancel() —
    // that setGenerating(false) would itself be the setState-after-unmount we avoid.
    useEffect(() => () => {
        run.current?.abort();
        run.current = null;
    }, []);

    const dismissError = useCallback(() => {
        setGenerateError(null);
        setGenerateErrorCode(null);
    }, []);

    return { generating, generateError, generateErrorCode, generate, cancel, dismissError };
}
