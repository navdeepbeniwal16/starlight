import { Fragment, useMemo, useRef } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
    FadeInDown,
    measure,
    runOnJS,
    runOnUI,
    scrollTo,
    useScrollViewOffset,
    type AnimatedRef,
    type EntryOrExitLayoutType,
} from "react-native-reanimated";
import type { BlockInput } from "../lib/api.types";
import { colors, radius, spacing } from "../lib/theme";
import { formatHourLabel, formatTime, formatTimeRange, formatDuration, durationMins, toMins, fromMins } from "../lib/time";
import { ENERGY_LABELS, MIN_BLOCK_MINUTES } from "../lib/templateBlocks";
import {
    computeGridLayout,
    seedBlockRange,
    resolveEdgeResize,
    resolveMove,
    FREE_LABEL_MIN_MINUTES,
    POINTS_PER_HOUR,
    type GridBlock,
    type GridFree,
    type TemplateDraft,
} from "../lib/templateDraft";
import { useTemplateStore } from "../stores/template.store";
import { BoundaryTimeControl } from "./BoundaryTimeControl";
import { effortDotColor } from "./TaskFields";

// Left ruler width, sized to hold a compact hour label ("12 PM") at the ruler font.
const RULER_WIDTH = 44;

// Cards butt right up against the time column — a small gap clear of the spine, no more.
const CONTENT_LEFT = RULER_WIDTH + spacing.sm;

const POINTS_PER_MINUTE = POINTS_PER_HOUR / 60;

// Gating a move behind a hold is what lets a plain drag fall through to scrolling.
const LONG_PRESS_MS = 220;

const EDGE_HANDLE = 16;
// Below this height the grab strips would cover the whole card, so short blocks resize via modal.
const EDGE_HANDLE_MIN_HEIGHT = 44;

const AUTOSCROLL_EDGE = 72;
const AUTOSCROLL_STEP = 9;
const AUTOSCROLL_TICK_MS = 16;

const pointsToMinutes = (points: number) => points / POINTS_PER_MINUTE;

// Every frame resolves against `snapshot`, the pristine pre-drag draft — so live-trimmed
// neighbours grow back when the drag reverses, and the whole gesture undoes to a single point.
type DragSession =
    | { kind: 'move'; snapshot: TemplateDraft; index: number; originStart: number; translation: number }
    | { kind: 'resize'; snapshot: TemplateDraft; index: number; edge: 'start' | 'end'; originEdge: number; translation: number };

// The single-track calendar grid shared by the standalone editor and the onboarding Build step.
export function TemplateTimeline({
    blocks,
    wakeTime,
    sleepTime,
    blockKeys,
    entering,
    outOfBoundsIndexes,
    scrollRef,
    onWakeChange,
    onSleepChange,
    onEditBlock,
    onCreateRange,
    onLiveEdit,
}: {
    blocks: BlockInput[];
    wakeTime: string;
    sleepTime: string;
    blockKeys: string[];
    entering: boolean;
    outOfBoundsIndexes: Set<number>;
    scrollRef: AnimatedRef<Animated.ScrollView>;
    onWakeChange: (time: string) => void;
    onSleepChange: (time: string) => void;
    onEditBlock: (index: number) => void;
    onCreateRange: (startTime: string, endTime: string) => void;
    onLiveEdit: (snapshot: TemplateDraft, label: string) => void;
}) {
    const setDraft = useTemplateStore((s) => s.setDraft);
    const scrollOffset = useScrollViewOffset(scrollRef);

    const { blocks: laidBlocks, free, ticks, totalHeight } = useMemo(
        () => computeGridLayout({ wakeTime, sleepTime, blocks }),
        [wakeTime, sleepTime, blocks],
    );

    const session = useRef<DragSession | null>(null);
    // Window coordinates, so a drag's absoluteY can be tested against what's actually on screen.
    const viewport = useRef<{ top: number; height: number } | null>(null);
    const autoscroll = useRef<{ dir: -1 | 0 | 1; timer: ReturnType<typeof setInterval> | null; scrolled: number }>(
        { dir: 0, timer: null, scrolled: 0 },
    );

    const applySession = () => {
        const s = session.current;
        if (!s) return;
        if (s.kind === 'move') {
            const target = s.originStart + pointsToMinutes(s.translation + autoscroll.current.scrolled);
            setDraft(resolveMove(s.snapshot, s.index, fromMins(Math.round(target))));
        } else {
            const target = s.originEdge + pointsToMinutes(s.translation);
            setDraft(resolveEdgeResize(s.snapshot, s.index, s.edge, fromMins(Math.round(target))));
        }
    };

    const endSession = (label: string) => {
        stopAutoscroll();
        const s = session.current;
        session.current = null;
        if (!s) return;
        const after = useTemplateStore.getState().draft;
        if (after && JSON.stringify(after) !== JSON.stringify(s.snapshot)) onLiveEdit(s.snapshot, label);
    };

    const cancelSession = () => {
        stopAutoscroll();
        const s = session.current;
        session.current = null;
        if (s) setDraft(s.snapshot);
    };

    const measureViewport = () => {
        runOnUI(() => {
            'worklet';
            const m = measure(scrollRef);
            if (m) runOnJS(setViewport)(m.pageY, m.height);
        })();
    };
    const setViewport = (top: number, height: number) => { viewport.current = { top, height }; };

    const stopAutoscroll = () => {
        if (autoscroll.current.timer) clearInterval(autoscroll.current.timer);
        autoscroll.current = { dir: 0, timer: null, scrolled: 0 };
    };

    const updateAutoscroll = (pointerY: number) => {
        const vp = viewport.current;
        if (!vp) return;
        const dir: -1 | 0 | 1 =
            pointerY < vp.top + AUTOSCROLL_EDGE ? -1 : pointerY > vp.top + vp.height - AUTOSCROLL_EDGE ? 1 : 0;
        autoscroll.current.dir = dir;
        if (dir === 0) {
            if (autoscroll.current.timer) { clearInterval(autoscroll.current.timer); autoscroll.current.timer = null; }
            return;
        }
        if (autoscroll.current.timer) return;
        autoscroll.current.timer = setInterval(() => {
            const step = AUTOSCROLL_STEP * autoscroll.current.dir;
            const next = Math.max(0, scrollOffset.value + step);
            if (next === scrollOffset.value) return; // clamped at the top; nothing more to reveal
            runOnUI((y: number) => { 'worklet'; scrollTo(scrollRef, 0, y, false); })(next);
            // Fold the scroll into the move target so the block keeps trailing the finger off-screen.
            autoscroll.current.scrolled += next - scrollOffset.value;
            applySession();
        }, AUTOSCROLL_TICK_MS);
    };

    const draftNow = (): TemplateDraft => ({ wakeTime, sleepTime, blocks });

    // Seeds a block where a free slot was tapped. locationY is relative to the tapped gap band, so
    // the time reads straight off the gap's own start — no canvas measuring. The editor's create
    // path owns naming, typing, and overlap resolution from there.
    const handleGapTap = (gap: GridFree, locationY: number) => {
        const tapped = fromMins(toMins(gap.startTime) + Math.round(pointsToMinutes(locationY)));
        const range = seedBlockRange(draftNow(), tapped);
        if (range) onCreateRange(range.startTime, range.endTime);
    };

    return (
        <View>
            <Animated.View entering={entering ? FadeInDown.duration(300) : undefined}>
                <BoundaryTimeControl label="Wake" time={wakeTime} onChange={onWakeChange} />
            </Animated.View>

            <View style={[styles.canvas, { height: totalHeight }]}>
                <View style={styles.spine} pointerEvents="none" />
                {ticks.map((tick) => (
                    <Fragment key={tick.time}>
                        <View style={[styles.tickLine, { top: tick.offset }]} pointerEvents="none" />
                        <Text style={[styles.tickLabel, { top: tick.offset - 7 }]} pointerEvents="none">
                            {formatHourLabel(tick.time)}
                        </Text>
                    </Fragment>
                ))}

                {/* Each free slot is its own tap target that seeds a block; a drag on it falls through
                    to scroll. Blocks render on top and own their own gestures. */}
                {free
                    .filter((f) => f.durationMinutes >= MIN_BLOCK_MINUTES)
                    .map((f) => <GapSlot key={`gap-${f.startTime}`} free={f} onTap={(y) => handleGapTap(f, y)} />)}

                {laidBlocks.map((laid, i) => {
                    const invalid = outOfBoundsIndexes.has(laid.index);
                    const beforeWake = invalid && toMins(laid.block.startTime) < toMins(wakeTime);
                    const afterSleep = invalid && toMins(laid.block.endTime) > toMins(sleepTime);
                    return (
                    <BlockCard
                        key={blockKeys[laid.index] ?? `block-${laid.index}`}
                        laid={laid}
                        invalid={invalid}
                        beforeWakeText={beforeWake ? `Starts before your ${formatTime(wakeTime)} wake time` : null}
                        afterSleepText={afterSleep ? `Runs past your ${formatTime(sleepTime)} sleep time` : null}
                        entering={entering ? FadeInDown.duration(300).delay((i + 1) * 40) : undefined}
                        onPress={() => onEditBlock(laid.index)}
                        session={session}
                        applySession={applySession}
                        endSession={endSession}
                        cancelSession={cancelSession}
                        measureViewport={measureViewport}
                        updateAutoscroll={updateAutoscroll}
                    />
                    );
                })}
            </View>

            <Animated.View entering={entering ? FadeInDown.duration(300).delay((laidBlocks.length + 1) * 40) : undefined}>
                <BoundaryTimeControl label="Sleep" time={sleepTime} onChange={onSleepChange} />
            </Animated.View>
        </View>
    );
}

// A free slot: tap to seed a block there, drag to scroll past it. Only spans long enough earn the
// "Xh free" caption; shorter ones stay bare but remain tappable.
function GapSlot({ free, onTap }: { free: GridFree; onTap: (locationY: number) => void }) {
    return (
        <Pressable
            style={[styles.freeBand, { top: free.top, height: free.height }]}
            onPress={(e) => onTap(e.nativeEvent.locationY)}
        >
            {free.durationMinutes >= FREE_LABEL_MIN_MINUTES && (
                <Text style={styles.freeLabel}>
                    {formatDuration(free.durationMinutes)} free
                    <Text style={styles.freeHint}>   Tap to add a block</Text>
                </Text>
            )}
        </Pressable>
    );
}

// Anchors render as solid filled events; containers as hollow outlined vessels — the look carries
// the meaning. The energy pill degrades to a dot when the vessel is too short for it.
function BlockCard({
    laid,
    invalid,
    beforeWakeText,
    afterSleepText,
    entering,
    onPress,
    session,
    applySession,
    endSession,
    cancelSession,
    measureViewport,
    updateAutoscroll,
}: {
    laid: GridBlock;
    invalid: boolean;
    beforeWakeText: string | null;
    afterSleepText: string | null;
    entering?: EntryOrExitLayoutType;
    onPress: () => void;
    session: React.MutableRefObject<DragSession | null>;
    applySession: () => void;
    endSession: (label: string) => void;
    cancelSession: () => void;
    measureViewport: () => void;
    updateAutoscroll: (pointerY: number) => void;
}) {
    const { block, top, height, index } = laid;
    const isContainer = block.type === 'CONTAINER';
    const fit = fitToHeight(height);
    const energy = isContainer && block.energyLevel ? block.energyLevel : null;
    const showEdges = height >= EDGE_HANDLE_MIN_HEIGHT;

    const gestures = useMemo(() => {
        const beginMove = () => {
            const snapshot = useTemplateStore.getState().draft;
            if (!snapshot) return;
            session.current = { kind: 'move', snapshot, index, originStart: toMins(snapshot.blocks[index].startTime), translation: 0 };
            measureViewport();
        };
        const tap = Gesture.Tap().onEnd((_e, ok) => { if (ok) onPress(); }).runOnJS(true);
        const move = Gesture.Pan()
            .activateAfterLongPress(LONG_PRESS_MS)
            .onStart(beginMove)
            .onUpdate((e) => {
                if (session.current?.kind !== 'move') return;
                session.current.translation = e.translationY;
                applySession();
                updateAutoscroll(e.absoluteY);
            })
            .onEnd(() => endSession('Block moved'))
            .onFinalize((_e, ok) => { if (!ok && session.current) cancelSession(); })
            .runOnJS(true);

        const resize = (edge: 'start' | 'end') =>
            Gesture.Pan()
                .onStart(() => {
                    const snapshot = useTemplateStore.getState().draft;
                    if (!snapshot) return;
                    const b = snapshot.blocks[index];
                    session.current = { kind: 'resize', snapshot, index, edge, originEdge: toMins(edge === 'end' ? b.endTime : b.startTime), translation: 0 };
                })
                .onUpdate((e) => {
                    if (session.current?.kind !== 'resize') return;
                    session.current.translation = e.translationY;
                    applySession();
                })
                .onEnd(() => endSession('Block resized'))
                .onFinalize((_e, ok) => { if (!ok && session.current) cancelSession(); })
                .runOnJS(true);

        return { body: Gesture.Race(tap, move), top: resize('start'), bottom: resize('end') };
        // Index is stable across a drag (no reorder), so rebuilding only when it changes is enough.
    }, [index]);

    return (
        <Animated.View entering={entering} style={[styles.blockBand, { top, height }]}>
            <GestureDetector gesture={gestures.body}>
                <View
                    style={[
                        styles.card,
                        { paddingVertical: fit.padV },
                        isContainer ? styles.cardContainer : styles.cardAnchor,
                        invalid && styles.cardInvalid,
                    ]}
                >
                    <View style={styles.cardHeader}>
                        <Text style={[styles.cardName, { fontSize: fit.nameSize }]} numberOfLines={1}>{block.name}</Text>
                        {energy && fit.energy === 'pill' && (
                            <View style={styles.energyPill}><Text style={styles.energyPillText}>{ENERGY_LABELS[energy]} energy</Text></View>
                        )}
                        {energy && fit.energy === 'dot' && (
                            <View style={[styles.energyDot, { backgroundColor: effortDotColor(energy) }]} />
                        )}
                    </View>
                    {fit.time && (
                        <Text style={styles.cardTime}>
                            {formatTimeRange(block.startTime, block.endTime)}
                            <Text style={styles.cardDuration}>{`   ${formatDuration(durationMins(block.startTime, block.endTime))}`}</Text>
                        </Text>
                    )}
                    {/* Anchored to the edge that crosses the boundary, so the reason reads where the block spills over. */}
                    {beforeWakeText && <Text style={[styles.boundsNote, styles.boundsNoteTop]}>{beforeWakeText}</Text>}
                    {afterSleepText && <Text style={[styles.boundsNote, styles.boundsNoteBottom]}>{afterSleepText}</Text>}
                </View>
            </GestureDetector>

            {showEdges && (
                <>
                    <GestureDetector gesture={gestures.top}>
                        <View style={[styles.edgeHandle, styles.edgeTop]} />
                    </GestureDetector>
                    <GestureDetector gesture={gestures.bottom}>
                        <View style={[styles.edgeHandle, styles.edgeBottom]} />
                    </GestureDetector>
                </>
            )}
        </Animated.View>
    );
}

// How a block's card fills its true height. Since heights are never inflated, a short block gets
// a smaller font and sheds detail (time range, then the energy pill) to stay inside its own
// bounds instead of overrunning the next block — the Apple-Calendar approach.
function fitToHeight(height: number): { padV: number; nameSize: number; energy: 'pill' | 'dot' | 'none'; time: boolean } {
    if (height >= 56) return { padV: 10, nameSize: 14, energy: 'pill', time: true };
    if (height >= 40) return { padV: 8, nameSize: 13, energy: 'dot', time: false };
    if (height >= 26) return { padV: 5, nameSize: 12, energy: 'none', time: false };
    return { padV: 3, nameSize: 11, energy: 'none', time: false };
}

const styles = StyleSheet.create({
    canvas: { position: 'relative' },
    spine: { position: 'absolute', top: 0, bottom: 0, left: RULER_WIDTH, width: 1, backgroundColor: colors.border.hairline },

    tickLine: { position: 'absolute', left: RULER_WIDTH, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.border.hairline },
    tickLabel: {
        position: 'absolute', left: 0, width: RULER_WIDTH - spacing.sm, textAlign: 'right',
        fontSize: 10.5, color: colors.text.muted, letterSpacing: -0.1, fontVariant: ['tabular-nums'],
    },

    freeBand: { position: 'absolute', left: CONTENT_LEFT, right: 0, justifyContent: 'center', paddingLeft: spacing.xs },
    freeLabel: { fontSize: 11, color: 'rgba(122,115,106,0.7)', letterSpacing: -0.1, fontVariant: ['tabular-nums'] },
    freeHint: { color: colors.accent.default, fontWeight: '500' },

    blockBand: { position: 'absolute', left: CONTENT_LEFT, right: 0 },
    card: { flex: 1, borderRadius: radius.lg, paddingHorizontal: 14, overflow: 'hidden' },
    cardAnchor: { backgroundColor: colors.surface.block, borderWidth: 1, borderColor: colors.border.warm },
    cardContainer: { borderWidth: 1.5, borderColor: 'rgba(42,38,33,0.16)', borderStyle: 'dashed' },
    cardInvalid: { borderWidth: 1, borderStyle: 'solid', borderColor: colors.danger.border, backgroundColor: colors.danger.tint },

    cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    cardName: { fontSize: 14, fontWeight: '500', color: colors.text.primary, letterSpacing: -0.2, flexShrink: 1 },
    cardTime: { fontSize: 11, color: '#9a9389', letterSpacing: -0.15, marginTop: 3, fontVariant: ['tabular-nums'] },
    cardDuration: { color: colors.text.secondary, fontWeight: '600' },

    energyPill: { backgroundColor: 'rgba(232,223,209,0.3)', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
    energyPillText: { fontSize: 12, color: 'rgba(122,115,106,0.6)' },
    energyDot: { width: 8, height: 8, borderRadius: 4 },

    boundsNote: { fontSize: 11.5, fontWeight: '500', color: colors.danger.default, letterSpacing: -0.1, lineHeight: 15 },
    boundsNoteTop: { marginTop: 3 },
    boundsNoteBottom: { position: 'absolute', left: 14, right: 14, bottom: 8 },

    // Kept inside the card (not overhanging) so abutting blocks never share a resize zone.
    edgeHandle: { position: 'absolute', left: 0, right: 0, height: EDGE_HANDLE },
    edgeTop: { top: 0 },
    edgeBottom: { bottom: 0 },
});
