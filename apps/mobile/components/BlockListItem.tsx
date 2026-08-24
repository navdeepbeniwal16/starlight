import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BlockInput } from "../lib/api.types";
import { formatTimeRange } from "../lib/time";
import { ENERGY_LABELS } from "../lib/templateBlocks";
import { PressableScale } from "./PressableScale";
import { colors, radius, spacing } from "../lib/theme";

export function BlockListItem({ block, onPress, invalid }: { block: BlockInput; onPress?: () => void; invalid?: boolean }) {
    const isContainer = block.type === 'CONTAINER';

    const containerStyle = [
        styles.blockItem,
        isContainer && styles.blockItemContainer,
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
                <Text style={styles.blockItemTime}>{formatTimeRange(block.startTime, block.endTime)}</Text>
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
        backgroundColor: colors.surface.block,
        overflow: 'hidden',
    },
    blockItemContainer: { borderWidth: 1.5, borderColor: 'rgba(42,38,33,0.16)', borderStyle: 'dashed' },
    blockItemInvalid: { borderWidth: 1, borderStyle: 'solid', borderColor: colors.danger.border, backgroundColor: colors.danger.tint },

    blockItemInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: 16 },
    blockItemMain: { flex: 1 },
    blockItemHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
    blockItemName: { fontSize: 15, fontWeight: '500', color: colors.text.primary, letterSpacing: -0.23, flexShrink: 1 },
    blockItemTime: { fontSize: 11, color: '#9a9389', letterSpacing: -0.15, marginTop: 3, fontVariant: ['tabular-nums'] },
    energyBadge: { backgroundColor: 'rgba(232,223,209,0.3)', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
    energyBadgeText: { fontSize: 12, color: 'rgba(122,115,106,0.6)' },
});
