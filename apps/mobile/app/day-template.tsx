import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
    useSharedValue,
    useAnimatedRef,
    useAnimatedStyle,
    useAnimatedScrollHandler,
    interpolate,
    Extrapolation,
} from "react-native-reanimated";
import { api } from "../lib/api";
import { colors, radius, spacing, shadow } from "../lib/theme";
import type { BlockInput } from "../lib/api.types";
import { isTemplateDirty, isTemplateValid, isWakeBeforeSleep, blocksOutOfBounds, POINTS_PER_HOUR, type OverlapChange } from "../lib/templateDraft";
import { formatDuration, durationMins, toMins } from "../lib/time";
import { useTemplateStore } from "../stores/template.store";
import { BlockEditorModal } from "../components/BlockEditorModal";
import { TemplateTimeline } from "../components/TemplateTimeline";
import { TemplateValidationBanner } from "../components/TemplateValidationBanner";
import { UndoSnackbar, useUndoableEdit } from "../components/UndoSnackbar";
import { PressableScale } from "../components/PressableScale";

// What the block editor is open on: an existing block by index, or a new block seeded into a
// tapped free slot.
type Editor = { mode: 'edit'; index: number } | { mode: 'create'; startTime: string; endTime: string };

export default function DayTemplateScreen() {
    const router = useRouter();
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();

    const { baseline, draft, blockKeys, hydrate, setWakeSleep, updateBlock, addBlock, removeBlock, resolveOverlap, commit, reset, clear } = useTemplateStore();
    const { undoLabel, offerUndo, undo } = useUndoableEdit();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editor, setEditor] = useState<Editor | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [savedVisible, setSavedVisible] = useState(false);
    const [entering, setEntering] = useState(false);
    // Measured so the scroll can reserve exactly the dirty-state footer's height,
    // keeping the last row (sleep) reachable above it rather than hidden behind.
    const [footerHeight, setFooterHeight] = useState(0);

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

    // A modal swipe-down dismiss resolves natively and can slip past the
    // beforeRemove guard below, so disable the gesture while there are unsaved
    // edits — the back button (which the guard intercepts) becomes the only exit.
    useEffect(() => {
        navigation.setOptions({ gestureEnabled: !dirty });
    }, [navigation, dirty]);

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

    function handleCreateRange(startTime: string, endTime: string) {
        setEditor({ mode: 'create', startTime, endTime });
    }

    function handleEditorSubmit(block: BlockInput) {
        if (!editor) return;
        if (editor.mode === 'edit') updateBlock(editor.index, block);
        else addBlock(block);
        setSaveError(null);
        setEditor(null);
    }

    // Confirmed an overlap resolution: apply the neighbour trims/removals and seat the block together.
    function handleResolveOverlap(block: BlockInput, changes: OverlapChange[]) {
        if (!editor) return;
        resolveOverlap({ index: editor.mode === 'edit' ? editor.index : null, block }, changes);
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

    function handleCancel() {
        Alert.alert(
            'Discard changes?',
            'You have unsaved edits to your day template.',
            [
                { text: 'Keep editing', style: 'cancel' },
                { text: 'Discard', style: 'destructive', onPress: reset },
            ],
        );
    }

    const totals = useMemo(() => {
        const sum = (type: BlockInput['type']) =>
            (draft?.blocks ?? [])
                .filter((b) => b.type === type)
                .reduce((mins, b) => mins + durationMins(b.startTime, b.endTime), 0);
        return { container: sum('CONTAINER'), anchor: sum('ANCHOR') };
    }, [draft]);

    // Skip the bounds check while wake and sleep are inverted; the window is meaningless then.
    const wakeBeforeSleep = isWakeBeforeSleep(draft);
    const outOfBounds = useMemo(
        () => (wakeBeforeSleep ? blocksOutOfBounds(draft) : []),
        [draft, wakeBeforeSleep],
    );
    const outOfBoundsIndexes = useMemo(() => new Set(outOfBounds.map((o) => o.index)), [outOfBounds]);

    // A block ending after sleep overflows below the grid via absolute positioning, which RN
    // leaves out of the scroll's content height — so reserve that overflow as extra bottom padding,
    // otherwise the tail (and its "after sleep" note) hides under the absolute Save/Cancel footer.
    const bottomOverflow = useMemo(() => {
        if (!draft) return 0;
        const sleep = toMins(draft.sleepTime);
        const maxEnd = draft.blocks.reduce((m, b) => Math.max(m, toMins(b.endTime)), sleep);
        return ((maxEnd - sleep) / 60) * POINTS_PER_HOUR;
    }, [draft]);

    const canSave = dirty && valid && !saving;

    const scrollRef = useAnimatedRef<Animated.ScrollView>();
    const scrollY = useSharedValue(0);
    const scrollHandler = useAnimatedScrollHandler((e) => { scrollY.value = e.contentOffset.y; });
    const scrollEdgeStyle = useAnimatedStyle(() => ({
        opacity: interpolate(scrollY.value, [0, 12], [0, 1], Extrapolation.CLAMP),
    }));

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <View style={styles.header}>
                <View style={styles.headerEyebrow}>
                    <Text style={styles.headerEyebrowLabel}>Day Template</Text>
                </View>
                <View style={styles.headerRow}>
                    <Text style={styles.headerTitle}>Reshape your day</Text>
                    <TouchableOpacity onPress={() => router.back()} activeOpacity={0.6} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <Ionicons name="close" size={22} color={colors.text.primary} />
                    </TouchableOpacity>
                </View>
                <Text style={styles.headerSubtitle}>Tap a block to edit, or tap empty space to add one.</Text>
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
                        ref={scrollRef}
                        style={styles.scroll}
                        contentContainerStyle={[styles.content, dirty && { paddingBottom: (footerHeight || 160) + spacing.md + bottomOverflow }]}
                        showsVerticalScrollIndicator={false}
                        onScroll={scrollHandler}
                        scrollEventThrottle={16}
                    >
                        <Animated.View
                            style={styles.legend}
                            entering={entering ? FadeInDown.duration(300) : undefined}
                        >
                            <View style={styles.legendItem}>
                                <View style={[styles.legendSwatch, styles.legendSwatchContainer]} />
                                <Text style={styles.legendText}>Container</Text>
                                <Text style={styles.legendTotal}>{formatDuration(totals.container)}</Text>
                            </View>
                            <View style={styles.legendItem}>
                                <View style={[styles.legendSwatch, styles.legendSwatchAnchor]} />
                                <Text style={styles.legendText}>Anchor</Text>
                                <Text style={styles.legendTotal}>{formatDuration(totals.anchor)}</Text>
                            </View>
                        </Animated.View>

                        <TemplateValidationBanner draft={draft} />

                        <TemplateTimeline
                            blocks={draft.blocks}
                            wakeTime={draft.wakeTime}
                            sleepTime={draft.sleepTime}
                            blockKeys={blockKeys}
                            entering={entering}
                            outOfBoundsIndexes={outOfBoundsIndexes}
                            scrollRef={scrollRef}
                            onWakeChange={(w) => handleWakeSleep(w, draft.sleepTime)}
                            onSleepChange={(s) => handleWakeSleep(draft.wakeTime, s)}
                            onEditBlock={(index) => setEditor({ mode: 'edit', index })}
                            onCreateRange={handleCreateRange}
                            onLiveEdit={(snapshot, label) => { setSaveError(null); offerUndo(snapshot, label); }}
                        />
                    </Animated.ScrollView>

                    {dirty && (
                        <Animated.View
                            style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}
                            onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
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
                                    ? <ActivityIndicator color={colors.surface.page} />
                                    : <Text style={styles.saveButtonText}>Save</Text>}
                            </PressableScale>
                            <TouchableOpacity
                                style={styles.cancelButton}
                                onPress={handleCancel}
                                disabled={saving}
                                activeOpacity={0.8}
                            >
                                <Text style={styles.cancelButtonText}>Cancel</Text>
                            </TouchableOpacity>
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

            {undoLabel && <UndoSnackbar label={undoLabel} onUndo={undo} bottom={(footerHeight || 140) + spacing.sm} />}

            <BlockEditorModal
                visible={editor !== null}
                onClose={() => setEditor(null)}
                existingBlocks={draft?.blocks ?? []}
                editIndex={editor?.mode === 'edit' ? editor.index : undefined}
                initialValues={
                    editor?.mode === 'edit'
                        ? draft?.blocks[editor.index]
                        : editor?.mode === 'create'
                            ? { startTime: editor.startTime, endTime: editor.endTime }
                            : undefined
                }
                onSave={handleEditorSubmit}
                onAdd={handleEditorSubmit}
                onDelete={handleBlockDelete}
                onResolveOverlap={handleResolveOverlap}
                saveLabel="Done"
                wakeTime={draft?.wakeTime ?? null}
                sleepTime={draft?.sleepTime ?? null}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.surface.page },

    // Mirrors the planning review screen's header (eyebrow, small title + close,
    // subtitle, hairline divider) so the two screens read as one flow.
    header: {
        paddingHorizontal: 20, paddingTop: 24, paddingBottom: 16,
        borderBottomWidth: 1, borderBottomColor: 'rgba(42,38,33,0.06)',
    },
    headerEyebrow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
    headerEyebrowLabel: {
        fontSize: 11, fontWeight: '600', color: 'rgba(122,115,106,0.5)',
        letterSpacing: 0.5, textTransform: 'uppercase',
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headerTitle: { fontSize: 16, fontWeight: '600', color: colors.text.primary, letterSpacing: -0.3 },
    headerSubtitle: { fontSize: 13, color: colors.text.secondary, lineHeight: 18, marginTop: 6, maxWidth: 320 },

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

    legend: { flexDirection: 'row', gap: spacing.lg, paddingHorizontal: spacing.xs, marginTop: spacing.md },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendSwatch: { width: 12, height: 12, borderRadius: 3, backgroundColor: colors.surface.block },
    legendSwatchContainer: { borderWidth: 1, borderColor: 'rgba(42,38,33,0.16)', borderStyle: 'dashed' },
    legendSwatchAnchor: { borderWidth: 1, borderColor: colors.border.hairline },
    legendText: { fontSize: 12, color: colors.text.secondary, letterSpacing: -0.1 },
    legendTotal: { fontSize: 12, color: colors.text.muted, letterSpacing: -0.1, fontVariant: ['tabular-nums'] },

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
    saveButton: { height: 48, backgroundColor: colors.text.primary, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center' },
    saveButtonDisabled: { opacity: 0.35 },
    saveButtonText: { fontSize: 15, fontWeight: '500', color: colors.surface.page, letterSpacing: -0.1 },
    cancelButton: { height: 48, borderRadius: radius.lg, justifyContent: 'center', alignItems: 'center' },
    cancelButtonText: { fontSize: 15, fontWeight: '500', color: colors.text.secondary, letterSpacing: -0.23 },

    savedToast: {
        position: 'absolute',
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    savedToastText: { fontSize: 13, color: colors.text.secondary, letterSpacing: -0.1 },
});
