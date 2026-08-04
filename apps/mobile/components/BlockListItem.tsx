import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BlockInput } from "../lib/api.types";
import { parseDisplayTime } from "../lib/time";
import { ENERGY_LABELS } from "../lib/templateBlocks";
import { PressableScale } from "./PressableScale";

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
            <View style={styles.blockItemHeader}>
                <Text style={styles.blockItemName}>{block.name}</Text>
                <View style={styles.blockItemHeaderRight}>
                    {isContainer && block.energyLevel && (
                        <View style={styles.energyBadge}>
                            <Text style={styles.energyBadgeText}>
                                {ENERGY_LABELS[block.energyLevel]} energy
                            </Text>
                        </View>
                    )}
                    {onPress && <Ionicons name="create-outline" size={18} color="#b0a89f" />}
                </View>
            </View>
            <Text style={styles.blockItemTime}>
                {parseDisplayTime(block.startTime).time} {parseDisplayTime(block.startTime).period} – {parseDisplayTime(block.endTime).time} {parseDisplayTime(block.endTime).period}
            </Text>
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
        borderRadius: 16,
        backgroundColor: '#fffef9',
        shadowColor: '#2a2621',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 5,
        elevation: 1,
    },
    blockItemContainer: { borderWidth: 1, borderColor: 'rgba(42,38,33,0.10)', borderStyle: 'dashed' },
    blockItemAnchor: { backgroundColor: 'rgba(232,228,221,0.3)' },
    blockItemNoTask: { borderWidth: 1, borderColor: 'rgba(42,38,33,0.10)', borderStyle: 'dashed', backgroundColor: 'rgba(232,228,221,0.18)' },
    blockItemInvalid: { borderWidth: 1, borderStyle: 'solid', borderColor: 'rgba(192,57,43,0.55)', backgroundColor: 'rgba(192,57,43,0.05)' },
    blockItemInner: { padding: 17, gap: 4 },
    blockItemHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    blockItemHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    blockItemName: { fontSize: 15, fontWeight: '500', color: '#2a2621', letterSpacing: -0.23 },
    blockItemTime: { fontSize: 14, color: '#7a736a', letterSpacing: -0.15, fontVariant: ['tabular-nums'] },
    energyBadge: { backgroundColor: 'rgba(232,223,209,0.5)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
    energyBadgeText: { fontSize: 12, color: '#d4a574' },
});
