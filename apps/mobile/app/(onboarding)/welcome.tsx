import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, radius, spacing } from "../../lib/theme";
import { PressableScale } from "../../components/PressableScale";
import { PlanPreview } from "../../components/PlanPreview";

// No progress eyebrow — the onboarding cover reads as a cover, not a working step.
export default function WelcomeScreen() {
    const router = useRouter();

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.container}>
                {/* Show the outcome first: a planned day forming before we ask for any input. */}
                <View style={styles.previewWrap}>
                    <PlanPreview />
                </View>

                <View style={styles.content}>
                    <View style={styles.promiseBlock}>
                        <Text style={styles.heading}>No more figuring out{"\n"}when to do it all.</Text>
                        <Text style={styles.body}>
                            You know your day better than any app does. Just sketch it out once, drop
                            in what's on your plate, and Starlight will figure out when to do what.
                        </Text>
                    </View>
                </View>

                <PressableScale style={styles.button} onPress={() => router.push('/(onboarding)/build')}>
                    <Text style={styles.buttonText}>Get started</Text>
                    <Ionicons name="arrow-forward" size={18} color={colors.surface.page} />
                </PressableScale>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: colors.surface.page,
    },
    container: {
        flex: 1,
        paddingHorizontal: 32,
        paddingTop: 20,
        paddingBottom: 32,
        justifyContent: 'space-between',
    },
    // space-between spreads the three groups: preview up top, promise in the
    // middle, button at the bottom — filling the space the cover used to waste.
    previewWrap: {
        paddingTop: spacing.sm,
    },
    content: {
        gap: spacing.xxl,
    },
    promiseBlock: {
        gap: 16,
    },
    heading: {
        fontSize: 26,
        fontWeight: '600',
        color: colors.text.primary,
        letterSpacing: -0.3,
        lineHeight: 30,
    },
    body: {
        fontSize: 15,
        color: colors.text.secondary,
        lineHeight: 22,
        letterSpacing: -0.1,
    },
    button: {
        height: 52,
        flexDirection: 'row',
        gap: spacing.sm,
        backgroundColor: colors.text.primary,
        borderRadius: radius.md,
        justifyContent: 'center',
        alignItems: 'center',
    },
    buttonText: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.surface.page,
        letterSpacing: -0.1,
    },
});
