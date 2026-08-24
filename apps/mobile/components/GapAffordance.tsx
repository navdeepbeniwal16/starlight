import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TemplateGap } from "../lib/templateDraft";
import { formatDuration } from "../lib/time";
import { PressableScale } from "./PressableScale";
import { colors } from "../lib/theme";

export function GapAffordance({ gap, onPress }: { gap: TemplateGap; onPress: () => void }) {
    return (
        <PressableScale style={styles.row} onPress={onPress} hitSlop={8}>
            <View style={styles.thread} />
            <View style={styles.pill}>
                <Ionicons name="add" size={13} color={colors.accent.default} />
                <Text style={styles.label}>{formatDuration(gap.durationMinutes)} free</Text>
            </View>
        </PressableScale>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    thread: { position: 'absolute', left: 10, top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(42,38,33,0.12)' },
    pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, marginHorizontal: 8 },
    label: { fontSize: 11, color: 'rgba(122,115,106,0.8)', letterSpacing: -0.1, fontVariant: ['tabular-nums'] },
});
