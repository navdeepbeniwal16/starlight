import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { formatTime } from "../lib/time";

export function TimelineThread() {
    return (
        <View style={styles.threadSegment}>
            <View style={styles.threadLine} />
        </View>
    );
}

export function DayBoundaryMarker({ label, time, onPress }: { label: 'Wake' | 'Sleep'; time: string; onPress?: () => void }) {
    const isWake = label === 'Wake';
    const accent = isWake ? '#d4a574' : '#9b8c7f';

    const timeText = (
        <Text style={[styles.boundaryTime, !isWake && styles.boundaryTimeSleep]}>
            {formatTime(time)}
        </Text>
    );

    return (
        <View style={styles.boundaryRow}>
            <Ionicons
                name={isWake ? 'sunny-outline' : 'moon-outline'}
                size={16}
                color={accent}
                style={styles.boundaryIcon}
            />
            <Text style={[styles.boundaryLabel, !isWake && styles.boundaryLabelSleep]}>
                {label.toLowerCase()}
            </Text>
            {onPress ? (
                <Pressable onPress={onPress} hitSlop={10} style={styles.boundaryEdit}>
                    {timeText}
                    <Ionicons name="chevron-down" size={14} color={accent} />
                </Pressable>
            ) : timeText}
        </View>
    );
}

const styles = StyleSheet.create({
    threadSegment: { height: 12, paddingLeft: 10, justifyContent: 'center' },
    threadLine: { width: 1, flex: 1, backgroundColor: 'rgba(42,38,33,0.12)' },

    boundaryRow: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 2 },
    boundaryIcon: { width: 22, textAlign: 'center' },
    boundaryLabel: { fontSize: 10, fontWeight: '400', color: '#d4a574', letterSpacing: 0.5, textTransform: 'uppercase' },
    boundaryLabelSleep: { color: '#9b8c7f' },
    boundaryTime: { fontSize: 13, fontWeight: '500', color: '#2a2621', letterSpacing: -0.15, fontVariant: ['tabular-nums'] },
    boundaryTimeSleep: { color: 'rgba(42,38,33,0.6)' },
    boundaryEdit: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
