import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import { api } from "../../lib/api";
import { colors, radius, spacing, shadow, typography } from "../../lib/theme";
import type { BlockInput } from "../../lib/api.types";
import { isTemplateValid, isWakeBeforeSleep, blocksOutOfBounds, POINTS_PER_HOUR, type OverlapChange } from "../../lib/templateDraft";
import { toMins } from "../../lib/time";
import { buildStarterTemplate } from "../../lib/starterTemplate";
import { useTemplateStore } from "../../stores/template.store";
import { StepEyebrow } from "../../components/StepEyebrow";
import { TemplateTimeline } from "../../components/TemplateTimeline";
import { TemplateValidationBanner } from "../../components/TemplateValidationBanner";
import { BlockEditorModal } from "../../components/BlockEditorModal";
import { UndoSnackbar, useUndoableEdit } from "../../components/UndoSnackbar";
import { PressableScale } from "../../components/PressableScale";

// What the block editor is open on: an existing block by index, or a new block seeded into a
// tapped free slot.
type Editor = { mode: 'edit'; index: number } | { mode: 'create'; startTime: string; endTime: string };

export default function BuildScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const { draft, blockKeys, hydrate, seed, setWakeSleep, updateBlock, addBlock, removeBlock, resolveOverlap } = useTemplateStore();
    const { undoLabel, offerUndo, undo } = useUndoableEdit();
    const scrollRef = useAnimatedRef<Animated.ScrollView>();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [editor, setEditor] = useState<Editor | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [footerHeight, setFooterHeight] = useState(0);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        const result = await api.getDayTemplate();
        if (result.ok) {
            hydrate(result.data);
        } else if (result.status === 404) {
            seed(buildStarterTemplate());
        } else {
            setError(result.error);
        }
        setLoading(false);
    }, [hydrate, seed]);

    useEffect(() => {
        // Keep any in-session draft (e.g. after stepping forward and back); otherwise load or seed.
        if (useTemplateStore.getState().draft) {
            setLoading(false);
            return;
        }
        load();
    }, [load]);

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
        if (editor?.mode === 'edit') removeBlock(editor.index);
        setSaveError(null);
        setEditor(null);
    }

    function handleBack() {
        router.back();
    }

    async function handleContinue() {
        if (!draft) return;
        setSaving(true);
        setSaveError(null);
        const result = await api.updateDayTemplate(draft);
        setSaving(false);
        if (result.ok) {
            router.push('/(onboarding)/first-task');
        } else {
            setSaveError(result.error);
        }
    }

    const valid = useMemo(() => isTemplateValid(draft), [draft]);
    const wakeBeforeSleep = isWakeBeforeSleep(draft);
    const outOfBoundsIndexes = useMemo(
        () => new Set((wakeBeforeSleep ? blocksOutOfBounds(draft) : []).map((o) => o.index)),
        [draft, wakeBeforeSleep],
    );

    const canContinue = valid && !saving;

    // A block ending after sleep overflows below the grid via absolute positioning, which RN leaves
    // out of the scroll's content height — reserve it so the tail (and its "after sleep" note) stays
    // scrollable into view rather than clipped at the bottom.
    const bottomOverflow = useMemo(() => {
        if (!draft) return 0;
        const sleep = toMins(draft.sleepTime);
        const maxEnd = draft.blocks.reduce((m, b) => Math.max(m, toMins(b.endTime)), sleep);
        return ((maxEnd - sleep) / 60) * POINTS_PER_HOUR;
    }, [draft]);

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <View style={styles.header}>
                <StepEyebrow step={1} total={3} />
                <Text style={styles.headerTitle}>Let's build your day</Text>
                <Text style={styles.headerSubtitle}>
                    Set your wake and sleep times, then shape the blocks in between. Tap a block to edit, or tap empty space to add one.
                </Text>
            </View>

            {loading && (
                <View style={styles.centered}>
                    <ActivityIndicator color={colors.accent.default} />
                </View>
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
                <>
                    <Animated.ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={[styles.content, bottomOverflow > 0 && { paddingBottom: spacing.xxl + bottomOverflow }]} showsVerticalScrollIndicator={false}>
                        <View style={styles.legend}>
                            <View style={styles.legendItem}>
                                <View style={[styles.legendSwatch, styles.legendSwatchContainer]} />
                                <Text style={styles.legendText}>
                                    <Text style={styles.legendLabel}>Container</Text>  ·  Starlight fills these with your tasks
                                </Text>
                            </View>
                            <View style={styles.legendItem}>
                                <View style={[styles.legendSwatch, styles.legendSwatchAnchor]} />
                                <Text style={styles.legendText}>
                                    <Text style={styles.legendLabel}>Anchor</Text>  ·  A fixed event, like lunch or the gym
                                </Text>
                            </View>
                        </View>

                            <TemplateValidationBanner draft={draft} />

                            <TemplateTimeline
                                blocks={draft.blocks}
                                wakeTime={draft.wakeTime}
                                sleepTime={draft.sleepTime}
                                blockKeys={blockKeys}
                                entering={false}
                                outOfBoundsIndexes={outOfBoundsIndexes}
                                scrollRef={scrollRef}
                                onWakeChange={(w) => { setSaveError(null); setWakeSleep(w, draft.sleepTime); }}
                                onSleepChange={(s) => { setSaveError(null); setWakeSleep(draft.wakeTime, s); }}
                                onEditBlock={(index) => setEditor({ mode: 'edit', index })}
                                onCreateRange={handleCreateRange}
                                onLiveEdit={(snapshot, label) => { setSaveError(null); offerUndo(snapshot, label); }}
                            />
                    </Animated.ScrollView>

                    <View
                        style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}
                        onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
                    >
                        {saveError && <Text style={styles.saveErrorText}>{saveError}</Text>}
                        <PressableScale
                            style={[styles.continueButton, !canContinue && styles.continueButtonDisabled]}
                            onPress={handleContinue}
                            disabled={!canContinue}
                        >
                            {saving
                                ? <ActivityIndicator color={colors.surface.page} />
                                : <Text style={styles.continueButtonText}>Continue</Text>}
                        </PressableScale>
                        <TouchableOpacity
                            style={styles.backButton}
                            onPress={handleBack}
                            disabled={saving}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.backLabel}>Back</Text>
                        </TouchableOpacity>
                    </View>
                </>
            )}

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

            {undoLabel && <UndoSnackbar label={undoLabel} onUndo={undo} bottom={(footerHeight || 140) + spacing.sm} />}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.surface.page },

    header: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.md },
    backButton: { height: 44, justifyContent: 'center', alignItems: 'center' },
    backLabel: { fontSize: 15, fontWeight: '500', color: colors.text.secondary, letterSpacing: -0.1 },
    headerTitle: { ...typography.title, color: colors.text.primary, letterSpacing: 0.07, marginTop: 4 },
    headerSubtitle: { fontSize: 15, color: colors.text.secondary, lineHeight: 22, letterSpacing: -0.2, marginTop: spacing.sm },

    scroll: { flex: 1 },
    content: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xxl, gap: spacing.lg },

    legend: {
        gap: 5,
        backgroundColor: colors.surface.sunken,
        borderRadius: radius.md,
        paddingVertical: 10,
        paddingHorizontal: 12,
    },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    legendSwatch: { width: 11, height: 11, borderRadius: 3, backgroundColor: colors.surface.block },
    legendSwatchContainer: { borderWidth: 1, borderColor: 'rgba(42,38,33,0.16)', borderStyle: 'dashed' },
    legendSwatchAnchor: { borderWidth: 1, borderColor: colors.border.hairline },
    legendText: { fontSize: 12.5, color: colors.text.secondary, letterSpacing: -0.1 },
    legendLabel: { fontWeight: '600', color: colors.text.primary },

    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, gap: spacing.lg },
    errorText: { fontSize: 14, color: colors.text.secondary, textAlign: 'center' },
    retryButton: {
        height: 44, paddingHorizontal: spacing.xxl, backgroundColor: colors.accent.default,
        borderRadius: radius.md, justifyContent: 'center', alignItems: 'center',
    },
    retryButtonText: { fontSize: 15, fontWeight: '500', color: colors.text.onAccent, letterSpacing: -0.2 },

    footer: {
        paddingHorizontal: spacing.xl, paddingTop: spacing.lg,
        gap: spacing.xs,
        backgroundColor: colors.surface.page,
        ...shadow.footer,
    },
    saveErrorText: { fontSize: 13, color: colors.danger.default, textAlign: 'center' },
    continueButton: { height: 52, backgroundColor: colors.text.primary, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center' },
    continueButtonDisabled: { opacity: 0.4 },
    continueButtonText: { fontSize: 15, fontWeight: '600', color: colors.surface.page, letterSpacing: -0.1 },
});
