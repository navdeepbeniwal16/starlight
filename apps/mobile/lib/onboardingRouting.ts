// Pure onboarding routing: given persisted progress, decide where app entry
// should send an authenticated user. Kept free of React and navigation
// internals so it can be unit-tested in isolation.

// The onboarding screens in the order the user walks through them. The first
// entry is where a brand-new user starts.
export const ONBOARDING_STEPS = ['welcome', 'wake-sleep', 'blocks', 'review', 'finish'] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const TODAY_ROUTE = '/(main)';

export const ONBOARDING_STEP_ROUTES: Record<OnboardingStep, string> = {
  welcome: '/(onboarding)/welcome',
  'wake-sleep': '/(onboarding)/wake-sleep',
  blocks: '/(onboarding)/blocks',
  review: '/(onboarding)/review',
  finish: '/(onboarding)/finish',
};

export type OnboardingProgress = {
  completed: boolean;
  // Furthest step the user has reached; null for someone who never started.
  furthestStep: OnboardingStep | null;
};

export function resolveAppEntryRoute({ completed, furthestStep }: OnboardingProgress): string {
  if (completed) return TODAY_ROUTE;
  return ONBOARDING_STEP_ROUTES[furthestStep ?? ONBOARDING_STEPS[0]];
}
