import { Text, StyleSheet } from "react-native";
import { TemplateGap } from "../lib/templateDraft";
import { formatDuration, parseDisplayTime } from "../lib/time";
import { PressableScale } from "./PressableScale";

// Formats a range like "2:00–8:00 PM", collapsing the meridiem when both ends share it.
function formatRange(start: string, end: string): string {
    const s = parseDisplayTime(start);
    const e = parseDisplayTime(end);
    return s.period === e.period
        ? `${s.time}–${e.time} ${e.period}`
        : `${s.time} ${s.period} – ${e.time} ${e.period}`;
}

// A recessive add affordance for a free span: borderless and centered,
// so it reads as an interstitial hint rather than another block.
export function GapAffordance({ gap, onPress }: { gap: TemplateGap; onPress: () => void }) {
    return (
        <PressableScale style={styles.gap} onPress={onPress} hitSlop={8}>
            <Text style={styles.plus}>＋</Text>
            <Text style={styles.label}>
                {formatDuration(gap.durationMinutes)} free · {formatRange(gap.startTime, gap.endTime)}
            </Text>
        </PressableScale>
    );
}

const styles = StyleSheet.create({
    gap: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        paddingVertical: 6,
    },
    plus: { fontSize: 14, fontWeight: '500', color: 'rgba(212,165,116,0.9)' },
    label: { fontSize: 12.5, color: 'rgba(122,115,106,0.55)', letterSpacing: -0.1, fontVariant: ['tabular-nums'] },
});
