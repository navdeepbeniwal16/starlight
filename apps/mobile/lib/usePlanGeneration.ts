import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { usePlanningStore } from "../stores/planning.store";

// Drives the "generate a plan" step shared by the planning-review screen and the
// onboarding first-task step: runs the agent, stores the proposal, and hands the
// caller control over where to go next (the two callers navigate differently).
export function usePlanGeneration() {
    const setProposal = usePlanningStore(s => s.setProposal);

    const [generating, setGenerating] = useState(false);
    const [generateError, setGenerateError] = useState<string | null>(null);
    const [generateErrorCode, setGenerateErrorCode] = useState<string | null>(null);
    const run = useRef<AbortController | null>(null);

    const generate = useCallback(async (onSuccess: () => void) => {
        if (run.current) return;
        const active = new AbortController();
        run.current = active;
        setGenerating(true);
        setGenerateError(null);
        setGenerateErrorCode(null);
        const result = await api.generatePlan(active.signal);
        // Drop the result if this run was superseded, so an aborted request
        // (cancel) or a stale one never errors or navigates.
        if (run.current !== active) return;
        run.current = null;
        setGenerating(false);
        if (result.ok) {
            setProposal(result.data);
            onSuccess();
        } else {
            setGenerateError(result.error);
            setGenerateErrorCode(result.code ?? null);
        }
    }, [setProposal]);

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
