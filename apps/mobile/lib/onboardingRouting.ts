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

// Where a Back control should land when there is no navigation history to pop
// (a resumed user can enter mid-flow). Null at the cover step, which has no Back.
export function previousStepRoute(step: OnboardingStep): string | null {
  const index = ONBOARDING_STEPS.indexOf(step);
  if (index <= 0) return null;
  return ONBOARDING_STEP_ROUTES[ONBOARDING_STEPS[index - 1]];
}
