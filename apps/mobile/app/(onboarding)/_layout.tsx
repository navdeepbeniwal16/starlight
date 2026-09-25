import { Redirect, Stack } from "expo-router";
import { useAuth } from "@clerk/expo";

export default function OnboardingLayout() {
    const { isLoaded, isSignedIn } = useAuth();

    if (!isLoaded) return null;
    // Guard the authed area declaratively: sign-out clears the Clerk session and
    // this redirect fires, with no imperative navigation at the call site.
    if (!isSignedIn) return <Redirect href="/(auth)/login" />;

    return <Stack screenOptions={{ headerShown: false }} />;
}
