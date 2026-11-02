import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
    Extrapolation,
    FadeIn,
    FadeOut,
    interpolate,
    useAnimatedRef,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
} from "react-native-reanimated";
import { api } from "../../lib/api";
import { colors, radius, spacing, shadow } from "../../lib/theme";
import type { BlockInput, DayTemplate } from "../../lib/api.types";
import {
    blocksOutOfBounds,
    isTemplateDirty,
    isTemplateValid,
    isWakeBeforeSleep,
    POINTS_PER_HOUR,
    type OverlapChange,
} from "../../lib/templateDraft";
import { formatTime, toHHmm, toMins } from "../../lib/time";
import { draftToShape, hasSchedulableBlock, resolveDefaultTemplate, templateRecencyLabel } from "../../lib/planTemplate";
import { useTemplateStore } from "../../stores/template.store";
import { usePlanGeneration } from "../../lib/usePlanGeneration";
import { BlockEditorModal } from "../../components/BlockEditorModal";
import { TemplateTimeline } from "../../components/TemplateTimeline";
import { TemplatePickerSheet } from "../../components/TemplatePickerSheet";
import { TemplateValidationBanner } from "../../components/TemplateValidationBanner";
import { UndoSnackbar, useUndoableEdit } from "../../components/UndoSnackbar";
import { PlanGeneratingOverlay } from "../../components/PlanGeneratingOverlay";
import { PressableScale } from "../../components/PressableScale";

// Open the block editor on an existing block by index, or on a new block seeded
// into a tapped free slot.
type Editor = { mode: 'edit'; index: number } | { mode: 'create'; startTime: string; endTime: string };

export default function TemplatePickScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const { templateId, name, baseline, draft, blockKeys, hydrate, setWakeSleep, updateBlock, addBlock, removeBlock, resolveOverlap } = useTemplateStore();
    const { undoLabel, offerUndo, undo } = useUndoableEdit();
    const { generating, generateError, generateErrorCode, generate, cancel, dismissError } = usePlanGeneration();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editor, setEditor] = useState<Editor | null>(null);
    const [entering, setEntering] = useState(false);
    const [footerHeight, setFooterHeight] = useState(0);
    // Full list backing the picker and the base chip's recency line. Fetched even on
    // re-entry (when the draft is already hydrated) so the chip can show the base's dates.
    const [templates, setTemplates] = useState<DayTemplate[]>([]);
    const [pickerOpen, setPickerOpen] = useState(false);
    // Soft client-side mirror of the server's elapsed-block guard; ticks so a block
    // crossing "now" while the user lingers flips the button without a reload.
    const [now, setNow] = useState(() => toHHmm(new Date()));

    // The store survives navigation, so only a cold entry resolves and hydrates the default;
    // re-entry with a draft already present keeps the adjusted draft and just refetches the list.
    const load = useCallback(async () => {
        const hasDraft = !!useTemplateStore.getState().draft;
        if (hasDraft) {
            setEntering(true);
            setLoading(false);
        } else {
            setLoading(true);
        }
        setError(null);
        const result = await api.listDayTemplates();
        if (!result.ok) {
            if (!hasDraft) {
                setError(result.error);
                setLoading(false);
            }
            return;
        }
        setTemplates(result.data);
        if (hasDraft) return;

        const def = resolveDefaultTemplate(result.data);
        if (!def) {
            setError('You have no day templates yet. Create one to plan your day.');
            setLoading(false);
            return;
        }
        hydrate(def);
        setEntering(true);
        setLoading(false);
    }, [hydrate]);

    // Switching the base silently starts fresh from it — hydrate resets both draft and
    // baseline, so the "unsaved changes" notice clears and current adjustments are dropped.
    const handleSelectTemplate = useCallback((template: DayTemplate) => {
        setPickerOpen(false);
        if (template.id === useTemplateStore.getState().templateId) return;
        hydrate(template);
        setEntering(true);
    }, [hydrate]);

    const selectedTemplate = useMemo(
        () => templates.find((t) => t.id === templateId) ?? null,
        [templates, templateId],
    );

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        if (!entering) return;
        const t = setTimeout(() => setEntering(false), 1200);
        return () => clearTimeout(t);
    }, [entering]);

    useEffect(() => {
        const id = setInterval(() => setNow(toHHmm(new Date())), 60_000);
        return () => clearInterval(id);
    }, []);

    function handleWakeSleep(wake: string, sleep: string) {
        setWakeSleep(wake, sleep);
    }

    function handleCreateRange(startTime: string, endTime: string) {
        setEditor({ mode: 'create', startTime, endTime });
    }

    function handleEditorSubmit(block: BlockInput) {
        if (!editor) return;
        if (editor.mode === 'edit') updateBlock(editor.index, block);
        else addBlock(block);
        setEditor(null);
    }

    function handleResolveOverlap(block: BlockInput, changes: OverlapChange[]) {
        if (!editor) return;
        resolveOverlap({ index: editor.mode === 'edit' ? editor.index : null, block }, changes);
        setEditor(null);
    }

    function handleBlockDelete() {
        if (editor?.mode === 'edit') removeBlock(editor.index);
        setEditor(null);
    }

    const dirty = useMemo(() => isTemplateDirty(baseline, draft), [baseline, draft]);
    const valid = useMemo(() => isTemplateValid(draft), [draft]);
    const schedulable = useMemo(() => hasSchedulableBlock(draft, now), [draft, now]);
    const canPlan = valid && schedulable && !generating;

    const wakeBeforeSleep = isWakeBeforeSleep(draft);
    const outOfBounds = useMemo(
        () => (wakeBeforeSleep ? blocksOutOfBounds(draft) : []),
        [draft, wakeBeforeSleep],
    );
    const outOfBoundsIndexes = useMemo(() => new Set(outOfBounds.map((o) => o.index)), [outOfBounds]);

    // A block ending after sleep overflows the grid via absolute positioning, which RN omits from
    // the scroll's content height — reserve it as bottom padding so the tail stays reachable.
    const bottomOverflow = useMemo(() => {
        if (!draft) return 0;
        const sleep = toMins(draft.sleepTime);
        const maxEnd = draft.blocks.reduce((m, b) => Math.max(m, toMins(b.endTime)), sleep);
        return ((maxEnd - sleep) / 60) * POINTS_PER_HOUR;
    }, [draft]);

    const scrollRef = useAnimatedRef<Animated.ScrollView>();
    const scrollY = useSharedValue(0);
    const scrollHandler = useAnimatedScrollHandler((e) => { scrollY.value = e.contentOffset.y; });
    const scrollEdgeStyle = useAnimatedStyle(() => ({
        opacity: interpolate(scrollY.value, [0, 12], [0, 1], Extrapolation.CLAMP),
    }));

    const planDay = useCallback(() => {
        const id = useTemplateStore.getState().templateId;
        const current = useTemplateStore.getState().draft;
        if (!id || !current) return;
        const shape = draftToShape(current, useTemplateStore.getState().blockKeys);
        generate({ templateId: id, shape }, () => router.push('/planning/plan'));
    }, [generate, router]);

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <View style={styles.header}>
                <View style={styles.stepEyebrow}>
                    <View style={[styles.stepPip, styles.stepPipDone]} />
                    <View style={[styles.stepPip, styles.stepPipActive]} />
                    <View style={styles.stepPip} />
                    <Text style={styles.stepLabel}>Step 2 of 3</Text>
                </View>
                <View style={styles.headerRow}>
                    <Text style={styles.headerTitle}>Pick & adjust your day template</Text>
                    <TouchableOpacity
                        onPress={() => router.dismissTo('/(main)')}
                        activeOpacity={0.6}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityRole="button"
                        accessibilityLabel="Close planning"
                    >
                        <Ionicons name="close" size={22} color={colors.text.primary} />
                    </TouchableOpacity>
                </View>
                <Text style={styles.headerSubtitle}>Set the hours you've got today, then plan around them.</Text>
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
                    <TouchableOpacity
                        style={styles.baseChip}
                        onPress={() => setPickerOpen(true)}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`Base template: ${selectedTemplate?.name ?? name}. Change`}
                        accessibilityHint="Opens a picker to build the day from a different template"
                    >
                        <View style={styles.baseChipText}>
                            <Text style={styles.baseChipName} numberOfLines={1}>{selectedTemplate?.name ?? name}</Text>
                            <View style={styles.baseChipMeta}>
                                <Ionicons name="time-outline" size={12} color={colors.text.muted} />
                                <Text style={styles.baseChipMetaText}>
                                    {formatTime((selectedTemplate ?? draft).wakeTime)}–{formatTime((selectedTemplate ?? draft).sleepTime)}
                                </Text>
                                {selectedTemplate && (
                                    <>
                                        <Text style={styles.baseChipDot}>·</Text>
                                        <Text style={styles.baseChipMetaText}>{templateRecencyLabel(selectedTemplate)}</Text>
                                    </>
                                )}
                            </View>
                        </View>
                        <View style={styles.baseChipChange}>
                            <Text style={styles.baseChipChangeText}>Change</Text>
                            <Ionicons name="chevron-down" size={14} color={colors.accent.strong} />
                        </View>
                    </TouchableOpacity>

                    <View style={styles.scrollArea}>
                    <Animated.View pointerEvents="none" style={[styles.scrollEdge, scrollEdgeStyle]} />
                    <Animated.ScrollView
                        ref={scrollRef}
                        style={styles.scroll}
                        contentContainerStyle={[styles.content, { paddingBottom: (footerHeight || 160) + spacing.md + bottomOverflow }]}
                        showsVerticalScrollIndicator={false}
                        onScroll={scrollHandler}
                        scrollEventThrottle={16}
                    >
                        {dirty && (
                            <Animated.View style={styles.todayNotice} entering={FadeIn.duration(200)}>
                                <Ionicons name="information-circle-outline" size={15} color={colors.accent.default} />
                                <Text style={styles.todayNoticeText}>Changes here are not saved to the original template.</Text>
                            </Animated.View>
                        )}

                        <TemplateValidationBanner draft={draft} showContainerWarning={false} />

                        <TemplateTimeline
                            style={styles.timeline}
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
                            onLiveEdit={(snapshot, label) => offerUndo(snapshot, label)}
                        />
                    </Animated.ScrollView>
                    </View>

                    <View
                        style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 24) }]}
                        onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
                    >
                        {!schedulable && (
                            <Text style={styles.footerHint}>No upcoming Time Block left today. Add at least one after now to continue.</Text>
                        )}
                        <PressableScale
                            style={[styles.planButton, !canPlan && styles.planButtonDisabled]}
                            onPress={planDay}
                            disabled={!canPlan}
                        >
                            <Text style={styles.planButtonText}>Plan my day</Text>
                        </PressableScale>
                        <TouchableOpacity
                            style={styles.backButton}
                            onPress={() => router.back()}
                            activeOpacity={0.6}
                        >
                            <Text style={styles.backButtonText}>Back</Text>
                        </TouchableOpacity>
                    </View>
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

            <TemplatePickerSheet
                visible={pickerOpen}
                onClose={() => setPickerOpen(false)}
                templates={templates}
                selectedId={templateId}
                onSelect={handleSelectTemplate}
            />

            <PlanGeneratingOverlay
                generating={generating}
                error={generateError}
                errorCode={generateErrorCode}
                onRetry={planDay}
                onDismiss={dismissError}
                onCancel={cancel}
                onAdjust={dismissError}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.surface.page },

    header: {
        paddingHorizontal: 20, paddingTop: 24, paddingBottom: 16,
        borderBottomWidth: 1, borderBottomColor: 'rgba(42,38,33,0.06)',
    },
    stepEyebrow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
    stepPip: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(42,38,33,0.14)' },
    stepPipDone: { backgroundColor: 'rgba(42,38,33,0.3)' },
    stepPipActive: { width: 14, backgroundColor: colors.accent.default },
    stepLabel: {
        fontSize: 11, fontWeight: '600', color: 'rgba(122,115,106,0.5)',
        letterSpacing: 0.5, textTransform: 'uppercase', marginLeft: 2, fontVariant: ['tabular-nums'],
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headerTitle: { fontSize: 16, fontWeight: '600', color: colors.text.primary, letterSpacing: -0.3 },
    headerSubtitle: { fontSize: 13, color: colors.text.secondary, lineHeight: 18, marginTop: 6, maxWidth: 320 },

    scrollEdge: {
        position: 'absolute', top: 0, left: 0, right: 0, height: 1, zIndex: 5,
        backgroundColor: colors.border.hairline,
        shadowColor: '#2a2621', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 6,
    },

    contentFill: { flex: 1 },
    scrollArea: { flex: 1 },
    scroll: { flex: 1 },

    baseChip: {
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        marginHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.md,
        paddingVertical: 10, paddingHorizontal: 14,
        backgroundColor: colors.surface.raised,
        borderWidth: 1, borderColor: colors.border.hairline, borderRadius: radius.md,
    },
    baseChipText: { flex: 1, gap: 3 },
    baseChipName: { fontSize: 14, fontWeight: '600', color: colors.text.primary, letterSpacing: -0.2 },
    baseChipMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    baseChipMetaText: { fontSize: 12, color: colors.text.secondary, letterSpacing: -0.1, fontVariant: ['tabular-nums'] },
    baseChipDot: { fontSize: 12, color: colors.text.muted },
    baseChipChange: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    baseChipChangeText: { fontSize: 13, fontWeight: '600', color: colors.accent.strong, letterSpacing: -0.1 },
    content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
    timeline: { paddingTop: spacing.lg, paddingBottom: spacing.lg },

    todayNotice: {
        flexDirection: 'row', alignItems: 'center', gap: 7,
        backgroundColor: 'rgba(212,165,116,0.12)', borderRadius: radius.md,
        paddingVertical: 9, paddingHorizontal: 12, marginTop: spacing.md,
    },
    todayNoticeText: { fontSize: 12, fontWeight: '500', color: colors.text.secondary, letterSpacing: -0.1 },

    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, gap: spacing.lg },
    errorText: { fontSize: 14, color: colors.text.secondary, textAlign: 'center' },
    retryButton: {
        height: 44, paddingHorizontal: spacing.xxl, backgroundColor: colors.accent.default,
        borderRadius: radius.md, justifyContent: 'center', alignItems: 'center',
    },
    retryButtonText: { fontSize: 15, fontWeight: '500', color: colors.text.onAccent, letterSpacing: -0.2 },

    footer: {
        position: 'absolute', left: 0, right: 0, bottom: 0,
        paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm,
        backgroundColor: colors.surface.page,
        ...shadow.footer,
    },
    footerHint: { fontSize: 13, fontWeight: '500', color: colors.text.secondary, textAlign: 'center', letterSpacing: -0.1, lineHeight: 18 },
    planButton: { height: 48, backgroundColor: colors.text.primary, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center' },
    planButtonDisabled: { opacity: 0.35 },
    planButtonText: { fontSize: 15, fontWeight: '500', color: colors.surface.page, letterSpacing: -0.1 },
    backButton: { height: 40, justifyContent: 'center', alignItems: 'center' },
    backButtonText: { fontSize: 14, fontWeight: '500', color: colors.text.secondary, letterSpacing: -0.1 },
});
