import { ReviewPlan } from "../../components/ReviewPlan";

// Step 3 of onboarding renders the plan-review board as a full-screen card in
// the onboarding stack, matching the earlier steps — unlike /planning/plan,
// which the default flow presents as a modal.
export default function OnboardingReviewScreen() {
    return <ReviewPlan onboarding />;
}
