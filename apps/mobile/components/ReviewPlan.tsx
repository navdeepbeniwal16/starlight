import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
    ActivityIndicator,
    Alert,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    useWindowDimensions,
    type AccessibilityActionEvent,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import {
    BottomSheetBackdrop,
    BottomSheetModal,
    BottomSheetScrollView,
    type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { api } from "../lib/api";
import type { PlanProposal, ProposalBlock } from "../lib/api.types";
import {
    UNSCHEDULED,
    blockRemainingMins,
    blockZone,
    boardFromProposal,
    eligibleTargets,
    moveTask,
    planFromProposalAndBoard,
    targetZone,
    zoneFromActionName,
    zoneToActionName,
    type MoveTarget,
    type ReviewBlock,
    type ReviewBoard,
    type ReviewTask,
    type UnscheduledTask,
    type Zone,
} from "../lib/reviewBoard";
import { buildReviewTimeline } from "../lib/reviewTimeline";
import { usePlanningStore } from "../stores/planning.store";
import { useOnboardingTasksStore } from "../stores/onboardingTasks.store";
import { useSessionStore } from "../stores/session.store";
import { formatDuration, formatTime, formatTimeRange, toHHmm, toMins } from "../lib/time";
import { TimelineThread, DayBoundaryMarker } from "./timeline";
import { colors, radius, spacing, typography } from "../lib/theme";
import { StepEyebrow } from "./StepEyebrow";

function energyLabel(level: ReviewBlock["energyLevel"]): string | null {
    return level ? level.charAt(0) + level.slice(1).toLowerCase() + " energy" : null;
}

function capacityLabel(remainingMins: number): string {
    return remainingMins >= 0 ? `${formatDuration(remainingMins)} left` : `over by ${formatDuration(-remainingMins)}`;
}

function moveFitLabel(remainingAfterMoveMins: number): string {
    if (remainingAfterMoveMins === 0) return "Fits exactly";
    return remainingAfterMoveMins > 0
        ? `Fits · ${formatDuration(remainingAfterMoveMins)} left`
        : `Over by ${formatDuration(-remainingAfterMoveMins)}`;
}

function moveActionsFor(board: ReviewBoard, taskId: string, from: Zone) {
    return eligibleTargets(board, taskId, from).map((t) => ({
        name: zoneToActionName(targetZone(t)),
        label: t.kind === "block" ? `Move to ${t.name}` : "Move to Not scheduled",
    }));
}

type Moving = { taskId: string; fromZone: Zone; title: string; mins: number };

// ─── Screen ───────────────────────────────────────────────────────────────────

export function ReviewPlan({ onboarding = false }: { onboarding?: boolean }) {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const isOnboarding = onboarding;
    const proposal = usePlanningStore(s => s.proposal);
    const templateId = usePlanningStore(s => s.templateId);
    const clearProposal = usePlanningStore(s => s.clear);

    // The board — the task placement the user edits — is derived once from the
    // store-held proposal; edits stay local until confirm. The proposal itself owns the
    // day's structure (blocks, times, elapsed/event state), so the timeline reads from it.
    const [board, setBoard] = useState<ReviewBoard | null>(() => (proposal ? boardFromProposal(proposal) : null));

    // The review is a short-lived snapshot of the day, so `now` is fixed at mount —
    // the now-line and elapsed greying shouldn't shift under the user mid-review.
    const now = useMemo(() => toHHmm(new Date()), []);
    const timeline = useMemo(() => (proposal ? buildReviewTimeline(proposal, now) : []), [proposal, now]);

    const [moving, setMoving] = useState<Moving | null>(null);
    const openMove = useCallback((taskId: string, fromZone: Zone, title: string, mins: number) => {
        setMoving({ taskId, fromZone, title, mins });
    }, []);
    const handleMove = useCallback((taskId: string, fromZone: Zone, toZone: Zone) => {
        setBoard(prev => (prev ? moveTask(prev, taskId, fromZone, toZone) : prev));
        Haptics.selectionAsync();
        setMoving(null);
    }, []);

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

    // Persist the plan: send the board's placements to the confirm endpoint, which
    // creates the ACTIVE plan in one transaction. On success, tear down — Today reloads
    // on focus and shows the new plan. On failure, offer a retry (the board is untouched).
    const handleConfirm = useCallback(async () => {
        if (!board || !proposal || !templateId || confirming) return;
        setConfirming(true);
        const res = await api.confirmPlan({ templateId, plan: planFromProposalAndBoard(proposal, board) });
        if (res.ok) {
            // Stamp completion server-side before tearing down, so any future
            // sign-in (this device or another) resolves straight to Today.
            if (isOnboarding) {
                const done = await api.completeOnboarding();
                if (done.ok) useSessionStore.getState().setOnboardedAt(done.data.onboardedAt);
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
    }, [board, confirming, dismissFlow, isOnboarding, proposal, templateId]);

    if (!board || !proposal) {
        return (
            <SafeAreaView style={s.container} edges={['top']}>
                <Header onClose={handleClose} onboarding={isOnboarding} />
                <View style={s.centered}>
                    <Text style={s.muted}>No generated plan to show. Start a planning session again.</Text>
                </View>
            </SafeAreaView>
        );
    }

    const blockById = new Map(board.blocks.map(b => [b.id, b]));

    const elements: ReactNode[] = [];
    timeline.forEach((item, i) => {
        if (i > 0) elements.push(<TimelineThread key={`thread-${i}`} />);

        if (item.kind === 'boundary') {
            elements.push(<DayBoundaryMarker key={`item-${i}`} label={item.label} time={item.time} />);
        } else if (item.kind === 'now') {
            elements.push(<NowLine key={`item-${i}`} time={now} />);
        } else if (item.kind === 'gap') {
            elements.push(<FreeSlot key={`item-${i}`} start={item.start} end={item.end} elapsed={item.elapsed} />);
        } else if (item.block.type === 'ANCHOR') {
            elements.push(<AnchorCard key={`item-${i}`} block={item.block} elapsed={item.elapsed} />);
        } else if (item.elapsed) {
            // Elapsed container: a greyed, read-only shell with no tasks.
            elements.push(<ElapsedContainerCard key={`item-${i}`} block={item.block} />);
        } else {
            // Upcoming container: tasks come from the (editable) board, not the proposal.
            const live = blockById.get(item.block.blockId);
            elements.push(
                <ContainerCard
                    key={`item-${i}`}
                    block={live ?? emptyBlockFrom(item.block)}
                    board={board}
                    onOpenMove={openMove}
                    onMove={handleMove}
                />,
            );
        }
    });

    return (
        <SafeAreaView style={s.container} edges={['top']}>
            <Header onClose={handleClose} onboarding={isOnboarding} />

            <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
                <View>{elements}</View>

                <View style={s.unscheduledSection}>
                    <Text style={s.sectionLabel}>NOT SCHEDULED</Text>
                    {board.unscheduled.length === 0 ? (
                        <Text style={s.emptyHint}>Everything found a place in your day.</Text>
                    ) : (
                        <View style={s.taskList}>
                            {board.unscheduled.map(task => (
                                <UnscheduledRow
                                    key={task.id}
                                    task={task}
                                    board={board}
                                    onOpenMove={openMove}
                                    onMove={handleMove}
                                />
                            ))}
                        </View>
                    )}
                </View>
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
                <TouchableOpacity
                    style={s.footerBack}
                    onPress={() => router.back()}
                    disabled={confirming}
                    activeOpacity={0.8}
                >
                    <Text style={s.footerBackLabel}>Back</Text>
                </TouchableOpacity>
            </View>

            <MoveSheet board={board} moving={moving} onMove={handleMove} onClose={() => setMoving(null)} />
        </SafeAreaView>
    );
}

// A board block the timeline expected but the board doesn't hold (defensive only) —
// an empty upcoming container so the card still renders "No tasks yet".
function emptyBlockFrom(block: ProposalBlock): ReviewBlock {
    return { id: block.blockId, name: block.name, startTime: block.startTime, endTime: block.endTime, energyLevel: block.energyLevel, tasks: [] };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Header({ onClose, onboarding }: { onClose: () => void; onboarding?: boolean }) {
    if (onboarding) {
        return (
            <View style={s.onboardingHeader}>
                <StepEyebrow step={3} total={3} />
                <Text style={s.onboardingTitle}>Here's your day</Text>
                <Text style={s.onboardingSubtitle}>Tap a task to move it, then confirm.</Text>
            </View>
        );
    }
    return (
        <View style={s.header}>
            <StepEyebrow step={3} total={3} />
            <View style={s.headerRow}>
                <Text style={s.headerTitle}>Review your plan</Text>
                <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} activeOpacity={0.6}>
                    <Ionicons name="close" size={22} color="#2a2621" />
                </TouchableOpacity>
            </View>
            <Text style={s.headerSubtitle}>Tap a task to move it, then confirm.</Text>
        </View>
    );
}

function NowLine({ time }: { time: string }) {
    return (
        <View style={s.nowRow}>
            <View style={s.nowDot} />
            <View style={s.nowRule} />
            <Text style={s.nowLabel}>Now · {formatTime(time)}</Text>
        </View>
    );
}

function FreeSlot({ start, end, elapsed }: { start: string; end: string; elapsed: boolean }) {
    return (
        <View style={[s.freeSlotRow, elapsed && s.elapsed]}>
            <View style={s.freeSlotThread} />
            <View style={s.freeSlotPill}>
                {!elapsed && <Ionicons name="cafe-outline" size={11} color="rgba(122,115,106,0.7)" />}
                <Text style={s.freeSlotText}>
                    {formatDuration(Math.max(0, toMins(end) - toMins(start)))}
                    {!elapsed && ' free'}
                </Text>
            </View>
        </View>
    );
}

// Read-only Event card — a fixed routine, never a task target.
function AnchorCard({ block, elapsed }: { block: ProposalBlock; elapsed: boolean }) {
    return (
        <View style={[s.anchorCard, elapsed && s.elapsed]}>
            <Text style={s.anchorName}>{block.name}</Text>
            <Text style={s.anchorTime}>{formatTimeRange(block.startTime, block.endTime)}</Text>
        </View>
    );
}

// Elapsed container: a greyed shell with no tasks, so the day reads as a continuous whole
// without inviting edits to a window that's already closed.
function ElapsedContainerCard({ block }: { block: ProposalBlock }) {
    return (
        <View style={[s.containerCard, s.elapsed]}>
            <View style={s.containerHeader}>
                <View style={s.containerHeaderLeft}>
                    <Text style={s.blockName}>{block.name}</Text>
                    <Text style={s.blockTime}>{formatTimeRange(block.startTime, block.endTime)}</Text>
                </View>
            </View>
        </View>
    );
}

type RowMoveProps = {
    board: ReviewBoard;
    onOpenMove: (taskId: string, fromZone: Zone, title: string, mins: number) => void;
    onMove: (taskId: string, fromZone: Zone, toZone: Zone) => void;
};

function ContainerCard({
    block,
    board,
    onOpenMove,
    onMove,
}: { block: ReviewBlock } & RowMoveProps) {
    const remaining = blockRemainingMins(block);
    const label = energyLabel(block.energyLevel);
    return (
        <View style={s.containerCard}>
            <View style={s.containerHeader}>
                <View style={s.containerHeaderLeft}>
                    <Text style={s.blockName}>{block.name}</Text>
                    <Text style={s.blockTime}>
                        {formatTimeRange(block.startTime, block.endTime)}
                        {'  ·  '}
                        <Text style={remaining < 0 ? s.capacityOver : s.capacityLeft}>{capacityLabel(remaining)}</Text>
                    </Text>
                </View>
                {label && (
                    <View style={s.energyBadge}><Text style={s.energyBadgeText}>{label}</Text></View>
                )}
            </View>
            {block.tasks.length === 0 ? (
                <View style={s.noTasksRow}>
                    <View style={s.noTasksDot} />
                    <Text style={s.noTasksText}>No tasks yet</Text>
                </View>
            ) : (
                <View style={s.taskList}>
                    {block.tasks.map(task => (
                        <ScheduledRow
                            key={task.id}
                            task={task}
                            fromZone={blockZone(block.id)}
                            board={board}
                            onOpenMove={onOpenMove}
                            onMove={onMove}
                        />
                    ))}
                </View>
            )}
        </View>
    );
}

function ScheduledRow({
    task,
    fromZone,
    board,
    onOpenMove,
    onMove,
}: { task: ReviewTask; fromZone: Zone } & RowMoveProps) {
    const actions = useMemo(() => moveActionsFor(board, task.id, fromZone), [board, task.id, fromZone]);
    return (
        <TouchableOpacity
            style={s.taskCard}
            activeOpacity={0.7}
            onPress={() => onOpenMove(task.id, fromZone, task.title, task.remainingMins)}
            accessibilityRole="button"
            accessibilityLabel={`${task.title}, ${formatDuration(task.remainingMins)}`}
            accessibilityHint="Opens options to move this task"
            accessibilityActions={actions}
            onAccessibilityAction={(e: AccessibilityActionEvent) =>
                onMove(task.id, fromZone, zoneFromActionName(e.nativeEvent.actionName))
            }
        >
            <View style={s.taskContent}>
                <Text style={s.taskTitle} numberOfLines={2}>{task.title}</Text>
            </View>
            <Text style={s.taskMins}>{formatDuration(task.remainingMins)}</Text>
            <MoveHint />
        </TouchableOpacity>
    );
}

function UnscheduledRow({ task, board, onOpenMove, onMove }: { task: UnscheduledTask } & RowMoveProps) {
    const actions = useMemo(() => moveActionsFor(board, task.id, UNSCHEDULED), [board, task.id]);
    return (
        <TouchableOpacity
            style={s.taskCard}
            activeOpacity={0.7}
            onPress={() => onOpenMove(task.id, UNSCHEDULED, task.title, task.remainingMins)}
            accessibilityRole="button"
            accessibilityLabel={`${task.title}, ${formatDuration(task.remainingMins)}, not scheduled`}
            accessibilityHint="Opens options to schedule this task"
            accessibilityActions={actions}
            onAccessibilityAction={(e: AccessibilityActionEvent) =>
                onMove(task.id, UNSCHEDULED, zoneFromActionName(e.nativeEvent.actionName))
            }
        >
            <View style={s.taskContent}>
                <Text style={s.taskTitle} numberOfLines={2}>{task.title}</Text>
                {task.reason ? <Text style={s.taskReason} numberOfLines={2}>{task.reason}</Text> : null}
            </View>
            <Text style={s.taskMins}>{formatDuration(task.remainingMins)}</Text>
            <MoveHint />
        </TouchableOpacity>
    );
}

// Decorative: the whole row is the button and carries the move hint and actions, so the
// icon is hidden from the screen reader.
function MoveHint() {
    return (
        <View style={s.moveHint} accessible={false} importantForAccessibility="no-hide-descendants">
            <Ionicons name="swap-vertical" size={14} color={colors.text.secondary} />
        </View>
    );
}

// ─── Move-to sheet ──────────────────────────────────────────────────────────

function MoveSheet({
    board,
    moving,
    onMove,
    onClose,
}: {
    board: ReviewBoard;
    moving: Moving | null;
    onMove: (taskId: string, fromZone: Zone, toZone: Zone) => void;
    onClose: () => void;
}) {
    const insets = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();
    const sheetRef = useRef<BottomSheetModal>(null);

    // `moving` clears the moment a choice is made, but the sheet is still animating out —
    // keep rendering the last task so the content doesn't blank mid-dismiss.
    const [shown, setShown] = useState(moving);
    if (moving && moving !== shown) setShown(moving);

    // Only dismiss a sheet that's still open: dismissing one that never opened, or already
    // closed itself, leaves @gorhom/bottom-sheet stuck DISMISSING and blocks every later present.
    const presented = useRef(false);
    useEffect(() => {
        if (moving) {
            presented.current = true;
            sheetRef.current?.present();
        } else if (presented.current) {
            presented.current = false;
            sheetRef.current?.dismiss();
        }
    }, [moving]);

    const renderBackdrop = useCallback(
        (props: BottomSheetBackdropProps) => (
            <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.3} pressBehavior="close" />
        ),
        [],
    );

    const targets = shown ? eligibleTargets(board, shown.taskId, shown.fromZone) : [];
    // The current location is marked here rather than offered as a target — `eligibleTargets`
    // already excludes it, so moving a task onto itself can't happen.
    const from = shown?.fromZone;
    const currentName = !from
        ? ""
        : from.kind === "unscheduled"
            ? "Not scheduled"
            : board.blocks.find(b => b.id === from.blockId)?.name ?? "Not scheduled";

    return (
        <BottomSheetModal
            ref={sheetRef}
            enableDynamicSizing
            maxDynamicContentSize={windowHeight * 0.8}
            enablePanDownToClose
            backdropComponent={renderBackdrop}
            backgroundStyle={s.sheet}
            handleIndicatorStyle={s.sheetHandle}
            onDismiss={() => {
                presented.current = false;
                onClose();
            }}
        >
            <BottomSheetScrollView
                contentContainerStyle={[s.sheetBody, { paddingBottom: Math.max(insets.bottom, 24) }]}
                showsVerticalScrollIndicator={false}
            >
                <View style={s.sheetHeader}>
                    <Text style={s.sheetTitle} numberOfLines={1} accessibilityRole="header">
                        Move “{shown?.title}”
                    </Text>
                    <TouchableOpacity
                        onPress={onClose}
                        hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}
                        activeOpacity={0.6}
                        accessibilityRole="button"
                        accessibilityLabel="Close move options"
                    >
                        <Ionicons name="close" size={20} color={colors.text.primary} />
                    </TouchableOpacity>
                </View>
                <Text style={s.sheetCurrent}>{shown ? formatDuration(shown.mins) : ""}  ·  Currently in {currentName}</Text>
                <View style={s.sheetContent}>
                    {targets.length === 0 ? (
                        <Text style={s.emptyHint}>No other place to move this task.</Text>
                    ) : (
                        targets.map(target => (
                            <MoveTargetRow
                                key={target.kind === "block" ? target.id : "unscheduled"}
                                target={target}
                                onPress={() => shown && onMove(shown.taskId, shown.fromZone, targetZone(target))}
                            />
                        ))
                    )}
                </View>
            </BottomSheetScrollView>
        </BottomSheetModal>
    );
}

function MoveTargetRow({ target, onPress }: { target: MoveTarget; onPress: () => void }) {
    if (target.kind === "unscheduled") {
        return (
            <TouchableOpacity
                style={[s.targetRow, s.targetRowUnscheduled]}
                onPress={onPress}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Move to Not scheduled"
            >
                <View style={s.targetIcon}>
                    <Ionicons name="file-tray-outline" size={16} color={colors.text.secondary} />
                </View>
                <View style={s.targetMain}>
                    <Text style={s.targetName}>Not scheduled</Text>
                    <Text style={s.targetMeta}>Set aside for later</Text>
                </View>
            </TouchableOpacity>
        );
    }
    const over = target.remainingAfterMoveMins < 0;
    return (
        <TouchableOpacity
            style={s.targetRow}
            onPress={onPress}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Move to ${target.name}, ${formatTimeRange(target.startTime, target.endTime)}, ${moveFitLabel(target.remainingAfterMoveMins)}`}
        >
            <View style={s.targetMain}>
                <Text style={s.targetName}>{target.name}</Text>
                <Text style={s.targetMeta}>
                    {formatTimeRange(target.startTime, target.endTime)}
                    {'  ·  '}
                    <Text style={over ? s.capacityOver : s.capacityLeft}>{moveFitLabel(target.remainingAfterMoveMins)}</Text>
                </Text>
            </View>
        </TouchableOpacity>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fdfcfa' },
    header: {
        paddingHorizontal: 20,
        paddingTop: 24,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(42,38,33,0.06)',
    },
    onboardingHeader: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.md },
    onboardingTitle: { ...typography.title, color: colors.text.primary, letterSpacing: 0.07, marginTop: 4 },
    onboardingSubtitle: { fontSize: 15, color: colors.text.secondary, lineHeight: 22, letterSpacing: -0.2, marginTop: spacing.sm },
    headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    headerTitle: { fontSize: 16, fontWeight: '600', color: '#2a2621', letterSpacing: -0.3 },
    headerSubtitle: { fontSize: 13, color: '#7a736a', lineHeight: 18, marginTop: 6, maxWidth: 320 },
    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    muted: { fontSize: 13, color: '#7a736a', textAlign: 'center', lineHeight: 18 },

    scrollContent: { padding: 16, paddingBottom: 24 },

    // Elapsed greying, shared by past blocks, events, and gaps.
    elapsed: { opacity: 0.45 },

    // Now-line
    nowRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
    nowDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#d4a574', marginLeft: 7 },
    nowRule: { height: 1, flex: 1, backgroundColor: 'rgba(212,165,116,0.5)' },
    nowLabel: { fontSize: 11, fontWeight: '600', color: '#b07841', letterSpacing: 0.3, fontVariant: ['tabular-nums'] },

    // Free-slot gap (mirrors Today)
    freeSlotRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    freeSlotThread: { position: 'absolute', left: 10, top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(42,38,33,0.12)' },
    freeSlotPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, marginHorizontal: 8 },
    freeSlotText: { fontSize: 10, color: 'rgba(122,115,106,0.8)', fontVariant: ['tabular-nums'] },

    // Event (anchor) card
    anchorCard: { backgroundColor: colors.surface.block, borderRadius: 16, padding: 16 },
    anchorName: { fontSize: 15, fontWeight: '500', color: '#2a2621', letterSpacing: -0.23 },
    anchorTime: { fontSize: 13, color: '#9a9389', letterSpacing: -0.15, marginTop: 3, fontVariant: ['tabular-nums'] },

    // Container card (mirrors Today's dashed block)
    containerCard: {
        borderWidth: 1.5,
        borderColor: 'rgba(42,38,33,0.16)',
        borderStyle: 'dashed',
        borderRadius: 16,
        padding: 16,
    },
    containerHeader: { flexDirection: 'row', alignItems: 'flex-start' },
    containerHeaderLeft: { flex: 1, marginRight: 8 },
    blockName: { fontSize: 15, fontWeight: '500', color: '#2a2621', letterSpacing: -0.23 },
    blockTime: { fontSize: 13, color: '#9a9389', letterSpacing: -0.15, marginTop: 3, fontVariant: ['tabular-nums'] },
    capacityLeft: { color: colors.success.strong },
    capacityOver: { color: colors.warning.strong },
    energyBadge: {
        backgroundColor: 'rgba(232,223,209,0.4)',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
        alignSelf: 'flex-start',
    },
    energyBadgeText: { fontSize: 12, color: 'rgba(122,115,106,0.7)' },

    noTasksRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: 'rgba(232,228,221,0.1)',
        borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.04)',
        borderStyle: 'dashed',
        borderRadius: 10,
        paddingHorizontal: 17,
        paddingVertical: 13,
        minHeight: 46,
        marginTop: 12,
    },
    noTasksDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(42,38,33,0.04)' },
    noTasksText: { fontSize: 14, color: 'rgba(122,115,106,0.4)', letterSpacing: -0.15 },

    taskList: { gap: 6, marginTop: 12 },
    taskCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.04)',
        borderRadius: 12,
        paddingHorizontal: 13,
        paddingVertical: 9,
        minHeight: 38,
    },
    taskContent: { flex: 1, gap: 3 },
    taskTitle: { fontSize: 14, color: '#2a2621', letterSpacing: -0.15 },
    taskReason: { fontSize: 12, color: '#9a8d6f' },
    taskMins: { fontSize: 13, color: '#7a736a', fontVariant: ['tabular-nums'] },
    moveHint: {
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
    },

    // Not-scheduled section
    unscheduledSection: { marginTop: 24, gap: 10 },
    sectionLabel: { fontSize: 11, color: 'rgba(122,115,106,0.55)', letterSpacing: 0.5, textTransform: 'uppercase' },
    emptyHint: { fontSize: 13, color: 'rgba(122,115,106,0.5)', fontStyle: 'italic' },

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

    // Move-to sheet
    sheet: { backgroundColor: colors.surface.page, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl },
    sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border.strong },
    sheetBody: { paddingHorizontal: 20 },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6 },
    sheetTitle: { flex: 1, marginRight: 12, fontSize: 17, fontWeight: '600', color: colors.text.primary, letterSpacing: -0.3 },
    sheetCurrent: { fontSize: 13, color: colors.text.secondary, marginTop: 4, marginBottom: 12 },
    sheetContent: { gap: 6 },
    targetRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: colors.surface.raised,
        borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.06)',
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 13,
    },
    // "Not scheduled" isn't a place in the day, so it's set apart from the block targets.
    targetRowUnscheduled: {
        marginTop: 10,
        backgroundColor: colors.surface.sunken,
        borderColor: 'transparent',
    },
    targetIcon: {
        width: 32,
        height: 32,
        borderRadius: radius.pill,
        backgroundColor: colors.surface.raised,
        alignItems: 'center',
        justifyContent: 'center',
    },
    targetMain: { flex: 1, gap: 3 },
    targetName: { fontSize: 15, fontWeight: '500', color: colors.text.primary, letterSpacing: -0.2 },
    targetMeta: { fontSize: 13, color: colors.text.secondary, letterSpacing: -0.15, fontVariant: ['tabular-nums'] },
});
