import { Stack } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider, KeyboardToolbar } from "react-native-keyboard-controller";
import { Caprasimo_400Regular, useFonts } from "@expo-google-fonts/caprasimo";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

export default function RootLayout() {
  // Hold render until the brand font is ready so the wordmark never flashes a fallback.
  const [fontsLoaded] = useFonts({ Caprasimo_400Regular });
  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="planning" options={{ presentation: "modal" }} />
          </Stack>
          <KeyboardToolbar />
        </QueryClientProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
