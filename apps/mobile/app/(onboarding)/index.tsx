import { Redirect } from "expo-router";

// The auth screens navigate to the bare `/(onboarding)` group; send them to the
// cover. Cold-start resume routes to a concrete step via the app entry resolver,
// so it never lands here.
export default function OnboardingIndex() {
    return <Redirect href="/(onboarding)/welcome" />;
}
