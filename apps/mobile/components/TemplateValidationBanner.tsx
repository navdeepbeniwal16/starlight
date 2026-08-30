import { View, Text, StyleSheet } from "react-native";
import { colors, spacing } from "../lib/theme";
import { hasContainer, isWakeBeforeSleep, type TemplateDraft } from "../lib/templateDraft";

// Whole-template failures only. Per-block bounds problems are deliberately called out on the
// block itself, so editing the sleep boundary at the bottom never hides the reason above the fold.
export function TemplateValidationBanner({ draft }: { draft: TemplateDraft }) {
    const wakeBeforeSleep = isWakeBeforeSleep(draft);
    const noContainer = draft.blocks.length > 0 && !hasContainer(draft);

    if (wakeBeforeSleep && !noContainer) return null;

    return (
        <View style={styles.validation}>
            {!wakeBeforeSleep && (
                <Text style={styles.boundsError}>Your wake time must be before your sleep time.</Text>
            )}
            {noContainer && (
                <Text style={styles.boundsError}>
                    Keep at least one Container block so Starlight has time to schedule tasks. Add one before saving.
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    validation: { gap: spacing.sm },
    boundsError: { fontSize: 13, color: colors.danger.default, lineHeight: 19, letterSpacing: -0.1 },
});
