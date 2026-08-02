import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { BlockInput } from "../lib/api.types";
import { parseDisplayTime } from "../lib/time";
import { ENERGY_LABELS } from "../lib/templateBlocks";

/**
 * A single day-template block row. Store-agnostic: fully driven by the `block`
 * prop and an `onPress` callback, so it is reused by both onboarding and the
 * post-onboarding template editor.
 */
export function BlockListItem({ block, onPress }: { block: BlockInput; onPress: () => void }) {
    const isContainer = block.type === 'CONTAINER';
    const isAnchor = block.type === 'ANCHOR';

    return (
        <TouchableOpacity
            activeOpacity={0.75}
            onPress={onPress}
            style={[
                styles.blockItem,
                isContainer && styles.blockItemContainer,
                isAnchor && styles.blockItemAnchor,
                !isContainer && !isAnchor && styles.blockItemNoTask,
            ]}
        >
            <View style={styles.blockItemInner}>
                <View style={styles.blockItemContent}>
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
                <Text style={styles.blockItemChevron}>›</Text>
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    blockItem: { borderRadius: 16, overflow: 'hidden' },
    blockItemContainer: { borderWidth: 1, borderColor: 'rgba(42,38,33,0.10)', borderStyle: 'dashed' },
    blockItemAnchor: { backgroundColor: 'rgba(232,228,221,0.3)' },
    blockItemNoTask: { borderWidth: 1, borderColor: 'rgba(42,38,33,0.10)', borderStyle: 'dashed', backgroundColor: 'rgba(232,228,221,0.18)' },
    blockItemInner: { flexDirection: 'row', alignItems: 'center', padding: 17 },
    blockItemContent: { flex: 1, gap: 4 },
    blockItemHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    blockItemName: { fontSize: 15, fontWeight: '500', color: '#2a2621', letterSpacing: -0.23 },
    blockItemTime: { fontSize: 14, color: '#7a736a', letterSpacing: -0.15 },
    energyBadge: { backgroundColor: 'rgba(232,223,209,0.5)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
    energyBadgeText: { fontSize: 12, color: '#d4a574' },
    blockItemChevron: { fontSize: 18, color: '#c0b8b0', paddingLeft: 12 },
});
