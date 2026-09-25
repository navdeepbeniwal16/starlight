import { Redirect, Stack } from "expo-router";
import { useAuth } from "@clerk/expo";

export default function AuthLayout() {
    const { isLoaded, isSignedIn } = useAuth();

    if (!isLoaded) return null;
    // A signed-in user has no business on the auth screens: bounce to the gate,
    // which routes them on to onboarding or main.
    if (isSignedIn) return <Redirect href="/" />;

    return <Stack screenOptions={{ headerShown: false }} />;
}
