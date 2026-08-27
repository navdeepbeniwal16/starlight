import { useCallback, useMemo, useRef, useState } from "react";
import {
    ActivityIndicator,
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
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { api } from "../lib/api";
import type { ConfirmAssignment, PlanProposal } from "../lib/api.types";
import { usePlanningStore } from "../stores/planning.store";
import { useOnboardingTasksStore } from "../stores/onboardingTasks.store";
import { formatTime, toMins } from "../lib/time";

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
// end of the target block (or to the unscheduled list). Pure — never mutates
// the input board or any block it contains.
function moveTask(board: Board, taskId: string, fromZone: string, toZone: string): Board {
    let moved: TaskItem | undefined;

    if (fromZone === UNSCHEDULED_ZONE) {
        const item = board.unscheduled.find(t => t.id === taskId);
        if (item) moved = { id: item.id, title: item.title, remainingMins: item.remainingMins };
    } else {
        moved = board.blocks.find(b => b.id === fromZone)?.tasks.find(t => t.id === taskId);
    }
    if (!moved) return board; // task not found in source — no-op
    const task = moved;

    const blocks = board.blocks.map(b => {
        if (b.id === fromZone) return { ...b, tasks: b.tasks.filter(t => t.id !== taskId) };
        if (b.id === toZone) return { ...b, tasks: [...b.tasks, task] };
        return b;
    });

    let unscheduled = board.unscheduled;
    if (fromZone === UNSCHEDULED_ZONE) {
        unscheduled = unscheduled.filter(t => t.id !== taskId);
    }
    if (toZone === UNSCHEDULED_ZONE) {
        unscheduled = [...unscheduled, { ...task, reason: null }];
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

// Board zone ids are the proposal's template block ids, which is what the
// confirm endpoint expects assignments to reference.
function boardFromProposal(proposal: PlanProposal): Board {
    return {
        blocks: proposal.blocks
            .filter(b => b.type === 'CONTAINER')
            .sort((a, b) => toMins(a.startTime) - toMins(b.startTime))
            .map(b => ({
                id: b.blockId,
                name: b.name,
                startTime: b.startTime,
                endTime: b.endTime,
                energyLevel: b.energyLevel,
                tasks: b.tasks.map(t => ({ id: t.id, title: t.title, remainingMins: t.remainingMins })),
            })),
        unscheduled: proposal.unschedulable.map(u => ({
            id: u.taskId,
            title: u.title,
            remainingMins: u.remainingMins,
            reason: u.reason,
        })),
    };
}

// Flattens the board into the confirm payload: every scheduled task with its
// block (template block id) and position.
function assignmentsFromBoard(board: Board): ConfirmAssignment[] {
    return board.blocks.flatMap(block =>
        block.tasks.map((task, i) => ({ taskId: task.id, blockId: block.id, blockOrder: i }))
    );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export function ReviewPlan({ onboarding = false }: { onboarding?: boolean }) {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const isOnboarding = onboarding;
    const proposal = usePlanningStore(s => s.proposal);
    const clearProposal = usePlanningStore(s => s.clear);

    // The board is derived from the store-held proposal once on mount; edits
    // stay local until confirm. The store survives remounts, so re-entering
    // this screen rebuilds the board.
    const [board, setBoardState] = useState<Board | null>(() => (proposal ? boardFromProposal(proposal) : null));
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

    // Cross-section move: append the task to the end of the target zone. Edits
    // stay in local board state until the plan is confirmed.
    const handleDrop = useCallback((taskId: string, fromZone: string, toZone: string) => {
        const snapshot = boardRef.current;
        if (!snapshot) return;
        applyBoard(moveTask(snapshot, taskId, fromZone, toZone));
        resetDragShared();
    }, [applyBoard, resetDragShared]);

    // Within-section reorder. Updates local board state only, like handleDrop.
    const handleReorder = useCallback((sectionId: string, taskId: string, orderedIds: string[]) => {
        const snapshot = boardRef.current;
        if (!snapshot) return;
        if (sameOrder(sectionIds(snapshot, sectionId), orderedIds)) { resetDragShared(); return; }
        applyBoard(reorderSection(snapshot, sectionId, orderedIds));
        resetDragShared();
    }, [applyBoard, resetDragShared]);

    // Exit to Today and discard the proposal. The default flow is a modal over an
    // already-mounted Today, so dismissTo pops back to it (dismissAll would only
    // scope to the nested planning stack, landing on the review-tasks screen).
    // Onboarding renders this screen inside its own stack with no Today beneath
    // it, so there dismissTo has nothing to match — replace swaps the stack instead.
    const dismissFlow = useCallback(() => {
        clearProposal();
        if (isOnboarding) router.replace('/(main)');
        else router.dismissTo('/(main)');
    }, [clearProposal, router, isOnboarding]);

    // In onboarding, close steps back to first-task rather than tearing the flow
    // down into an empty Today.
    const handleClose = useCallback(() => {
        if (isOnboarding) router.back();
        else dismissFlow();
    }, [isOnboarding, router, dismissFlow]);

    const [confirming, setConfirming] = useState(false);

    // Persist the plan: send the board's placements to the confirm endpoint,
    // which creates the ACTIVE plan in one transaction. On success, tear down the
    // modal — the timeline reloads on focus and shows the new plan. On failure,
    // offer a retry (the board is untouched, so retrying just resends).
    const handleConfirm = useCallback(async () => {
        const snapshot = boardRef.current;
        if (!snapshot || confirming) return;
        setConfirming(true);
        const res = await api.confirmPlan(assignmentsFromBoard(snapshot));
        if (res.ok) {
            // Stamp completion server-side before tearing down, so any future
            // sign-in (this device or another) resolves straight to Today.
            if (isOnboarding) {
                await api.completeOnboarding();
                useOnboardingTasksStore.getState().reset();
            }
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            dismissFlow();
            return;
        }
        setConfirming(false);
        Alert.alert("Couldn't confirm plan", res.error, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Retry', onPress: () => handleConfirm() },
        ]);
    }, [confirming, dismissFlow, isOnboarding]);

    if (!board) {
        return (
            <SafeAreaView style={s.container} edges={['top']}>
                <Header onClose={handleClose} onboarding={isOnboarding} />
                <View style={s.centered}>
                    <Text style={s.muted}>No generated plan to show. Start a planning session again.</Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <GestureHandlerRootView style={s.flex}>
            <SafeAreaView style={s.container} edges={['top']}>
                <Header onClose={handleClose} onboarding={isOnboarding} />

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
                    <TouchableOpacity
                        style={[s.confirmButton, confirming && s.confirmButtonDisabled]}
                        activeOpacity={0.85}
                        onPress={handleConfirm}
                        disabled={confirming}
                    >
                        {confirming
                            ? <ActivityIndicator size="small" color="#fdfcfa" />
                            : <Text style={s.confirmButtonLabel}>Confirm my plan</Text>
                        }
                    </TouchableOpacity>
                    {isOnboarding && (
                        <TouchableOpacity
                            style={s.footerBack}
                            onPress={handleClose}
                            disabled={confirming}
                            activeOpacity={0.8}
                        >
                            <Text style={s.footerBackLabel}>Back</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </SafeAreaView>
        </GestureHandlerRootView>
    );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Header({ onClose, onboarding }: { onClose: () => void; onboarding?: boolean }) {
    return (
        <View style={s.header}>
            <View style={s.stepEyebrow}>
                {onboarding ? (
                    <>
                        <View style={[s.stepPip, s.stepPipDone]} />
                        <View style={[s.stepPip, s.stepPipDone]} />
                        <View style={[s.stepPip, s.stepPipActive]} />
                        <Text style={s.stepLabel}>Step 3 of 3</Text>
                    </>
                ) : (
                    <>
                        <View style={[s.stepPip, s.stepPipDone]} />
                        <View style={[s.stepPip, s.stepPipActive]} />
                        <Text style={s.stepLabel}>Step 2 of 2</Text>
                    </>
                )}
            </View>
            <View style={s.headerRow}>
                <Text style={s.headerTitle}>{onboarding ? "Here's your day" : 'Review your plan'}</Text>
                {!onboarding && (
                    <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} activeOpacity={0.6}>
                        <Ionicons name="close" size={22} color="#2a2621" />
                    </TouchableOpacity>
                )}
            </View>
            <Text style={s.headerSubtitle}>Rearrange anything, then confirm.</Text>
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
    const restBorder = variant === 'unscheduled' ? 'transparent' : 'rgba(42,38,33,0.08)';
    const highlight = useAnimatedStyle(() => ({
        borderColor: hoveredZone.value === zoneId ? '#d4a574' : restBorder,
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
                        <Ionicons name="remove" size={16} color="rgba(122,115,106,0.7)" />
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
        paddingHorizontal: 20,
        paddingTop: 24,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(42,38,33,0.06)',
    },
    stepEyebrow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 10,
    },
    stepPip: {
        width: 5,
        height: 5,
        borderRadius: 2.5,
        backgroundColor: 'rgba(42,38,33,0.14)',
    },
    stepPipDone: {
        backgroundColor: '#d4a574',
    },
    stepPipActive: {
        width: 14,
        backgroundColor: '#d4a574',
    },
    stepLabel: {
        fontSize: 11,
        fontWeight: '600',
        color: 'rgba(122,115,106,0.5)',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        marginLeft: 2,
        fontVariant: ['tabular-nums'],
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    headerTitle: { fontSize: 16, fontWeight: '600', color: '#2a2621', letterSpacing: -0.3 },
    headerSubtitle: {
        fontSize: 13,
        color: '#7a736a',
        lineHeight: 18,
        marginTop: 6,
        maxWidth: 320,
    },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    muted: { fontSize: 13, color: '#7a736a', textAlign: 'center', lineHeight: 18 },

    scrollContent: { padding: 16, gap: 14, paddingBottom: 24 },
    hint: { fontSize: 12, color: 'rgba(122,115,106,0.7)', lineHeight: 16, letterSpacing: -0.1, textAlign: 'center' },

    zoneHighlightBase: { borderWidth: 1.5, borderColor: 'transparent' },
    blockZone: {
        backgroundColor: 'rgba(232,228,221,0.45)',
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
    confirmButtonDisabled: { opacity: 0.6 },
    confirmButtonLabel: { fontSize: 15, fontWeight: '600', color: '#fdfcfa', letterSpacing: -0.2 },
    footerBack: { height: 44, justifyContent: 'center', alignItems: 'center' },
    footerBackLabel: { fontSize: 15, fontWeight: '500', color: '#7a736a', letterSpacing: -0.1 },
});
