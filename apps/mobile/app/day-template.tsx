import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
    SlideInDown,
    SlideOutDown,
    FadeIn,
    FadeInDown,
    FadeOut,
    LinearTransition,
    useSharedValue,
    useAnimatedStyle,
    useAnimatedScrollHandler,
    interpolate,
    Extrapolation,
    withSequence,
    withTiming,
    type EntryOrExitLayoutType,
} from "react-native-reanimated";
import { api } from "../lib/api";
import { colors, radius, spacing, shadow, typography } from "../lib/theme";
import type { BlockInput } from "../lib/api.types";
import { formatTime } from "../lib/time";
import { isTemplateDirty, isTemplateValid, isWakeBeforeSleep, blocksOutOfBounds, buildTimeline, hasContainer } from "../lib/templateDraft";
import { useTemplateStore } from "../stores/template.store";
import { BlockListItem } from "../components/BlockListItem";
import { BlockEditorModal } from "../components/BlockEditorModal";
import { GapAffordance } from "../components/GapAffordance";
import { WakeSleepBar } from "../components/WakeSleepBar";
import { PressableScale } from "../components/PressableScale";

const ROW_LAYOUT = LinearTransition.springify().dampingRatio(1);

// What the block modal is open on: editing a block in place, or adding one into a gap.
type EditorTarget =
    | { mode: 'edit'; index: number }
    | { mode: 'add'; startTime: string; endTime: string };

export default function DayTemplateScreen() {
    const router = useRouter();
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();

    const { baseline, draft, blockKeys, hydrate, setWakeSleep, updateBlock, addBlock, removeBlock, commit, reset, clear } = useTemplateStore();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // The block modal's target: an existing block by index, a gap's range to add into,
    // or null when closed. A single state keeps the two modes mutually exclusive.
    const [editor, setEditor] = useState<EditorTarget | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [savedVisible, setSavedVisible] = useState(false);
    const [entering, setEntering] = useState(false);
    // The draft row to flash after an add or edit lands, keyed by the block's start time.
    // The nonce lets re-touching the same row retrigger the flash.
    const [flashFor, setFlashFor] = useState<{ key: string; nonce: number }>({ key: '', nonce: 0 });

    const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Memoized so the serialize-and-validate work reruns only when the draft or
    // baseline changes, not on every toast, flash, or saving update.
    const dirty = useMemo(() => isTemplateDirty(baseline, draft), [baseline, draft]);
    const valid = useMemo(() => isTemplateValid(draft), [draft]);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        const result = await api.getDayTemplate();
        if (result.ok) {
            hydrate(result.data);
            setEntering(true);
        } else {
            setError(result.error);
        }
        setLoading(false);
    }, [hydrate]);

    useEffect(() => {
        if (!entering) return;
        const t = setTimeout(() => setEntering(false), 1200);
        return () => clearTimeout(t);
    }, [entering]);

    useEffect(() => {
        load();
    }, [load]);

    // Drop the working draft, and cancel any pending toast timer, on unmount.
    useEffect(() => () => {
        clear();
        if (savedTimer.current) clearTimeout(savedTimer.current);
    }, [clear]);

    // Confirm before discarding unsaved edits on any back navigation.
    useEffect(() => {
        const sub = navigation.addListener('beforeRemove', (e: any) => {
            if (!dirty) return;
            e.preventDefault();
            Alert.alert(
                'Discard changes?',
                'You have unsaved edits to your day template.',
                [
                    { text: 'Keep editing', style: 'cancel' },
                    { text: 'Discard', style: 'destructive', onPress: () => { reset(); navigation.dispatch(e.data.action); } },
                ]
            );
        });
        return sub;
    }, [navigation, dirty, reset]);

    function handleWakeSleep(wake: string, sleep: string) {
        setSaveError(null);
        setWakeSleep(wake, sleep);
    }

    function handleEditorSubmit(block: BlockInput) {
        if (!editor) return;
        if (editor.mode === 'edit') updateBlock(editor.index, block);
        else addBlock(block);
        setFlashFor((f) => ({ key: `block-${block.startTime}`, nonce: f.nonce + 1 }));
        setSaveError(null);
        setEditor(null);
    }

    function handleBlockDelete() {
        if (editor?.mode === 'edit') {
            removeBlock(editor.index);
            setSaveError(null);
        }
        setEditor(null);
    }

    async function handleSave() {
        if (!draft) return;
        setSaving(true);
        setSaveError(null);
        const result = await api.updateDayTemplate(draft);
        setSaving(false);
        if (result.ok) {
            // Adopt the draft as the new baseline so the screen is no longer dirty.
            commit();
            setSavedVisible(true);
            if (savedTimer.current) clearTimeout(savedTimer.current);
            savedTimer.current = setTimeout(() => setSavedVisible(false), 1800);
        } else {
            setSaveError(result.error);
        }
    }

    const rows = useMemo(() => buildTimeline(draft), [draft]);

    // Skip the bounds check while wake and sleep are inverted; the window is meaningless then.
    const wakeBeforeSleep = isWakeBeforeSleep(draft);
    const outOfBounds = useMemo(
        () => (wakeBeforeSleep ? blocksOutOfBounds(draft) : []),
        [draft, wakeBeforeSleep],
    );
    const outOfBoundsIndexes = useMemo(() => new Set(outOfBounds.map((o) => o.index)), [outOfBounds]);

    // The draft has blocks but no CONTAINER, which is invalid and worth flagging on its own.
    const noContainer = !!draft && draft.blocks.length > 0 && !hasContainer(draft);

    const canSave = dirty && valid && !saving;

    const scrollY = useSharedValue(0);
    const scrollHandler = useAnimatedScrollHandler((e) => { scrollY.value = e.contentOffset.y; });
    const scrollEdgeStyle = useAnimatedStyle(() => ({
        opacity: interpolate(scrollY.value, [0, 12], [0, 1], Extrapolation.CLAMP),
    }));

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.backRow}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.7} hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}>
                    <Ionicons name="chevron-back" size={20} color={colors.text.secondary} />
                    <Text style={styles.backLabel}>Settings</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.header}>
                <Text style={styles.headerTitle}>Day Template</Text>
            </View>

            {loading && (
                <Animated.View style={styles.centered} exiting={FadeOut.duration(220)}>
                    <ActivityIndicator color={colors.accent.default} />
                </Animated.View>
            )}

            {!loading && error && (
                <View style={styles.centered}>
                    <Text style={styles.errorText}>{error}</Text>
                    <PressableScale style={styles.retryButton} onPress={load}>
                        <Text style={styles.retryButtonText}>Try again</Text>
                    </PressableScale>
                </View>
            )}

            {!loading && !error && draft && (
                <Animated.View style={styles.contentFill} entering={entering ? FadeIn.duration(240) : undefined}>
                    <Animated.View pointerEvents="none" style={[styles.scrollEdge, scrollEdgeStyle]} />
                    <Animated.ScrollView
                        style={styles.scroll}
                        contentContainerStyle={[styles.content, dirty && { paddingBottom: 96 + insets.bottom }]}
                        showsVerticalScrollIndicator={false}
                        onScroll={scrollHandler}
                        scrollEventThrottle={16}
                    >
                        <Animated.View
                            style={styles.wakeSleepSection}
                            entering={entering ? FadeInDown.duration(300) : undefined}
                        >
                            <WakeSleepBar
                                wakeTime={draft.wakeTime}
                                sleepTime={draft.sleepTime}
                                onChange={handleWakeSleep}
                            />
                            {!wakeBeforeSleep && (
                                <Text style={styles.boundsError}>Your wake time must be before your sleep time.</Text>
                            )}
                            {wakeBeforeSleep && outOfBounds.length > 0 && (
                                <Text style={styles.boundsError}>
                                    {outOfBounds.length === 1 ? 'This block is' : 'These blocks are'} outside your{' '}
                                    {formatTime(draft.wakeTime)}–{formatTime(draft.sleepTime)} window:{' '}
                                    {outOfBounds.map((o) => o.block.name).join(', ')}. Edit to fit the new window before saving.
                                </Text>
                            )}
                        </Animated.View>

                        <Animated.View
                            style={styles.legend}
                            entering={entering ? FadeInDown.duration(300).delay(40) : undefined}
                        >
                            <View style={styles.legendItem}>
                                <View style={[styles.legendSwatch, styles.legendSwatchContainer]} />
                                <Text style={styles.legendText}>Container</Text>
                            </View>
                            <View style={styles.legendItem}>
                                <View style={[styles.legendSwatch, styles.legendSwatchAnchor]} />
                                <Text style={styles.legendText}>Anchor</Text>
                            </View>
                        </Animated.View>

                        <View style={styles.blockList}>
                            {noContainer && (
                                <Text style={styles.boundsError}>
                                    Keep at least one Container block so Starlight has time to schedule tasks. Add one before saving.
                                </Text>
                            )}

                            {rows.map((row, i) =>
                                row.kind === 'block' ? (
                                    <BlockRow
                                        key={blockKeys[row.index]}
                                        signal={flashFor.key === `block-${row.startTime}` ? flashFor.nonce : 0}
                                        entering={entering ? FadeInDown.duration(300).delay((i + 1) * 40) : undefined}
                                    >
                                        <BlockListItem
                                            block={row.block}
                                            onPress={() => setEditor({ mode: 'edit', index: row.index })}
                                            invalid={outOfBoundsIndexes.has(row.index)}
                                        />
                                    </BlockRow>
                                ) : (
                                    <Animated.View
                                        key={`gap-${row.startTime}`}
                                        layout={ROW_LAYOUT}
                                        entering={entering ? FadeInDown.duration(300).delay((i + 1) * 40) : FadeIn.duration(160)}
                                        exiting={FadeOut.duration(160)}
                                    >
                                        <GapAffordance
                                            gap={row.gap}
                                            onPress={() => setEditor({ mode: 'add', startTime: row.gap.startTime, endTime: row.gap.endTime })}
                                        />
                                    </Animated.View>
                                )
                            )}
                        </View>
                    </Animated.ScrollView>

                    {dirty && (
                        <Animated.View
                            style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}
                            entering={SlideInDown.springify().damping(20).stiffness(220).mass(0.6)}
                            exiting={SlideOutDown.duration(180)}
                        >
                            {saveError && <Text style={styles.saveErrorText}>{saveError}</Text>}
                            <PressableScale
                                style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
                                onPress={handleSave}
                                disabled={!canSave}
                            >
                                {saving
                                    ? <ActivityIndicator color={colors.text.onAccent} />
                                    : <Text style={styles.saveButtonText}>Save</Text>}
                            </PressableScale>
                        </Animated.View>
                    )}
                </Animated.View>
            )}

            {savedVisible && (
                <Animated.View
                    style={[styles.savedToast, { bottom: insets.bottom + 20 }]}
                    entering={FadeIn.duration(200)}
                    exiting={FadeOut.duration(500)}
                    pointerEvents="none"
                >
                    <Ionicons name="checkmark-circle" size={15} color={colors.text.secondary} />
                    <Text style={styles.savedToastText}>Changes saved</Text>
                </Animated.View>
            )}

            <BlockEditorModal
                visible={editor !== null}
                onClose={() => setEditor(null)}
                existingBlocks={draft?.blocks ?? []}
                editIndex={editor?.mode === 'edit' ? editor.index : undefined}
                initialValues={
                    editor?.mode === 'edit'
                        ? draft?.blocks[editor.index]
                        : editor?.mode === 'add'
                            ? { startTime: editor.startTime, endTime: editor.endTime }
                            : undefined
                }
                onSave={handleEditorSubmit}
                onAdd={handleEditorSubmit}
                onDelete={handleBlockDelete}
                saveLabel="Done"
                wakeTime={draft?.wakeTime ?? null}
                sleepTime={draft?.sleepTime ?? null}
            />
        </SafeAreaView>
    );
}

// Wraps a block row with the timeline motion: neighbors reflow via `layout` when a
// block is added or deleted, a deletion fades out, and an accent overlay flashes
// when `signal` becomes a new positive value, confirming an add or edit landed.
function BlockRow({ signal, entering, children }: { signal: number; entering?: EntryOrExitLayoutType; children: ReactNode }) {
    const opacity = useSharedValue(0);
    const prev = useRef(0);

    useEffect(() => {
        if (signal > 0 && signal !== prev.current) {
            opacity.value = withSequence(withTiming(1, { duration: 140 }), withTiming(0, { duration: 620 }));
        }
        prev.current = signal;
    }, [signal, opacity]);

    const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

    return (
        <Animated.View layout={ROW_LAYOUT} entering={entering} exiting={FadeOut.duration(200)}>
            {children}
            <Animated.View pointerEvents="none" style={[styles.flashOverlay, overlayStyle]} />
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.surface.page },

    backRow: { paddingHorizontal: spacing.md, paddingTop: spacing.xl, paddingBottom: 2 },
    backButton: {
        flexDirection: 'row', alignItems: 'center', gap: 2,
        alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: spacing.xs,
    },
    backLabel: { fontSize: 15, color: colors.text.secondary },

    header: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.lg },
    headerTitle: { ...typography.title, color: colors.text.primary, letterSpacing: 0.07 },

    scrollEdge: {
        position: 'absolute', top: 0, left: 0, right: 0, height: 1, zIndex: 5,
        backgroundColor: colors.border.hairline,
        shadowColor: '#2a2621',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.05,
        shadowRadius: 6,
    },

    contentFill: { flex: 1 },
    scroll: { flex: 1 },
    content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },

    wakeSleepSection: { gap: 10, paddingBottom: spacing.xs },

    legend: { flexDirection: 'row', gap: spacing.lg, paddingHorizontal: spacing.xs, paddingTop: spacing.xs },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendSwatch: { width: 12, height: 12, borderRadius: 3, borderWidth: 1, borderColor: colors.border.strong },
    legendSwatchContainer: { backgroundColor: colors.surface.raised, borderStyle: 'dashed' },
    legendSwatchAnchor: { backgroundColor: colors.surface.sunken, borderColor: colors.border.warm, borderStyle: 'solid' },
    legendText: { fontSize: 12, color: colors.text.secondary, letterSpacing: -0.1 },

    blockList: {
        gap: spacing.md,
        padding: spacing.sm,
        borderRadius: radius.xxl,
        backgroundColor: colors.surface.panel,
    },
    boundsError: { fontSize: 13, color: colors.danger.default, lineHeight: 19, letterSpacing: -0.1 },

    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, gap: spacing.lg },
    errorText: { fontSize: 14, color: colors.text.secondary, textAlign: 'center' },
    retryButton: {
        height: 44, paddingHorizontal: spacing.xxl, backgroundColor: colors.accent.default,
        borderRadius: radius.md, justifyContent: 'center', alignItems: 'center',
    },
    retryButtonText: { fontSize: 15, fontWeight: '500', color: colors.text.onAccent, letterSpacing: -0.2 },

    footer: {
        position: 'absolute',
        left: 0, right: 0, bottom: 0,
        paddingHorizontal: spacing.lg, paddingTop: spacing.md,
        gap: spacing.sm,
        backgroundColor: colors.surface.page,
        // A soft top-lift, rather than a hard divider, separates the footer from the scrolling content.
        ...shadow.footer,
    },
    saveErrorText: { fontSize: 13, color: colors.danger.default, textAlign: 'center' },
    saveButton: { height: 52, backgroundColor: colors.accent.default, borderRadius: radius.lg, justifyContent: 'center', alignItems: 'center' },
    saveButtonDisabled: { backgroundColor: 'rgba(212,165,116,0.35)' },
    saveButtonText: { fontSize: 16, fontWeight: '500', color: colors.text.onAccent, letterSpacing: -0.31 },

    flashOverlay: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: radius.lg,
        backgroundColor: 'rgba(212,165,116,0.35)',
    },

    savedToast: {
        position: 'absolute',
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    savedToastText: { fontSize: 13, color: colors.text.secondary, letterSpacing: -0.1 },
});
