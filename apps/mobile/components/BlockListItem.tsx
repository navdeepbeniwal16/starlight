import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BlockInput } from "../lib/api.types";
import { parseDisplayTime } from "../lib/time";
import { ENERGY_LABELS } from "../lib/templateBlocks";
import { PressableScale } from "./PressableScale";
import { colors, radius, spacing, shadow } from "../lib/theme";

/**
 * A single day-template block row. Store-agnostic: fully driven by the `block`
 * prop
 */
export function BlockListItem({ block, onPress, invalid }: { block: BlockInput; onPress?: () => void; invalid?: boolean }) {
    const isContainer = block.type === 'CONTAINER';
    const isAnchor = block.type === 'ANCHOR';

    const containerStyle = [
        styles.blockItem,
        isContainer && styles.blockItemContainer,
        isAnchor && styles.blockItemAnchor,
        !isContainer && !isAnchor && styles.blockItemNoTask,
        invalid && styles.blockItemInvalid,
    ];

    const inner = (
        <View style={styles.blockItemInner}>
            <View style={styles.blockItemMain}>
                <View style={styles.blockItemHeader}>
                    <Text style={styles.blockItemName}>{block.name}</Text>
                    {isContainer && block.energyLevel && (
                        <View style={styles.energyBadge}>
                            <Text style={styles.energyBadgeText}>
                                {ENERGY_LABELS[block.energyLevel]} energy
                            </Text>
                        </View>
                    )}
                </View>
                <Text style={styles.blockItemTime}>
                    {parseDisplayTime(block.startTime).time} {parseDisplayTime(block.startTime).period} – {parseDisplayTime(block.endTime).time} {parseDisplayTime(block.endTime).period}
                </Text>
            </View>
            {onPress && <Ionicons name="create-outline" size={18} color={colors.text.muted} />}
        </View>
    );

    if (!onPress) {
        return <View style={containerStyle}>{inner}</View>;
    }

    return (
        <PressableScale onPress={onPress} style={containerStyle}>
            {inner}
        </PressableScale>
    );
}

const styles = StyleSheet.create({
    blockItem: {
        borderRadius: radius.lg,
        backgroundColor: colors.surface.raised,
    },
    blockItemContainer: { borderWidth: 1, borderColor: colors.border.strong, borderStyle: 'dashed', ...shadow.card },
    blockItemAnchor: { backgroundColor: colors.surface.sunken, borderWidth: 1, borderColor: colors.border.warm, borderStyle: 'solid' },
    blockItemNoTask: { backgroundColor: colors.surface.sunken, borderWidth: 1, borderColor: colors.border.warm, borderStyle: 'dashed' },
    blockItemInvalid: { borderWidth: 1, borderStyle: 'solid', borderColor: colors.danger.border, backgroundColor: colors.danger.tint },

    blockItemInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: 17 },
    blockItemMain: { flex: 1, gap: spacing.xs },
    blockItemHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    blockItemName: { fontSize: 15, fontWeight: '500', color: colors.text.primary, letterSpacing: -0.23, flexShrink: 1 },
    blockItemTime: { fontSize: 14, color: colors.text.secondary, letterSpacing: -0.15, fontVariant: ['tabular-nums'] },
    energyBadge: { backgroundColor: colors.accent.tint, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
    energyBadgeText: { fontSize: 12, fontWeight: '500', color: colors.accent.strong },
});
