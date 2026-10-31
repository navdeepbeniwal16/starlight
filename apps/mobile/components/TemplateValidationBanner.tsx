import { View, Text, StyleSheet } from "react-native";
import { colors, spacing } from "../lib/theme";
import { hasContainer, isWakeBeforeSleep, type TemplateDraft } from "../lib/templateDraft";

// Whole-template failures only. Per-block bounds problems are deliberately called out on the
// block itself, so editing the sleep boundary at the bottom never hides the reason above the fold.
// `showContainerWarning` lets a caller own the missing-Time-Block prompt elsewhere (onboarding and
// the planning Step 2 surface it as a muted hint at their disabled primary action instead).
export function TemplateValidationBanner({ draft, showContainerWarning = true }: { draft: TemplateDraft; showContainerWarning?: boolean }) {
    const wakeBeforeSleep = isWakeBeforeSleep(draft);
    const noContainer = showContainerWarning && draft.blocks.length > 0 && !hasContainer(draft);

    if (wakeBeforeSleep && !noContainer) return null;

    return (
        <View style={styles.validation}>
            {!wakeBeforeSleep && (
                <Text style={styles.boundsError}>Your wake time must be before your sleep time.</Text>
            )}
            {noContainer && (
                <Text style={styles.boundsError}>
                    Keep at least one Time Block so Starlight has time to schedule tasks. Add one before saving.
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    validation: { gap: spacing.sm },
    boundsError: { fontSize: 13, color: colors.danger.default, lineHeight: 19, letterSpacing: -0.1 },
});
