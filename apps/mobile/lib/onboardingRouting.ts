// Pure routing decision — no React or navigation imports, so it stays unit-testable.
export const ONBOARDING_STEPS = ['welcome', 'build', 'first-task'] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const TODAY_ROUTE = '/(main)';

export const ONBOARDING_STEP_ROUTES: Record<OnboardingStep, string> = {
  welcome: '/(onboarding)/welcome',
  build: '/(onboarding)/build',
  'first-task': '/(onboarding)/first-task',
};

export type OnboardingProgress = {
  completed: boolean;
  furthestStep: OnboardingStep | null;
};

export function resolveAppEntryRoute({ completed, furthestStep }: OnboardingProgress): string {
  if (completed) return TODAY_ROUTE;
  return ONBOARDING_STEP_ROUTES[furthestStep ?? ONBOARDING_STEPS[0]];
}
