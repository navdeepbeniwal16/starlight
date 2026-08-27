import { useLocalSearchParams } from "expo-router";
import { ReviewPlan } from "../../components/ReviewPlan";

// The default planning flow reaches this route inside the modally-presented
// `planning` stack. Onboarding renders the same board full-screen from its own
// group route instead (see app/(onboarding)/review.tsx).
export default function ReviewPlanScreen() {
    const { onboarding } = useLocalSearchParams<{ onboarding?: string }>();
    return <ReviewPlan onboarding={onboarding === '1'} />;
}
