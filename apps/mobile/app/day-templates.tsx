import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import type { DayTemplate } from "../lib/api.types";
import { colors, radius, spacing, shadow } from "../lib/theme";
import { blockTypeTotals } from "../lib/templateDraft";
import { durationMins, formatDuration, formatTime } from "../lib/time";
import { buildBlankTemplate } from "../lib/starterTemplate";
import { useTemplateStore } from "../stores/template.store";
import { PressableScale } from "../components/PressableScale";

type ScreenState =
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; templates: DayTemplate[] };

// Coarse "time since" for the recency line. Recency, not an exact timestamp, is what
// helps the user tell templates apart, so it degrades to the largest sensible unit.
function formatRelative(iso: string): string {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
}

function TemplateCard({ template, onPress }: { template: DayTemplate; onPress: () => void }) {
    const { container, anchor } = blockTypeTotals(template);
    const waking = durationMins(template.wakeTime, template.sleepTime);
    const free = Math.max(0, waking - container - anchor);

    return (
        <PressableScale style={styles.card} onPress={onPress} activeScale={0.98}>
            <View style={styles.cardHeader}>
                <Text style={styles.name} numberOfLines={1}>{template.name}</Text>
                <Text style={styles.updated} numberOfLines={1}>Updated {formatRelative(template.updatedAt)}</Text>
                <Ionicons name="create-outline" size={18} color={colors.text.secondary} />
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

export default function DayTemplatesScreen() {
    const router = useRouter();
    const seed = useTemplateStore((s) => s.seed);
    const [state, setState] = useState<ScreenState>({ status: 'loading' });

    const load = useCallback(async () => {
        const result = await api.listDayTemplates();
        setState(result.ok
            ? { status: 'ready', templates: result.data }
            : { status: 'error', message: result.error });
    }, []);

    // Refetch on focus so an edit made in the editor is reflected when we pop back.
    useFocusEffect(useCallback(() => { load(); }, [load]));

    function handleCreate() {
        seed(buildBlankTemplate(), '');
        router.push('/day-template/new');
    }

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <View style={styles.backRow}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.7}>
                    <Ionicons name="chevron-back" size={20} color={colors.text.secondary} />
                    <Text style={styles.backLabel}>Settings</Text>
                </TouchableOpacity>
            </View>
            <View style={styles.titleRow}>
                <View style={styles.titleColumn}>
                    <Text style={styles.headerTitle}>Day Templates</Text>
                    <Text style={styles.headerSubtitle}>Tap a template to edit its shape.</Text>
                </View>
                <PressableScale style={styles.newButton} onPress={handleCreate} activeScale={0.92} hitSlop={10}>
                    <Ionicons name="add" size={20} color={colors.accent.default} />
                    <Text style={styles.newButtonText}>New</Text>
                </PressableScale>
            </View>

            {state.status === 'loading' && (
                <View style={styles.centered}>
                    <ActivityIndicator color={colors.accent.default} />
                </View>
            )}

            {state.status === 'error' && (
                <View style={styles.centered}>
                    <Text style={styles.errorText}>{state.message}</Text>
                    <PressableScale style={styles.retryButton} onPress={load}>
                        <Text style={styles.retryButtonText}>Try again</Text>
                    </PressableScale>
                </View>
            )}

            {state.status === 'ready' && (
                <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                    {state.templates.map((template) => (
                        <TemplateCard
                            key={template.id}
                            template={template}
                            onPress={() => router.push(`/day-template/${template.id}`)}
                        />
                    ))}
                </ScrollView>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.surface.page },

    backRow: { paddingHorizontal: 12, paddingTop: 20, paddingBottom: 2 },
    backButton: {
        flexDirection: 'row', alignItems: 'center', gap: 2,
        alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 4,
    },
    backLabel: { fontSize: 15, color: colors.text.secondary },
    titleRow: {
        flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md,
        paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12,
    },
    titleColumn: { flex: 1 },
    headerTitle: { fontSize: 18, fontWeight: '600', color: colors.text.primary, letterSpacing: -0.3 },
    headerSubtitle: { fontSize: 13, color: colors.text.secondary, lineHeight: 18, marginTop: 6, maxWidth: 320 },

    newButton: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4, paddingLeft: 4 },
    newButtonText: { fontSize: 15, fontWeight: '600', color: colors.accent.default, letterSpacing: -0.1 },

    scroll: { flex: 1 },
    content: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, gap: spacing.md },

    card: {
        backgroundColor: colors.surface.raised,
        borderWidth: 1, borderColor: colors.border.hairline, borderRadius: radius.lg,
        padding: spacing.lg, gap: spacing.sm,
        ...shadow.soft,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    name: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text.primary, letterSpacing: -0.2 },
    updated: { fontSize: 12, color: colors.text.muted, letterSpacing: -0.1 },

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

    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, gap: spacing.lg },
    errorText: { fontSize: 14, color: colors.text.secondary, textAlign: 'center' },
    retryButton: {
        height: 44, paddingHorizontal: spacing.xxl, backgroundColor: colors.accent.default,
        borderRadius: radius.md, justifyContent: 'center', alignItems: 'center',
    },
    retryButtonText: { fontSize: 15, fontWeight: '500', color: colors.text.onAccent, letterSpacing: -0.2 },
});
