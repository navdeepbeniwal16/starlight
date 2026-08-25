import * as SecureStore from 'expo-secure-store';
import { ONBOARDING_STEPS, OnboardingStep } from './onboardingRouting';

const COMPLETED_KEY = 'onboarding_completed';
const FURTHEST_STEP_KEY = 'onboarding_furthest_step';

export async function getOnboardingCompleted(): Promise<boolean> {
    return (await SecureStore.getItemAsync(COMPLETED_KEY)) === 'true';
}

export async function setOnboardingCompleted(completed: boolean): Promise<void> {
    await SecureStore.setItemAsync(COMPLETED_KEY, completed ? 'true' : 'false');
}

export async function getFurthestOnboardingStep(): Promise<OnboardingStep | null> {
    const stored = await SecureStore.getItemAsync(FURTHEST_STEP_KEY);
    return isOnboardingStep(stored) ? stored : null;
}

export async function setFurthestOnboardingStep(step: OnboardingStep): Promise<void> {
    await SecureStore.setItemAsync(FURTHEST_STEP_KEY, step);
}

function isOnboardingStep(value: string | null): value is OnboardingStep {
    return value !== null && (ONBOARDING_STEPS as readonly string[]).includes(value);
}
