import { Redirect } from "expo-router";
import { useAuth } from "@clerk/expo";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { api } from "../lib/api";
import { useSessionStore } from "../stores/session.store";

// The single routing brain. Clerk resolves the session (persisted in secure
// store), then GET /me/onboarding decides onboarding vs main. Every other route
// group only guards signed-out; none of them route by onboarding state.
export default function Index() {
  const { isLoaded, isSignedIn } = useAuth();
  const setOnboardedAt = useSessionStore((state) => state.setOnboardedAt);
  const [destination, setDestination] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      setDestination("/(auth)/login");
      return;
    }

    let active = true;
    (async () => {
      const result = await api.getOnboarding();
      if (!active) return;

      if (result.ok) {
        setOnboardedAt(result.data.onboardedAt);
        setDestination(result.data.onboardedAt ? "/(main)" : "/(onboarding)/welcome");
      } else {
        // Signed in but the onboarding lookup failed (transient network). Send an
        // already-onboarded user to their day rather than trapping the spinner;
        // an unonboarded user can still reach onboarding from Today, whereas
        // re-running onboarding for an onboarded user would be worse.
        setDestination("/(main)");
      }
    })();

    return () => {
      active = false;
    };
  }, [isLoaded, isSignedIn, setOnboardedAt]);

  if (!destination) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <Redirect href={destination} />;
}
