import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing, typography } from "../../lib/theme";
import { StepEyebrow } from "../../components/StepEyebrow";
import { PressableScale } from "../../components/PressableScale";

// Intentional placeholder — the real first-task capture (title + estimate) lands in a later slice.
export default function FirstTaskScreen() {
    const router = useRouter();

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <View style={styles.container}>
                <View>
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={() => router.back()}
                        activeOpacity={0.7}
                        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                    >
                        <Ionicons name="chevron-back" size={20} color={colors.text.secondary} />
                        <Text style={styles.backLabel}>Back</Text>
                    </TouchableOpacity>

                    <StepEyebrow step={2} total={3} />
                    <Text style={styles.title}>Your first task</Text>
                    <Text style={styles.subtitle}>Coming next — add a task and watch Starlight plan your day.</Text>
                </View>

                <PressableScale style={styles.button} onPress={() => router.replace('/(main)')}>
                    <Text style={styles.buttonText}>Go to Today</Text>
                </PressableScale>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.surface.page },
    container: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xl, justifyContent: 'space-between' },
    backButton: {
        flexDirection: 'row', alignItems: 'center', gap: 2,
        alignSelf: 'flex-start', paddingVertical: 6, marginLeft: -2, marginBottom: spacing.sm,
    },
    backLabel: { fontSize: 15, color: colors.text.secondary },
    title: { ...typography.title, color: colors.text.primary, letterSpacing: 0.07, marginTop: 2 },
    subtitle: { fontSize: 15, color: colors.text.secondary, lineHeight: 22, letterSpacing: -0.2, marginTop: spacing.sm },
    button: { height: 52, backgroundColor: colors.accent.default, borderRadius: radius.lg, justifyContent: 'center', alignItems: 'center' },
    buttonText: { fontSize: 16, fontWeight: '500', color: colors.text.onAccent, letterSpacing: -0.31 },
});
