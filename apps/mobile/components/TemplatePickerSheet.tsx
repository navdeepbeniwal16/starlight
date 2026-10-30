import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import type { DayTemplate } from "../lib/api.types";
import { colors, radius, spacing } from "../lib/theme";
import { templateRecencyLabel } from "../lib/planTemplate";
import { TemplateCard } from "./TemplateCard";

// Bottom sheet for switching which template Step 2 builds the day from. Selection is handed
// back to the caller — this sheet persists nothing; only confirming a plan records the template.
export function TemplatePickerSheet({
    visible,
    onClose,
    templates,
    selectedId,
    onSelect,
}: {
    visible: boolean;
    onClose: () => void;
    templates: DayTemplate[];
    selectedId: string | null;
    onSelect: (template: DayTemplate) => void;
}) {
    const insets = useSafeAreaInsets();

    return (
        <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
            <TouchableWithoutFeedback onPress={onClose}>
                <View style={styles.overlay}>
                    <TouchableWithoutFeedback>
                        <View style={styles.sheet}>
                            <View style={styles.dragIndicator} />
                            <View style={styles.header}>
                                <Text style={styles.title} accessibilityRole="header">Your templates</Text>
                                <TouchableOpacity
                                    style={styles.closeButton}
                                    onPress={onClose}
                                    hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
                                    activeOpacity={0.6}
                                    accessibilityRole="button"
                                    accessibilityLabel="Close template picker"
                                >
                                    <Feather name="x" size={20} color={colors.text.primary} />
                                </TouchableOpacity>
                            </View>
                            <View style={styles.divider} />
                            <Text style={styles.subtitle}>Pick one for today. Use it as is or adjust it.</Text>

                            <ScrollView
                                style={styles.scroll}
                                contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
                                showsVerticalScrollIndicator={false}
                            >
                                {templates.map((template) => {
                                    const selected = template.id === selectedId;
                                    return (
                                        <TemplateCard
                                            key={template.id}
                                            template={template}
                                            onPress={() => onSelect(template)}
                                            recency={templateRecencyLabel(template)}
                                            selected={selected}
                                            accessibilityHint={
                                                selected ? 'Your current template' : 'Starts today from this template'
                                            }
                                            trailing={
                                                selected
                                                    ? <Ionicons name="checkmark-circle" size={22} color={colors.accent.strong} />
                                                    : <View style={styles.trailingSpacer} />
                                            }
                                        />
                                    );
                                })}
                            </ScrollView>
                        </View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim },
    // Fixed tall sheet matching the planning-flow block editor, so it fills the screen the same
    // way regardless of how many templates there are, rather than collapsing to content height.
    sheet: { backgroundColor: colors.surface.page, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, height: '94%' },
    dragIndicator: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border.strong, alignSelf: 'center', marginTop: 10, marginBottom: 2 },

    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16 },
    title: { fontSize: 18, fontWeight: '600', color: colors.text.primary, letterSpacing: -0.3 },
    closeButton: { position: 'absolute', right: 24 },
    divider: { height: 1, backgroundColor: colors.border.hairline },
    subtitle: { fontSize: 13, color: colors.text.secondary, lineHeight: 18, textAlign: 'center', paddingHorizontal: 24, paddingTop: 14, marginBottom: 4 },

    scroll: { flex: 1 },
    content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.md },

    // Invisible placeholder so the selected card's check icon doesn't shift the title row of
    // unselected cards — selection itself reads from the card's accent border and tint.
    trailingSpacer: { width: 22, height: 22 },
});
