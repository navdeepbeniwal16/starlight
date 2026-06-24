import { useCallback, useMemo, useRef, useState } from "react";
import {
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    type View as RNView,
} from "react-native";
import Animated, {
    FadeIn,
    FadeOut,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from "react-native-reanimated";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../../lib/api";
import { takeGeneratedPlan } from "../../../lib/planningSession";
import { formatTime, toMins } from "../../../lib/time";

// ─── Local board model ────────────────────────────────────────────────────────

type TaskItem = { id: string; title: string; remainingMins: number };
type DraftBlock = {
    id: string;
    name: string;
    startTime: string;
    endTime: string;
    energyLevel: 'HIGH' | 'MEDIUM' | 'LOW' | null;
    tasks: TaskItem[];
};
type UnscheduledItem = TaskItem & { reason: string | null };
type Board = { blocks: DraftBlock[]; unscheduled: UnscheduledItem[] };

const UNSCHEDULED_ZONE = 'unscheduled';
const TASK_GAP = 8; // must match s.taskList `gap`
// Critically-damped-ish: settles without bounce/overshoot for a calm drop.
const REORDER_SPRING = { damping: 32, stiffness: 170, mass: 0.9, overshootClamping: true };

function formatMins(mins: number): string {
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function energyLabel(level: DraftBlock['energyLevel']): string | null {
    return level ? level.charAt(0) + level.slice(1).toLowerCase() + ' energy' : null;
}

// Moves a task from one zone to another, returning a new board. Appends to the
// end of the target block (or to the unscheduled list). Pure.
function moveTask(board: Board, taskId: string, fromZone: string, toZone: string): Board {
    let moved: TaskItem | undefined;

    const blocks = board.blocks.map(b => {
        if (b.id !== fromZone) return b;
        const task = b.tasks.find(t => t.id === taskId);
        if (task) moved = task;
        return { ...b, tasks: b.tasks.filter(t => t.id !== taskId) };
    });

    let unscheduled = board.unscheduled;
    if (fromZone === UNSCHEDULED_ZONE) {
        const item = board.unscheduled.find(t => t.id === taskId);
        if (item) moved = { id: item.id, title: item.title, remainingMins: item.remainingMins };
        unscheduled = board.unscheduled.filter(t => t.id !== taskId);
    }

    if (!moved) return board; // task not found in source — no-op

    if (toZone === UNSCHEDULED_ZONE) {
        unscheduled = [...unscheduled, { ...moved, reason: null }];
    } else {
        const target = blocks.find(b => b.id === toZone);
        if (!target) return board;
        target.tasks = [...target.tasks, moved];
    }

    return { blocks, unscheduled };
}

// Ordered task ids for a section (a block, or the unscheduled list).
function sectionIds(board: Board | null, sectionId: string): string[] {
    if (!board) return [];
    if (sectionId === UNSCHEDULED_ZONE) return board.unscheduled.map(t => t.id);
    return board.blocks.find(b => b.id === sectionId)?.tasks.map(t => t.id) ?? [];
}

// Reorders a section's items to match `orderedIds`, returning a new board. Pure.
function reorderSection(board: Board, sectionId: string, orderedIds: string[]): Board {
    const pos = new Map(orderedIds.map((id, i) => [id, i]));
    const sort = <T extends { id: string }>(items: T[]): T[] =>
        [...items].sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
    if (sectionId === UNSCHEDULED_ZONE) return { ...board, unscheduled: sort(board.unscheduled) };
    return { ...board, blocks: board.blocks.map(b => (b.id === sectionId ? { ...b, tasks: sort(b.tasks) } : b)) };
}

function sameOrder(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((id, i) => id === b[i]);
}

function initialBoard(): Board | null {
    const result = takeGeneratedPlan();
    if (!result) return null;
    return {
        blocks: result.plan.blocks
            .filter(b => b.type === 'CONTAINER')
            .map(b => ({
                id: b.id,
                name: b.name,
                startTime: b.startTime,
                endTime: b.endTime,
                energyLevel: b.energyLevel,
                tasks: b.tasks.map(t => ({ id: t.id, title: t.title, remainingMins: t.remainingMins })),
            })),
        unscheduled: result.unschedulable.map(u => ({
            id: u.taskId,
            title: u.title,
            remainingMins: u.remainingMins,
            reason: u.reason,
        })),
    };
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ReviewPlanScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { planId } = useLocalSearchParams<{ planId: string }>();

    const [board, setBoardState] = useState<Board | null>(() => initialBoard());
    const boardRef = useRef<Board | null>(board);
    const applyBoard = useCallback((next: Board) => {
        boardRef.current = next;
        setBoardState(next);
    }, []);

    const [dragging, setDragging] = useState(false);

    // ─ Shared drag state (one drag at a time) ─
    const activeId = useSharedValue<string | null>(null);
    const activeSection = useSharedValue<string | null>(null);
    const crossSection = useSharedValue(false); // finger is over a different zone
    const committed = useSharedValue(false);     // the gesture ended in a move/reorder
    const tx = useSharedValue(0);
    const ty = useSharedValue(0);
    const startCenterY = useSharedValue(0);
    const hoveredZone = useSharedValue<string | null>(null);
    const zones = useSharedValue<{ id: string; top: number; bottom: number }[]>([]);

    // Live within-section ordering. `order` is the dragged section's task ids in
    // their current drag-time order; each sibling animates to the slot it implies.
    // The geometry arrays are the section's at-rest measurements (window space),
    // captured once at drag start and index-aligned to `secIds`.
    const order = useSharedValue<string[]>([]);
    const secIds = useSharedValue<string[]>([]);
    const secTops = useSharedValue<number[]>([]);
    const secHeights = useSharedValue<number[]>([]);
    const secCenters = useSharedValue<number[]>([]);

    // Refs to drop-zone and card host views, for window-space measurement.
    const zoneRefs = useRef<Map<string, RNView>>(new Map());
    const cardRefs = useRef<Map<string, RNView>>(new Map());

    const measureZones = useCallback(() => {
        const refs = Array.from(zoneRefs.current.entries());
        const acc: { id: string; top: number; bottom: number }[] = [];
        let pending = refs.length;
        if (pending === 0) { zones.value = []; return; }
        refs.forEach(([id, view]) => {
            view.measureInWindow((_x, y, _w, h) => {
                acc.push({ id, top: y, bottom: y + h });
                pending -= 1;
                if (pending === 0) zones.value = acc;
            });
        });
    }, [zones]);

    // Snaps all drag shared-values back to rest. Called by the JS move/reorder
    // handlers *after* the board state is applied, so the reset and the new layout
    // land on the same render (no flash of the dragged card at its old slot).
    const resetDragShared = useCallback(() => {
        activeId.value = null;
        activeSection.value = null;
        crossSection.value = false;
        hoveredZone.value = null;
        order.value = [];
        tx.value = 0;
        ty.value = 0;
    }, [activeId, activeSection, crossSection, hoveredZone, order, tx, ty]);

    // Bundle the shared values so each card subscribes to the same drag state.
    const dragShared = useMemo<DragShared>(() => ({
        activeId, activeSection, crossSection, committed,
        tx, ty, startCenterY, hoveredZone, zones,
        order, secIds, secTops, secHeights, secCenters,
    }), [activeId, activeSection, crossSection, committed, tx, ty, startCenterY, hoveredZone, zones, order, secIds, secTops, secHeights, secCenters]);

    const prepareDrag = useCallback((taskId: string, sectionId: string) => {
        setDragging(true);
        measureZones();
        activeSection.value = sectionId;
        crossSection.value = false;
        committed.value = false;

        const ids = sectionIds(boardRef.current, sectionId);
        const tops: number[] = [];
        const heights: number[] = [];
        const centers: number[] = [];
        let pending = ids.length;
        const commit = () => {
            secIds.value = ids;
            secTops.value = tops;
            secHeights.value = heights;
            secCenters.value = centers;
            order.value = [...ids];
        };
        if (pending === 0) { commit(); return; }
        ids.forEach((id, i) => {
            const view = cardRefs.current.get(id);
            if (!view) { pending -= 1; if (pending === 0) commit(); return; }
            view.measureInWindow((_x, y, _w, h) => {
                tops[i] = y; heights[i] = h; centers[i] = y + h / 2;
                if (id === taskId) startCenterY.value = y + h / 2;
                pending -= 1;
                if (pending === 0) commit();
            });
        });
    }, [measureZones, activeSection, crossSection, committed, secIds, secTops, secHeights, secCenters, order, startCenterY]);

    const endDrag = useCallback(() => setDragging(false), []);

    // Cross-section move: append the task to the end of the target zone.
    const handleDrop = useCallback(async (taskId: string, fromZone: string, toZone: string) => {
        const snapshot = boardRef.current;
        if (!snapshot || !planId) return;

        const next = moveTask(snapshot, taskId, fromZone, toZone);
        applyBoard(next);
        resetDragShared();

        const body = toZone === UNSCHEDULED_ZONE
            ? { blockId: null, blockOrder: 0 }
            : { blockId: toZone, blockOrder: snapshot.blocks.find(b => b.id === toZone)?.tasks.length ?? 0 };

        const res = await api.adjustPlanTask(planId, taskId, body);
        if (!res.ok) {
            applyBoard(snapshot); // revert on failure
            Alert.alert("Couldn't move task", res.error);
        }
    }, [planId, applyBoard, resetDragShared]);

    // Within-section reorder. The server owns ordering and renumbers the block, so
    // we send a single "move taskId to this slot" call (not a per-task batch).
    // Unscheduled order is local-only (the backlog has no stored order).
    const handleReorder = useCallback(async (sectionId: string, taskId: string, orderedIds: string[]) => {
        const snapshot = boardRef.current;
        if (!snapshot || !planId) return;

        if (sameOrder(sectionIds(snapshot, sectionId), orderedIds)) { resetDragShared(); return; }

        const next = reorderSection(snapshot, sectionId, orderedIds);
        applyBoard(next);
        resetDragShared();

        if (sectionId === UNSCHEDULED_ZONE) return;

        const res = await api.adjustPlanTask(planId, taskId, { blockId: sectionId, blockOrder: orderedIds.indexOf(taskId) });
        if (!res.ok) {
            applyBoard(snapshot); // revert on failure
            Alert.alert("Couldn't reorder tasks", "Your changes were reverted. Please try again.");
        }
    }, [planId, applyBoard, resetDragShared]);

    const handleConfirm = useCallback(() => {
        // T-08 builds the confirmation step (promotes DRAFT → ACTIVE).
        Alert.alert('Confirm plan', 'Plan confirmation is coming next (T-08).');
    }, []);

    // Tear down the whole planning modal. dismissAll() only scopes to the nested
    // planning stack (it would land back on the review-tasks screen), so dismiss to
    // the route that launched the flow.
    const dismissFlow = useCallback(() => router.dismissTo('/(main)'), [router]);

    if (!board) {
        return (
            <SafeAreaView style={s.container} edges={['top']}>
                <Header onClose={dismissFlow} />
                <View style={s.centered}>
                    <Text style={s.muted}>No generated plan to show. Start a planning session again.</Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <GestureHandlerRootView style={s.flex}>
            <SafeAreaView style={s.container} edges={['top']}>
                <Header onClose={dismissFlow} />

                <ScrollView
                    contentContainerStyle={s.scrollContent}
                    showsVerticalScrollIndicator={false}
                    scrollEnabled={!dragging}
                >
                    <Text style={s.hint}>Hold and drag a task to move it between blocks.</Text>

                    {board.blocks.map(block => {
                        const capacity = toMins(block.endTime) - toMins(block.startTime);
                        const used = block.tasks.reduce((sum, t) => sum + t.remainingMins, 0);
                        const remaining = capacity - used;
                        return (
                        <DropZone
                            key={block.id}
                            zoneId={block.id}
                            hoveredZone={hoveredZone}
                            registerRef={(v) => { if (v) zoneRefs.current.set(block.id, v); else zoneRefs.current.delete(block.id); }}
                        >
                            <View style={s.blockHeader}>
                                <View style={s.blockHeaderLeft}>
                                    <Text style={s.blockName}>{block.name}</Text>
                                    <Text style={s.blockTime}>
                                        {formatTime(block.startTime)} – {formatTime(block.endTime)}
                                        {'  ·  '}
                                        <Text style={remaining < 0 ? s.blockCapacityOver : s.blockCapacityLeft}>
                                            {remaining >= 0 ? `${formatMins(remaining)} left` : `over by ${formatMins(-remaining)}`}
                                        </Text>
                                    </Text>
                                </View>
                                {energyLabel(block.energyLevel) && (
                                    <View style={s.energyBadge}><Text style={s.energyBadgeText}>{energyLabel(block.energyLevel)}</Text></View>
                                )}
                            </View>
                            {block.tasks.length === 0 ? (
                                <Text style={s.emptyZone}>Drop a task here</Text>
                            ) : (
                                <View style={s.taskList}>
                                    {block.tasks.map(task => (
                                        <DraggableTask
                                            key={task.id}
                                            task={task}
                                            sourceZone={block.id}
                                            drag={dragShared}
                                            onDragStart={prepareDrag}
                                            onDrop={handleDrop}
                                            onReorder={handleReorder}
                                            onFinalize={endDrag}
                                            registerRef={(v) => { if (v) cardRefs.current.set(task.id, v); else cardRefs.current.delete(task.id); }}
                                        />
                                    ))}
                                </View>
                            )}
                        </DropZone>
                        );
                    })}

                    {/* Unscheduled / removed tasks — also a drop target. */}
                    <DropZone
                        zoneId={UNSCHEDULED_ZONE}
                        hoveredZone={hoveredZone}
                        registerRef={(v) => { if (v) zoneRefs.current.set(UNSCHEDULED_ZONE, v); else zoneRefs.current.delete(UNSCHEDULED_ZONE); }}
                        variant="unscheduled"
                    >
                        <Text style={s.sectionLabel}>NOT SCHEDULED</Text>
                        {board.unscheduled.length === 0 ? (
                            <Text style={s.emptyZone}>Drag a task here to remove it from the plan</Text>
                        ) : (
                            <View style={s.taskList}>
                                {board.unscheduled.map(task => (
                                    <DraggableTask
                                        key={task.id}
                                        task={task}
                                        reason={task.reason}
                                        sourceZone={UNSCHEDULED_ZONE}
                                        drag={dragShared}
                                        onDragStart={prepareDrag}
                                        onDrop={handleDrop}
                                        onReorder={handleReorder}
                                        onFinalize={endDrag}
                                        registerRef={(v) => { if (v) cardRefs.current.set(task.id, v); else cardRefs.current.delete(task.id); }}
                                    />
                                ))}
                            </View>
                        )}
                    </DropZone>
                </ScrollView>

                <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 24) }]}>
                    <TouchableOpacity style={s.confirmButton} activeOpacity={0.85} onPress={handleConfirm}>
                        <Text style={s.confirmButtonLabel}>Confirm plan</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        </GestureHandlerRootView>
    );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Header({ onClose }: { onClose: () => void }) {
    return (
        <View style={s.header}>
            <Text style={s.headerTitle}>Review plan</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} activeOpacity={0.6}>
                <Ionicons name="close" size={22} color="#2a2621" />
            </TouchableOpacity>
        </View>
    );
}

type SharedStr = ReturnType<typeof useSharedValue<string | null>>;
type SharedNum = ReturnType<typeof useSharedValue<number>>;
type SharedBool = ReturnType<typeof useSharedValue<boolean>>;
type SharedStrArr = ReturnType<typeof useSharedValue<string[]>>;
type SharedNumArr = ReturnType<typeof useSharedValue<number[]>>;
type SharedZones = ReturnType<typeof useSharedValue<{ id: string; top: number; bottom: number }[]>>;

type DragShared = {
    activeId: SharedStr;
    activeSection: SharedStr;
    crossSection: SharedBool;
    committed: SharedBool;
    tx: SharedNum;
    ty: SharedNum;
    startCenterY: SharedNum;
    hoveredZone: SharedStr;
    zones: SharedZones;
    order: SharedStrArr;
    secIds: SharedStrArr;
    secTops: SharedNumArr;
    secHeights: SharedNumArr;
    secCenters: SharedNumArr;
};

function DropZone({
    zoneId,
    hoveredZone,
    registerRef,
    variant = 'block',
    children,
}: {
    zoneId: string;
    hoveredZone: SharedStr;
    registerRef: (v: RNView | null) => void;
    variant?: 'block' | 'unscheduled';
    children: React.ReactNode;
}) {
    const highlight = useAnimatedStyle(() => ({
        borderColor: hoveredZone.value === zoneId ? '#d4a574' : 'transparent',
    }));
    return (
        <Animated.View
            ref={registerRef}
            style={[variant === 'unscheduled' ? s.unscheduledZone : s.blockZone, s.zoneHighlightBase, highlight]}
        >
            {children}
        </Animated.View>
    );
}

function DraggableTask({
    task,
    reason,
    sourceZone,
    drag,
    onDragStart,
    onDrop,
    onReorder,
    onFinalize,
    registerRef,
}: {
    task: TaskItem;
    reason?: string | null;
    sourceZone: string;
    drag: DragShared;
    onDragStart: (taskId: string, sectionId: string) => void;
    onDrop: (taskId: string, fromZone: string, toZone: string) => void;
    onReorder: (sectionId: string, taskId: string, orderedIds: string[]) => void;
    onFinalize: () => void;
    registerRef: (v: RNView | null) => void;
}) {
    const taskId = task.id;
    const {
        activeId, activeSection, crossSection, committed,
        tx, ty, startCenterY, hoveredZone, zones,
        order, secIds, secTops, secHeights, secCenters,
    } = drag;

    const gesture = Gesture.Pan()
        .activateAfterLongPress(160)
        .onStart(() => {
            // Fires once the long-press engages the drag — measure here (not in
            // onBegin) so merely touching a card to scroll doesn't lock scrolling.
            activeId.value = taskId;
            runOnJS(onDragStart)(taskId, sourceZone);
        })
        .onUpdate((e) => {
            tx.value = e.translationX;
            ty.value = e.translationY;
            const centerY = startCenterY.value + e.translationY;

            // Over a *different* zone → cross-section move (zone highlight, append
            // on drop); collapse any gap opened in the source section.
            const zone = zones.value.find(z => centerY >= z.top && centerY <= z.bottom);
            if (zone && zone.id !== activeSection.value) {
                crossSection.value = true;
                hoveredZone.value = zone.id;
                order.value = secIds.value;
                return;
            }

            // Within the source section → live reorder: rebuild `order` by dropping
            // the dragged id and reinserting it past every sibling it now sits below.
            crossSection.value = false;
            hoveredZone.value = null;
            const ids = secIds.value;
            const centers = secCenters.value;
            if (ids.length === 0) return;
            let to = 0;
            for (let i = 0; i < ids.length; i++) {
                if (ids[i] !== taskId && centers[i] < centerY) to += 1;
            }
            const rest = ids.filter(id => id !== taskId);
            rest.splice(to, 0, taskId);
            order.value = rest;
        })
        .onEnd(() => {
            if (crossSection.value && hoveredZone.value && hoveredZone.value !== sourceZone) {
                committed.value = true;
                runOnJS(onDrop)(taskId, sourceZone, hoveredZone.value);
                return;
            }
            const ord = order.value;
            const base = secIds.value;
            let changed = ord.length !== base.length;
            for (let i = 0; !changed && i < ord.length; i++) {
                if (ord[i] !== base[i]) changed = true;
            }
            if (changed) {
                committed.value = true;
                runOnJS(onReorder)(sourceZone, taskId, ord);
            }
        })
        .onFinalize(() => {
            // When a move/reorder committed, the JS handler resets the shared values
            // *after* applying the new board, so the dragged card doesn't flash at
            // its old slot. A no-op drag just springs back here.
            if (!committed.value) {
                activeId.value = null;
                activeSection.value = null;
                hoveredZone.value = null;
                crossSection.value = false;
                order.value = [];
                tx.value = 0;
                ty.value = 0;
            }
            runOnJS(onFinalize)();
        });

    const style = useAnimatedStyle(() => {
        const isActive = activeId.value === taskId;

        // translateY: the active card tracks the finger 1:1; siblings spring to the
        // slot the live `order` implies; everything else rests at 0.
        let translateY = 0;
        let translateX = 0;
        if (isActive) {
            translateX = tx.value;
            translateY = ty.value;
        } else if (activeSection.value === sourceZone && !crossSection.value) {
            const ord = order.value;
            const ids = secIds.value;
            const tops = secTops.value;
            const heights = secHeights.value;
            const myOrig = ids.indexOf(taskId);
            if (ord.length > 0 && myOrig >= 0 && tops.length > 0) {
                // Desired slot top = sum of (height + gap) of everything before me in
                // the live order — including the dragged card, which reserves its gap.
                let acc = tops[0];
                let desired = tops[myOrig];
                for (let k = 0; k < ord.length; k++) {
                    const id = ord[k];
                    if (id === taskId) { desired = acc; break; }
                    acc += (heights[ids.indexOf(id)] ?? 0) + TASK_GAP;
                }
                translateY = withSpring(desired - tops[myOrig], REORDER_SPRING);
            }
        }
        // else: resting (including just-dropped) → snap to slot, no settle animation.

        // Every key is returned in all states — omitting a key in a branch leaves its
        // last value applied (so the lift/shadow would otherwise stick after drop).
        return {
            transform: [{ translateX }, { translateY }, { scale: isActive ? 1.03 : 1 }],
            zIndex: isActive ? 100 : 0,
            elevation: isActive ? 8 : 0,
            shadowColor: '#2a2621',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: isActive ? 0.18 : 0,
            shadowRadius: 10,
        };
    });

    const isScheduled = sourceZone !== UNSCHEDULED_ZONE;

    return (
        <GestureDetector gesture={gesture}>
            <Animated.View
                ref={registerRef}
                style={[s.taskCard, style]}
                entering={FadeIn.duration(180)}
                exiting={FadeOut.duration(140)}
            >
                <Ionicons name="reorder-three-outline" size={18} color="rgba(122,115,106,0.5)" />
                <View style={s.taskContent}>
                    <Text style={s.taskTitle} numberOfLines={2}>{task.title}</Text>
                    {reason ? <Text style={s.taskReason} numberOfLines={2}>{reason}</Text> : null}
                </View>
                <Text style={s.taskMins}>{formatMins(task.remainingMins)}</Text>
                {isScheduled && (
                    <TouchableOpacity
                        onPress={() => onDrop(taskId, sourceZone, UNSCHEDULED_ZONE)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        accessibilityLabel={`Remove ${task.title} from the plan`}
                        style={s.removeButton}
                    >
                        <Ionicons name="close" size={16} color="rgba(122,115,106,0.7)" />
                    </TouchableOpacity>
                )}
            </Animated.View>
        </GestureDetector>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    flex: { flex: 1 },
    container: { flex: 1, backgroundColor: '#fdfcfa' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: 24,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(42,38,33,0.06)',
    },
    headerTitle: { fontSize: 16, fontWeight: '600', color: '#2a2621', letterSpacing: -0.3 },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    muted: { fontSize: 13, color: '#7a736a', textAlign: 'center', lineHeight: 18 },

    scrollContent: { padding: 16, gap: 14, paddingBottom: 24 },
    hint: { fontSize: 12, color: 'rgba(122,115,106,0.7)', textAlign: 'center', marginBottom: 2 },

    zoneHighlightBase: { borderWidth: 1.5, borderColor: 'transparent' },
    blockZone: {
        backgroundColor: '#fffef9',
        borderRadius: 16,
        padding: 16,
        gap: 10,
    },
    unscheduledZone: {
        backgroundColor: 'rgba(232,228,221,0.25)',
        borderRadius: 16,
        padding: 16,
        gap: 10,
    },

    blockHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
    blockHeaderLeft: { flex: 1, marginRight: 8 },
    blockName: { fontSize: 15, fontWeight: '600', color: '#2a2621', letterSpacing: -0.23 },
    blockTime: { fontSize: 12, color: '#9a9389', marginTop: 2 },
    blockCapacityLeft: { color: '#7a9a6f' },
    blockCapacityOver: { color: '#c0775f' },
    energyBadge: {
        backgroundColor: 'rgba(232,223,209,0.4)',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
        alignSelf: 'flex-start',
    },
    energyBadgeText: { fontSize: 12, color: 'rgba(122,115,106,0.7)' },

    sectionLabel: { fontSize: 11, color: 'rgba(122,115,106,0.55)', letterSpacing: 0.5, textTransform: 'uppercase' },
    emptyZone: { fontSize: 13, color: 'rgba(122,115,106,0.5)', fontStyle: 'italic' },

    taskList: { gap: 8 },
    taskCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.08)',
        borderRadius: 14,
        padding: 14,
    },
    taskContent: { flex: 1, gap: 3 },
    taskTitle: { fontSize: 15, color: '#2a2621', letterSpacing: -0.23 },
    taskReason: { fontSize: 12, color: '#9a8d6f' },
    taskMins: { fontSize: 13, color: '#7a736a', fontVariant: ['tabular-nums'] },
    removeButton: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(232,228,221,0.5)',
    },

    footer: {
        paddingHorizontal: 16,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: 'rgba(42,38,33,0.06)',
    },
    confirmButton: { backgroundColor: '#2a2621', borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
    confirmButtonLabel: { fontSize: 15, fontWeight: '600', color: '#fdfcfa', letterSpacing: -0.2 },
});
