import { Redirect } from "expo-router";

// The auth screens navigate to the bare `/(onboarding)` group; send them to the
// cover. Cold start and login pick their entry route (Today vs the cover) from
// onboardedAt directly, so they never land here.
export default function OnboardingIndex() {
    return <Redirect href="/(onboarding)/welcome" />;
}
