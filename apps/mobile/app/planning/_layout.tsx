import { Stack } from "expo-router";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";


export default function PlanningLayout() {
    return (
        <BottomSheetModalProvider>
            <Stack screenOptions={{ headerShown: false }} />
        </BottomSheetModalProvider>
    );
}
