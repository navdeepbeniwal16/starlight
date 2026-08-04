import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Animated, {
    SlideInDown,
    SlideOutDown,
    FadeIn,
    FadeOut,
    LinearTransition,
    useSharedValue,
    useAnimatedStyle,
    withSequence,
    withTiming,
} from "react-native-reanimated";
import { api } from "../lib/api";
import type { BlockInput } from "../lib/api.types";
import { formatTime } from "../lib/time";
import { isTemplateDirty, isTemplateValid, isWakeBeforeSleep, blocksOutOfBounds, buildTimeline, hasContainer } from "../lib/templateDraft";
import { useTemplateStore } from "../stores/template.store";
import { BlockListItem } from "../components/BlockListItem";
import { BlockEditorModal } from "../components/BlockEditorModal";
import { GapAffordance } from "../components/GapAffordance";
import { WakeSleepBar } from "../components/WakeSleepBar";

// What the block modal is open on: editing a block in place, or adding one into a gap.
type EditorTarget =
    | { mode: 'edit'; index: number }
    | { mode: 'add'; startTime: string; endTime: string };

export default function DayTemplateScreen() {
    const router = useRouter();
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();

    const { baseline, draft, hydrate, setWakeSleep, updateBlock, addBlock, removeBlock, commit, reset, clear } = useTemplateStore();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // The block modal's target: an existing block by index, a gap's range to add into,
    // or null when closed. A single state keeps the two modes mutually exclusive.
    const [editor, setEditor] = useState<EditorTarget | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [savedVisible, setSavedVisible] = useState(false);
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
        } else {
            setError(result.error);
        }
        setLoading(false);
    }, [hydrate]);

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

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.backRow}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.7}>
                    <Ionicons name="chevron-back" size={20} color="#7a736a" />
                    <Text style={styles.backLabel}>Settings</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.header}>
                <Text style={styles.headerTitle}>Day Template</Text>
            </View>

            {loading && (
                <View style={styles.centered}>
                    <ActivityIndicator color="#d4a574" />
                </View>
            )}

            {!loading && error && (
                <View style={styles.centered}>
                    <Text style={styles.errorText}>{error}</Text>
                    <TouchableOpacity style={styles.retryButton} onPress={load} activeOpacity={0.8}>
                        <Text style={styles.retryButtonText}>Try again</Text>
                    </TouchableOpacity>
                </View>
            )}

            {!loading && !error && draft && (
                <>
                    <ScrollView
                        style={styles.scroll}
                        contentContainerStyle={[styles.content, dirty && { paddingBottom: 96 + insets.bottom }]}
                        showsVerticalScrollIndicator={false}
                    >
                        <View style={styles.wakeSleepSection}>
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
                        </View>

                        <View style={styles.blockList}>
                            {noContainer && (
                                <Text style={styles.boundsError}>
                                    Keep at least one Container block so Starlight has time to schedule tasks. Add one before saving.
                                </Text>
                            )}

                            {rows.map((row) =>
                                row.kind === 'block' ? (
                                    <BlockRow
                                        key={`block-${row.startTime}`}
                                        signal={flashFor.key === `block-${row.startTime}` ? flashFor.nonce : 0}
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
                                        layout={LinearTransition.springify()}
                                        entering={FadeIn.duration(160)}
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
                    </ScrollView>

                    {dirty && (
                        <Animated.View
                            style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}
                            entering={SlideInDown.springify().damping(20).stiffness(220).mass(0.6)}
                            exiting={SlideOutDown.duration(180)}
                        >
                            {saveError && <Text style={styles.saveErrorText}>{saveError}</Text>}
                            <TouchableOpacity
                                style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
                                onPress={handleSave}
                                disabled={!canSave}
                                activeOpacity={0.8}
                            >
                                {saving
                                    ? <ActivityIndicator color="#2a2621" />
                                    : <Text style={styles.saveButtonText}>Save</Text>}
                            </TouchableOpacity>
                        </Animated.View>
                    )}
                </>
            )}

            {savedVisible && (
                <Animated.View
                    style={[styles.savedToast, { bottom: insets.bottom + 20 }]}
                    entering={FadeIn.duration(200)}
                    exiting={FadeOut.duration(500)}
                    pointerEvents="none"
                >
                    <Ionicons name="checkmark-circle" size={15} color="#7a736a" />
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
function BlockRow({ signal, children }: { signal: number; children: ReactNode }) {
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
        <Animated.View layout={LinearTransition.springify()} exiting={FadeOut.duration(200)}>
            {children}
            <Animated.View pointerEvents="none" style={[styles.flashOverlay, overlayStyle]} />
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: '#fdfcfa' },

    backRow: { paddingHorizontal: 12, paddingTop: 20, paddingBottom: 2 },
    backButton: {
        flexDirection: 'row', alignItems: 'center', gap: 2,
        alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 4,
    },
    backLabel: { fontSize: 15, color: '#7a736a' },

    header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
    headerTitle: { fontSize: 24, fontWeight: '500', color: '#2a2621', letterSpacing: 0.07 },

    scroll: { flex: 1 },
    content: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },

    wakeSleepSection: { gap: 10, paddingBottom: 4 },
    // Subtle panel that groups the block timeline apart from the wake/sleep controls.
    blockList: {
        gap: 12,
        padding: 12,
        borderRadius: 20,
        backgroundColor: 'rgba(42,38,33,0.025)',
    },
    boundsError: { fontSize: 13, color: '#c0392b', lineHeight: 19, letterSpacing: -0.1 },

    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, gap: 16 },
    errorText: { fontSize: 14, color: '#7a736a', textAlign: 'center' },
    retryButton: {
        height: 44, paddingHorizontal: 24, backgroundColor: '#d4a574',
        borderRadius: 14, justifyContent: 'center', alignItems: 'center',
    },
    retryButtonText: { fontSize: 15, fontWeight: '500', color: '#2a2621', letterSpacing: -0.2 },

    footer: {
        position: 'absolute',
        left: 0, right: 0, bottom: 0,
        paddingHorizontal: 16, paddingTop: 12,
        gap: 8,
        backgroundColor: '#fdfcfa',
        // A soft top-lift, rather than a hard divider, separates the footer from the scrolling content.
        shadowColor: '#2a2621',
        shadowOffset: { width: 0, height: -3 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
        elevation: 12,
    },
    saveErrorText: { fontSize: 13, color: '#c0392b', textAlign: 'center' },
    saveButton: { height: 52, backgroundColor: '#d4a574', borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
    saveButtonDisabled: { backgroundColor: 'rgba(212,165,116,0.35)' },
    saveButtonText: { fontSize: 16, fontWeight: '500', color: '#2a2621', letterSpacing: -0.31 },

    flashOverlay: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 16,
        backgroundColor: 'rgba(212,165,116,0.35)',
    },

    savedToast: {
        position: 'absolute',
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    savedToastText: { fontSize: 13, color: '#7a736a', letterSpacing: -0.1 },
});
