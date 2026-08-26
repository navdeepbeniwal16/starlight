// Pure predicate for the onboarding first-task step — no React, so it stays unit-testable.
export type FirstTaskDraft = {
  title: string;
  estimatedMins: number | null;
};

export function canPlanFirstTask({ title, estimatedMins }: FirstTaskDraft): boolean {
  return title.trim().length > 0 && estimatedMins !== null;
}

// The onboarding step can plan the day as soon as at least one drafted task is
// itself plannable; incomplete drafts alongside it are ignored, not blocking.
export function canPlanTasks(entries: FirstTaskDraft[]): boolean {
  return entries.some(canPlanFirstTask);
}
