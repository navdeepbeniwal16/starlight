import { View, Text, StyleSheet } from "react-native";
import { colors, spacing } from "../lib/theme";
import { formatTime } from "../lib/time";
import { blocksOutOfBounds, hasContainer, isWakeBeforeSleep, type TemplateDraft } from "../lib/templateDraft";

// TemplateValidationBanner shows the template editor's inline validation, or nothing when
// the draft is valid on these axes. Shared by the settings editor and the onboarding Build
// step so both surface identical messages.
export function TemplateValidationBanner({ draft }: { draft: TemplateDraft }) {
    const wakeBeforeSleep = isWakeBeforeSleep(draft);
    // The bounds check is meaningless while the window is inverted, so skip it then.
    const outOfBounds = wakeBeforeSleep ? blocksOutOfBounds(draft) : [];
    const noContainer = draft.blocks.length > 0 && !hasContainer(draft);

    if (wakeBeforeSleep && outOfBounds.length === 0 && !noContainer) return null;

    return (
        <View style={styles.validation}>
            {!wakeBeforeSleep && (
                <Text style={styles.boundsError}>Your wake time must be before your sleep time.</Text>
            )}
            {wakeBeforeSleep && outOfBounds.length > 0 && (
                <Text style={styles.boundsError}>
                    {outOfBounds.length === 1 ? 'This block is' : 'These blocks are'} outside your{' '}
                    {formatTime(draft.wakeTime)}–{formatTime(draft.sleepTime)} window:{' '}
                    {outOfBounds.map((o) => o.block.name).join(', ')}. Edit to fit the new window before saving.
                </Text>
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
