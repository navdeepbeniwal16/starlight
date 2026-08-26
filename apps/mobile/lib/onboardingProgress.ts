import * as SecureStore from 'expo-secure-store';
import { ONBOARDING_STEPS, OnboardingStep } from './onboardingRouting';

// Onboarding completion is server-owned (User.onboardedAt). Only the resume
// hint — how far a still-onboarding user has reached — is kept device-local.
const FURTHEST_STEP_KEY = 'onboarding_furthest_step';

export async function getFurthestOnboardingStep(): Promise<OnboardingStep | null> {
    const stored = await SecureStore.getItemAsync(FURTHEST_STEP_KEY);
    return isOnboardingStep(stored) ? stored : null;
}

// Monotonic: a step only ever advances the hint. Stepping back (e.g. build →
// welcome, or the first-task → build round-trip) must not rewind where resume lands.
export async function setFurthestOnboardingStep(step: OnboardingStep): Promise<void> {
    const current = await getFurthestOnboardingStep();
    if (current !== null && ONBOARDING_STEPS.indexOf(current) >= ONBOARDING_STEPS.indexOf(step)) return;
    await SecureStore.setItemAsync(FURTHEST_STEP_KEY, step);
}

// The hint is device-local and not user-bound, so it must be wiped on any identity
// change (signup/logout) or it leaks into the next account on the same device.
export async function clearFurthestOnboardingStep(): Promise<void> {
    await SecureStore.deleteItemAsync(FURTHEST_STEP_KEY);
}

function isOnboardingStep(value: string | null): value is OnboardingStep {
    return value !== null && (ONBOARDING_STEPS as readonly string[]).includes(value);
}
