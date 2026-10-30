import type { ReactNode } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { DayTemplate } from "../lib/api.types";
import { colors, radius, spacing, shadow } from "../lib/theme";
import { blockTypeTotals } from "../lib/templateDraft";
import { durationMins, formatDuration, formatTime } from "../lib/time";
import { PressableScale } from "./PressableScale";

// Day-template summary card shared by the Day Templates manager and the Step 2 picker; the
// caller supplies the recency line, trailing slot, and selected state so it reads right in both.
export function TemplateCard({
    template,
    onPress,
    recency,
    trailing,
    selected = false,
    activeScale = 0.98,
    accessibilityHint,
}: {
    template: DayTemplate;
    onPress: () => void;
    recency: string;
    trailing?: ReactNode;
    selected?: boolean;
    activeScale?: number;
    accessibilityHint?: string;
}) {
    const { container, anchor } = blockTypeTotals(template);
    const waking = durationMins(template.wakeTime, template.sleepTime);
    const free = Math.max(0, waking - container - anchor);

    // One spoken sentence instead of the card's fragments (name, bare times, legend dots)
    // read piecemeal; the colored bar is purely decorative so the legend text carries it.
    const label =
        `${template.name}. ${formatTime(template.wakeTime)} to ${formatTime(template.sleepTime)}. ` +
        `Time Blocks ${formatDuration(container)}, Events ${formatDuration(anchor)}, Available ${formatDuration(free)}. ${recency}`;

    return (
        <PressableScale
            style={[styles.card, selected && styles.cardSelected]}
            onPress={onPress}
            activeScale={activeScale}
            accessibilityLabel={label}
            accessibilityHint={accessibilityHint}
            accessibilityState={{ selected }}
        >
            <View style={styles.cardHeader}>
                <Text style={styles.name} numberOfLines={1}>{template.name}</Text>
                <Text style={styles.recency} numberOfLines={1}>{recency}</Text>
                {trailing}
            </View>

            <View style={styles.window}>
                <Ionicons name="sunny-outline" size={14} color={colors.accent.default} />
                <Text style={styles.windowText}>{formatTime(template.wakeTime)}</Text>
                <Text style={styles.windowDash}>–</Text>
                <Ionicons name="moon-outline" size={14} color="#9b8c7f" />
                <Text style={styles.windowText}>{formatTime(template.sleepTime)}</Text>
            </View>

            <View style={styles.bar}>
                {waking > 0 ? (
                    <>
                        {container > 0 && <View style={[styles.seg, styles.segContainer, { flex: container }]} />}
                        {anchor > 0 && <View style={[styles.seg, styles.segAnchor, { flex: anchor }]} />}
                        {free > 0 && <View style={[styles.seg, styles.segFree, { flex: free }]} />}
                    </>
                ) : (
                    <View style={[styles.seg, styles.segFree, { flex: 1 }]} />
                )}
            </View>

            <View style={styles.legend}>
                <View style={styles.legendItem}>
                    <View style={[styles.dot, styles.segContainer]} />
                    <Text style={styles.legendText}>Time Blocks {formatDuration(container)}</Text>
                </View>
                <View style={styles.legendItem}>
                    <View style={[styles.dot, styles.segAnchor]} />
                    <Text style={styles.legendText}>Events {formatDuration(anchor)}</Text>
                </View>
                <View style={styles.legendItem}>
                    <View style={[styles.dot, styles.dotFree]} />
                    <Text style={styles.legendText}>Available {formatDuration(free)}</Text>
                </View>
            </View>
        </PressableScale>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: colors.surface.raised,
        borderWidth: 1, borderColor: colors.border.hairline, borderRadius: radius.lg,
        padding: spacing.lg, gap: spacing.sm,
        ...shadow.soft,
    },
    cardSelected: { borderColor: colors.accent.default, backgroundColor: colors.accent.tint },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    name: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text.primary, letterSpacing: -0.2 },
    recency: { fontSize: 12, color: colors.text.muted, letterSpacing: -0.1 },

    window: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    windowText: { fontSize: 13, color: colors.text.secondary, letterSpacing: -0.1, fontVariant: ['tabular-nums'] },
    windowDash: { fontSize: 13, color: colors.text.muted, marginHorizontal: 1 },

    bar: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2, marginTop: 2 },
    seg: { height: '100%', borderRadius: 2 },
    segContainer: { backgroundColor: colors.accent.default },
    segAnchor: { backgroundColor: 'rgba(42,38,33,0.30)' },
    segFree: { backgroundColor: 'rgba(42,38,33,0.07)' },

    legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: spacing.xs, marginTop: 2 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    dotFree: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.border.strong },
    legendText: { fontSize: 12, color: colors.text.secondary, letterSpacing: -0.1, fontVariant: ['tabular-nums'] },
});
