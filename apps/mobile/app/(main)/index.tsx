import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    ActivityIndicator,
} from "react-native";
import Animated, { FadeInDown, useSharedValue, useAnimatedStyle, withSpring } from "react-native-reanimated";
import CreateTaskModal from "../../components/CreateTaskModal";
import { PressableScale } from "../../components/PressableScale";
import { Wordmark } from "../../components/Wordmark";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Stop, Rect } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { api } from "../../lib/api";
import { DayPlan, DayTemplate, DayTemplateBlock, PlannedBlock, PlannedTask, TaskStatus } from "../../lib/api.types";
import { toMins, toHHmm, formatTime, formatTimeRange, formatDuration } from "../../lib/time";
import { TimelineThread as ThreadSegment, DayBoundaryMarker } from "../../components/timeline";
import { colors } from "../../lib/theme";

function formatEstimatedMins(mins: number): string {
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// ─── Screen state ─────────────────────────────────────────────────────────────

type ScreenState =
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'empty'; template: DayTemplate | null }
    | { status: 'loaded'; plan: DayPlan };

function FreeSlotIndicator({ startTime, endTime, elapsed }: { startTime: string; endTime: string; elapsed?: boolean }) {
    return (
        <View style={[styles.freeSlotRow, elapsed && styles.elapsedOpacity]}>
            <View style={styles.freeSlotThread} />
            <View style={styles.freeSlotPill}>
                <Ionicons name="chevron-expand-outline" size={11} color="rgba(122,115,106,0.7)" />
                <Text style={styles.freeSlotText}>{formatDuration(toMins(endTime) - toMins(startTime))} available</Text>
            </View>
        </View>
    );
}

// ─── Empty state components ───────────────────────────────────────────────────

function GhostAnchorBlock({ block }: { block: DayTemplateBlock }) {
    return (
        <View style={styles.ghostAnchorCard}>
            <Text style={styles.ghostAnchorName}>{block.name}</Text>
            <Text style={styles.ghostAnchorTime}>{formatTime(block.startTime)} – {formatTime(block.endTime)}</Text>
        </View>
    );
}

function GhostContainerBlock({ block }: { block: DayTemplateBlock }) {
    const energyLabel = block.energyLevel
        ? block.energyLevel.charAt(0) + block.energyLevel.slice(1).toLowerCase() + ' energy'
        : null;

    return (
        <View style={styles.ghostContainerCard}>
            <View style={styles.ghostContainerHeader}>
                <View style={styles.ghostContainerHeaderLeft}>
                    <Text style={styles.ghostContainerName}>{block.name}</Text>
                    <Text style={styles.ghostContainerTime}>{formatTime(block.startTime)} – {formatTime(block.endTime)}</Text>
                </View>
                {energyLabel && (
                    <View style={styles.energyBadge}>
                        <Text style={styles.energyBadgeText}>{energyLabel}</Text>
                    </View>
                )}
            </View>
            <View style={styles.noTasksRow}>
                <View style={styles.noTasksDot} />
                <Text style={styles.noTasksText}>No tasks yet</Text>
            </View>
        </View>
    );
}

type TemplateListItem =
    | { kind: 'block'; block: DayTemplateBlock }
    | { kind: 'gap'; start: string; end: string }
    | { kind: 'boundary'; label: 'Wake' | 'Sleep'; time: string };

function EmptyState({ template, entrance }: { template: DayTemplate | null; entrance: boolean }) {
    const listItems: TemplateListItem[] = [];

    if (template) {
        const sortedBlocks = [...template.blocks].sort(
            (a, b) => toMins(a.startTime) - toMins(b.startTime)
        );

        listItems.push({ kind: 'boundary', label: 'Wake', time: template.wakeTime });

        if (sortedBlocks.length > 0 && toMins(sortedBlocks[0].startTime) > toMins(template.wakeTime)) {
            listItems.push({ kind: 'gap', start: template.wakeTime, end: sortedBlocks[0].startTime });
        }

        sortedBlocks.forEach((block, i) => {
            listItems.push({ kind: 'block', block });
            const next = sortedBlocks[i + 1];
            if (next && toMins(block.endTime) < toMins(next.startTime)) {
                listItems.push({ kind: 'gap', start: block.endTime, end: next.startTime });
            }
        });

        const lastBlock = sortedBlocks[sortedBlocks.length - 1];
        if (lastBlock && toMins(lastBlock.endTime) < toMins(template.sleepTime)) {
            listItems.push({ kind: 'gap', start: lastBlock.endTime, end: template.sleepTime });
        }

        listItems.push({ kind: 'boundary', label: 'Sleep', time: template.sleepTime });
    }

    const timelineElements: ReactNode[] = [];
    let stagger = 1;
    listItems.forEach((item, i) => {
        if (i > 0) {
            timelineElements.push(<ThreadSegment key={`t-${i}`} />);
        }
        let content: ReactNode;
        if (item.kind === 'block') {
            content = item.block.type === 'CONTAINER'
                ? <GhostContainerBlock block={item.block} />
                : <GhostAnchorBlock block={item.block} />;
        } else if (item.kind === 'gap') {
            content = <FreeSlotIndicator startTime={item.start} endTime={item.end} />;
        } else {
            content = <DayBoundaryMarker label={item.label} time={item.time} />;
        }
        timelineElements.push(
            <Animated.View key={`i-${i}`} entering={staggeredEntering(entrance, stagger++)}>
                {content}
            </Animated.View>
        );
    });

    const hasTemplate = listItems.length > 0;

    return (
        <>
            <Animated.View style={styles.emptyHero} entering={staggeredEntering(entrance, 0)}>
                <MaterialCommunityIcons name="script-outline" size={44} color="rgba(42,38,33,0.22)" style={styles.emptyHeroGlyph} />
                <Text style={styles.emptyHeroTitle}>Your day is a blank page</Text>
                <Text style={styles.emptyHeroSubtitle}>
                    {hasTemplate
                        ? 'Plan it, and your tasks will settle into each block below.'
                        : 'Plan your day and your blocks and tasks will appear here — a clear path from wake to wind-down.'}
                </Text>
            </Animated.View>

            {hasTemplate && (
                <View style={styles.templateTimeline}>
                    {timelineElements}
                </View>
            )}
        </>
    );
}

// ─── Populated timeline components ───────────────────────────────────────────

function BlockProgressFill({ progress, gradientId }: { progress: number; gradientId: string }) {
    const [width, setWidth] = useState(0);
    const clamped = Math.max(0, Math.min(1, progress));
    // Feather over a fixed 16px span so the fade looks the same on short and long blocks.
    const featherFrac = width > 0 ? Math.min(clamped, 16 / width) : Math.min(clamped, 0.04);

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
            <Svg width="100%" height="100%">
                <Defs>
                    <SvgLinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
                        <Stop offset={0} stopColor="#d4a574" stopOpacity={0.2} />
                        <Stop offset={clamped - featherFrac} stopColor="#d4a574" stopOpacity={0.2} />
                        <Stop offset={clamped} stopColor="#d4a574" stopOpacity={0} />
                        <Stop offset={1} stopColor="#d4a574" stopOpacity={0} />
                    </SvgLinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
            </Svg>
        </View>
    );
}

// The header's most important action, so it gets gradient depth the flat accent
// chips elsewhere don't.
function PlanButtonGradient() {
    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <Svg width="100%" height="100%">
                <Defs>
                    <SvgLinearGradient id="planButtonFill" x1="0" y1="0" x2="1" y2="1">
                        <Stop offset={0} stopColor="#e3bd8c" />
                        <Stop offset={1} stopColor="#bd8447" />
                    </SvgLinearGradient>
                </Defs>
                <Rect x="0" y="0" width="100%" height="100%" fill="url(#planButtonFill)" />
            </Svg>
        </View>
    );
}

function BlockTimeMeta({ block, isActive, progress }: { block: PlannedBlock; isActive: boolean; progress: number }) {
    const totalMins = toMins(block.endTime) - toMins(block.startTime);
    const remainingMins = Math.round(totalMins * (1 - progress));
    return (
        <Text style={styles.blockTime}>
            {formatTimeRange(block.startTime, block.endTime)}  ·  {isActive
                ? <Text style={styles.blockTimeRemaining}>{formatDuration(remainingMins)} left</Text>
                : formatDuration(totalMins)}
        </Text>
    );
}

function AnchorBlockCard({ block, elapsed, active, progress }: { block: PlannedBlock; elapsed: boolean; active: boolean; progress: number }) {
    return (
        <View style={[styles.anchorCard, elapsed && styles.elapsedOpacity, active && styles.blockCardActive]}>
            {active && <BlockProgressFill progress={progress} gradientId={`blockProgressFill-${block.id}`} />}
            <Text style={[styles.blockName, active && styles.blockNameActive]}>{block.name}</Text>
            <BlockTimeMeta block={block} isActive={active} progress={progress} />
        </View>
    );
}

const CHECK_SPRING = { duration: 300, dampingRatio: 1 };

function TaskDoneToggle({ task, onDone }: { task: PlannedTask; onDone: () => void }) {
    const [completing, setCompleting] = useState(false);
    const fill = useSharedValue(task.status === 'DONE' ? 1 : 0);

    const filledStyle = useAnimatedStyle(() => ({
        opacity: fill.value,
        transform: [{ scale: 0.25 + fill.value * 0.75 }],
    }));
    const outlineStyle = useAnimatedStyle(() => ({ opacity: 1 - fill.value }));

    // Follow the prop so status changes from elsewhere (a reload, a status flip on
    // a persisted instance) re-drive the fill — press is not the only source of truth.
    useEffect(() => {
        fill.value = withSpring(task.status === 'DONE' ? 1 : 0, CHECK_SPRING);
    }, [task.status]);

    async function handlePress() {
        if (completing || task.status === 'DONE') return;
        setCompleting(true);
        fill.value = withSpring(1, CHECK_SPRING);
        const result = await api.updateTask(task.id, { progress: 100 });
        if (result.ok) {
            setCompleting(false);
            onDone();
        } else {
            setCompleting(false);
            fill.value = withSpring(0, CHECK_SPRING);
        }
    }

    return (
        <Pressable onPress={handlePress} hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }}>
            <View style={styles.toggleIcon}>
                <Animated.View style={[StyleSheet.absoluteFill, outlineStyle]}>
                    <Ionicons name="checkmark-circle-outline" size={18} color="rgba(122,115,106,0.3)" />
                </Animated.View>
                <Animated.View style={filledStyle}>
                    <Ionicons name="checkmark-circle" size={18} color="#5c5248" />
                </Animated.View>
            </View>
        </Pressable>
    );
}

function ContainerBlockCard({ block, elapsed, active, progress, onTaskDone, onTaskPress }: { block: PlannedBlock; elapsed: boolean; active: boolean; progress: number; onTaskDone: (taskId: string) => void; onTaskPress: (taskId: string) => void }) {
    const energyLabel = block.energyLevel
        ? block.energyLevel.charAt(0) + block.energyLevel.slice(1).toLowerCase() + ' energy'
        : null;

    return (
        <View style={[styles.containerCard, elapsed && styles.elapsedOpacity, active && styles.blockCardActive]}>
            {active && <BlockProgressFill progress={progress} gradientId={`blockProgressFill-${block.id}`} />}
            <View style={styles.containerCardHeader}>
                <View style={styles.containerCardHeaderLeft}>
                    <Text style={[styles.blockName, active && styles.blockNameActive]}>{block.name}</Text>
                    <BlockTimeMeta block={block} isActive={active} progress={progress} />
                </View>
                {energyLabel && (
                    <View style={styles.energyBadge}>
                        <Text style={styles.energyBadgeText}>{energyLabel}</Text>
                    </View>
                )}
            </View>
            {block.tasks.length > 0 && (
                <View style={styles.taskList}>
                    {block.tasks.map(task => (
                        <PressableScale key={task.id} style={styles.taskCard} onPress={() => onTaskPress(task.id)}>
                            <TaskDoneToggle task={task} onDone={() => onTaskDone(task.id)} />
                            <Text style={styles.taskTitle} numberOfLines={2}>{task.title}</Text>
                            <Text style={styles.taskEstimate}>{formatEstimatedMins(task.remainingMins)}</Text>
                        </PressableScale>
                    ))}
                </View>
            )}
        </View>
    );
}

type TimelineItem =
    | { kind: 'block'; block: PlannedBlock; elapsed: boolean; active: boolean; progress: number }
    | { kind: 'gap'; start: string; end: string; elapsed: boolean }
    | { kind: 'boundary'; label: 'Wake' | 'Sleep'; time: string }
    | { kind: 'current-time'; time: string };

function buildTimelineItems(plan: DayPlan, currentTime: string): TimelineItem[] {
    const items: TimelineItem[] = [];
    const nowMins = toMins(currentTime);
    const wakeMins = toMins(plan.wakeTime);
    const sleepMins = toMins(plan.sleepTime);

    const sorted = [...plan.blocks].sort((a, b) => toMins(a.startTime) - toMins(b.startTime));

    items.push({ kind: 'boundary', label: 'Wake', time: plan.wakeTime });

    let prev = plan.wakeTime;
    for (const block of sorted) {
        if (toMins(block.startTime) > toMins(prev)) {
            items.push({
                kind: 'gap',
                start: prev,
                end: block.startTime,
                elapsed: nowMins >= toMins(block.startTime),
            });
        }
        const startMins = toMins(block.startTime);
        const endMins = toMins(block.endTime);
        const active = nowMins >= startMins && nowMins < endMins;
        items.push({
            kind: 'block',
            block,
            elapsed: nowMins >= endMins,
            active,
            progress: active && endMins > startMins ? (nowMins - startMins) / (endMins - startMins) : 0,
        });
        prev = block.endTime;
    }

    if (toMins(prev) < sleepMins) {
        items.push({
            kind: 'gap',
            start: prev,
            end: plan.sleepTime,
            elapsed: nowMins >= sleepMins,
        });
    }

    items.push({ kind: 'boundary', label: 'Sleep', time: plan.sleepTime });

    // Insert current-time indicator between the last elapsed item and the first
    // non-elapsed one. Default to after wake boundary (index 0) so the indicator
    // still appears when nothing has elapsed yet.
    if (nowMins >= wakeMins && nowMins < sleepMins) {
        let insertAfter = 0;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if ((item.kind === 'block' || item.kind === 'gap') && item.elapsed) {
                insertAfter = i;
            }
        }
        items.splice(insertAfter + 1, 0, { kind: 'current-time', time: currentTime });
    }

    return items;
}

// Cap the stagger so a long day doesn't trickle in item-by-item.
function staggeredEntering(entrance: boolean, index: number) {
    if (!entrance) return undefined;
    return FadeInDown.duration(340).delay(Math.min(index, 8) * 45);
}

function Timeline({
    plan,
    currentTime,
    entrance,
    onNowLayout,
    onTaskDone,
    onTaskPress,
}: {
    plan: DayPlan;
    currentTime: string;
    entrance: boolean;
    onNowLayout: (y: number) => void;
    onTaskDone: (taskId: string) => void;
    onTaskPress: (taskId: string) => void;
}) {
    const items = buildTimelineItems(plan, currentTime);

    const elements: ReactNode[] = [];
    let stagger = 0;
    items.forEach((item, i) => {
        // Skip the thread after the invisible zero-height now-anchor to avoid a double gap.
        if (i > 0 && items[i - 1].kind !== 'current-time') {
            elements.push(<ThreadSegment key={`sep-${i}`} />);
        }

        if (item.kind === 'current-time') {
            elements.push(<View key={`item-${i}`} onLayout={(e) => onNowLayout(e.nativeEvent.layout.y)} />);
            return;
        }

        let content: ReactNode;
        if (item.kind === 'boundary') {
            content = <DayBoundaryMarker label={item.label} time={item.time} />;
        } else if (item.kind === 'gap') {
            content = <FreeSlotIndicator startTime={item.start} endTime={item.end} elapsed={item.elapsed} />;
        } else if (item.block.type === 'CONTAINER') {
            content = <ContainerBlockCard block={item.block} elapsed={item.elapsed} active={item.active} progress={item.progress} onTaskDone={onTaskDone} onTaskPress={onTaskPress} />;
        } else {
            content = <AnchorBlockCard block={item.block} elapsed={item.elapsed} active={item.active} progress={item.progress} />;
        }

        elements.push(
            <Animated.View key={`item-${i}`} entering={staggeredEntering(entrance, stagger++)}>
                {content}
            </Animated.View>
        );
    });

    return <View>{elements}</View>;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TodayScreen() {
    const router = useRouter();
    const [state, setState] = useState<ScreenState>({ status: 'loading' });
    // Gate the staggered entrance to the first render after a load so the
    // minute-by-minute currentTime re-render never re-triggers it.
    const [entrance, setEntrance] = useState(true);
    const [currentTime, setCurrentTime] = useState(() => toHHmm(new Date()));
    const [showCreateModal, setShowCreateModal] = useState(false);
    const scrollRef = useRef<ScrollView>(null);
    const scrollViewHeight = useRef(0);
    const hasScrolledToNow = useRef(false);

    const load = useCallback(async () => {
        hasScrolledToNow.current = false;
        setEntrance(true);
        // Re-seed the clock on focus so a just-created plan is compared against
        // the real time, not whatever it was when this tab last mounted.
        setCurrentTime(toHHmm(new Date()));
        setState({ status: 'loading' });

        const planResult = await api.getDayPlan();

        if (planResult.ok) {
            setState({ status: 'loaded', plan: planResult.data });
            return;
        }

        if (planResult.status === 404) {
            const templateResult = await api.getDayTemplate();
            setState({
                status: 'empty',
                template: templateResult.ok ? templateResult.data : null,
            });
            return;
        }

        const message = planResult.status !== undefined
            ? 'Something went wrong. Please try again.'
            : planResult.error;
        setState({ status: 'error', message });
    }, []);

    useFocusEffect(
        useCallback(() => {
            load();
        }, [load])
    );

    // Align the first tick to the wall-clock minute boundary so a block activates
    // when the clock actually rolls over, not up to ~59s later on an arbitrary offset.
    useEffect(() => {
        let interval: ReturnType<typeof setInterval>;
        const now = new Date();
        const msToNextMinute = 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds());
        const timeout = setTimeout(() => {
            setCurrentTime(toHHmm(new Date()));
            interval = setInterval(() => setCurrentTime(toHHmm(new Date())), 60_000);
        }, msToNextMinute);
        return () => {
            clearTimeout(timeout);
            clearInterval(interval);
        };
    }, []);

    useEffect(() => {
        if (state.status !== 'loaded' && state.status !== 'empty') return;
        const t = setTimeout(() => setEntrance(false), 700);
        return () => clearTimeout(t);
    }, [state.status]);

    // Scroll so the now indicator is centred on screen. Only fires once per load
    // to avoid fighting the user if they scroll manually.
    const handleNowLayout = useCallback((y: number) => {
        if (hasScrolledToNow.current || scrollViewHeight.current === 0) return;
        hasScrolledToNow.current = true;
        // y is relative to the timeline View; scrollContent adds 16px top padding.
        // Use the measured ScrollView height (not screen height) so the header,
        // safe area, and tab bar are excluded from the centring calculation.
        const targetY = Math.max(0, y + 16 - scrollViewHeight.current / 2);
        scrollRef.current?.scrollTo({ y: targetY, animated: true });
    }, []);

    function handleTaskDone(taskId: string) {
        setState(prev => {
            if (prev.status !== 'loaded') return prev;
            return {
                ...prev,
                plan: {
                    ...prev.plan,
                    blocks: prev.plan.blocks.map(block => ({
                        ...block,
                        tasks: block.tasks.map(task =>
                            task.id === taskId ? { ...task, status: 'DONE' as TaskStatus } : task
                        ),
                    })),
                },
            };
        });
    }

    const handleTaskPress = (taskId: string) => router.push(`/task/${taskId}?from=Today`);

    // The plan is only created on confirm, so entering the flow is just
    // navigation. Eligibility errors (no template, no blocks left today) surface
    // when the proposal is generated.
    const handlePlanDay = () => router.push('/planning/review');
    const handleAddTask = () => setShowCreateModal(true);

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <View style={styles.header}>
                <Wordmark size={34} />
                <PressableScale style={styles.planButton} onPress={handlePlanDay}>
                    <PlanButtonGradient />
                    <Ionicons name="sparkles" size={14} color="#2a2621" />
                    <Text style={styles.planButtonText}>{state.status === 'loaded' ? 'Replan' : 'Plan your day'}</Text>
                </PressableScale>
            </View>

            {state.status === 'loading' && (
                <View style={styles.centered}>
                    <ActivityIndicator size="large" color="#d4a574" />
                </View>
            )}

            {state.status === 'error' && (
                <View style={styles.centered}>
                    <Text style={styles.errorText}>{state.message}</Text>
                    <PressableScale style={styles.retryButton} onPress={load}>
                        <Text style={styles.retryButtonText}>Retry</Text>
                    </PressableScale>
                </View>
            )}

            {state.status === 'empty' && (
                <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                    <EmptyState template={state.template} entrance={entrance} />
                </ScrollView>
            )}

            {state.status === 'loaded' && (
                <ScrollView
                    ref={scrollRef}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                    onLayout={(e) => { scrollViewHeight.current = e.nativeEvent.layout.height; }}
                >
                    <Timeline plan={state.plan} currentTime={currentTime} entrance={entrance} onNowLayout={handleNowLayout} onTaskDone={handleTaskDone} onTaskPress={handleTaskPress} />
                </ScrollView>
            )}

            {(state.status === 'empty' || state.status === 'loaded') && (
                <View style={styles.fabWrap} pointerEvents="box-none">
                    <PressableScale style={styles.fab} onPress={handleAddTask}>
                        <Ionicons name="add" size={18} color="#2a2621" />
                        <Text style={styles.fabText}>Task</Text>
                    </PressableScale>
                </View>
            )}

            <CreateTaskModal
                visible={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                onCreated={() => setShowCreateModal(false)}
            />
        </SafeAreaView>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#fdfcfa',
    },

    // Header
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 17,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(42,38,33,0.04)',
    },
    dayOfWeek: {
        fontSize: 14,
        fontWeight: '500',
        color: 'rgba(42,38,33,0.6)',
        letterSpacing: -0.15,
    },
    date: {
        fontSize: 18,
        fontWeight: '500',
        color: '#2a2621',
        letterSpacing: -0.44,
        marginTop: 2,
    },
    planButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 16,
        overflow: 'hidden',
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    planButtonText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#2a2621',
        letterSpacing: -0.15,
    },

    // Scroll content
    scrollContent: {
        padding: 16,
        paddingBottom: 80,
    },

    // Loading / error states
    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 16,
    },
    errorText: {
        fontSize: 14,
        color: '#7a736a',
        textAlign: 'center',
        paddingHorizontal: 24,
    },
    retryButton: {
        backgroundColor: '#d4a574',
        borderRadius: 16,
        paddingHorizontal: 20,
        paddingVertical: 10,
    },
    retryButtonText: {
        fontSize: 14,
        fontWeight: '500',
        color: '#2a2621',
    },

    // Free slot indicator
    freeSlotRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    freeSlotThread: {
        position: 'absolute',
        left: 10,
        top: 0,
        bottom: 0,
        width: 1,
        backgroundColor: 'rgba(42,38,33,0.12)',
    },
    freeSlotPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 8,
        paddingVertical: 4,
        marginHorizontal: 8,
    },
    freeSlotText: {
        fontSize: 10,
        fontWeight: '400',
        color: 'rgba(122,115,106,0.8)',
        fontVariant: ['tabular-nums'],
    },

    // Elapsed opacity (shared)
    elapsedOpacity: {
        opacity: 1,
    },

    // Populated timeline
    anchorCard: {
        backgroundColor: colors.surface.block,
        borderRadius: 16,
        padding: 16,
        overflow: 'hidden',
    },
    containerCard: {
        backgroundColor: colors.surface.block,
        borderWidth: 1.5,
        borderColor: 'rgba(42,38,33,0.16)',
        borderStyle: 'dashed',
        borderRadius: 16,
        padding: 16,
        overflow: 'hidden',
    },
    containerCardHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    containerCardHeaderLeft: {
        flex: 1,
        marginRight: 8,
    },
    blockName: {
        fontSize: 15,
        fontWeight: '500',
        color: '#2a2621',
        letterSpacing: -0.23,
    },
    blockNameActive: {
        fontWeight: '600',
    },
    blockCardActive: {
        borderWidth: 1.5,
        borderStyle: 'solid',
        borderColor: 'rgba(212,165,116,0.55)',
    },
    blockTime: {
        fontSize: 11,
        color: '#9a9389',
        letterSpacing: -0.15,
        marginTop: 3,
        fontVariant: ['tabular-nums'],
    },
    blockTimeRemaining: {
        color: '#7a9a6f',
        fontWeight: '500',
        fontVariant: ['tabular-nums'],
    },
    taskList: {
        gap: 6,
        marginTop: 12,
    },
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
    toggleIcon: {
        width: 18,
        height: 18,
    },
    taskTitle: {
        flex: 1,
        fontSize: 14,
        color: '#2a2621',
        letterSpacing: -0.15,
        marginRight: 10,
    },
    taskEstimate: {
        fontSize: 13,
        color: '#7a736a',
        letterSpacing: -0.15,
        fontVariant: ['tabular-nums'],
    },

    // Empty state hero
    emptyHero: {
        alignItems: 'center',
        backgroundColor: '#fffef9',
        borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.05)',
        borderRadius: 24,
        paddingHorizontal: 28,
        paddingTop: 34,
        paddingBottom: 30,
        shadowColor: '#2a2621',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.05,
        shadowRadius: 14,
        elevation: 2,
    },
    emptyHeroGlyph: {
        marginBottom: 16,
    },
    emptyHeroTitle: {
        fontSize: 19,
        fontWeight: '600',
        color: '#2a2621',
        letterSpacing: -0.4,
    },
    emptyHeroSubtitle: {
        fontSize: 14,
        lineHeight: 21,
        color: '#7a736a',
        letterSpacing: -0.15,
        textAlign: 'center',
        marginTop: 8,
        maxWidth: 300,
    },

    // Template section (empty state)
    templateTimeline: {
        marginTop: 24,
    },

    // Ghost anchor / no-task card
    ghostAnchorCard: {
        backgroundColor: 'rgba(232,228,221,0.2)',
        borderRadius: 16,
        padding: 16,
    },
    ghostAnchorName: {
        fontSize: 15,
        fontWeight: '500',
        color: 'rgba(42,38,33,0.5)',
        letterSpacing: -0.23,
    },
    ghostAnchorTime: {
        fontSize: 14,
        color: 'rgba(122,115,106,0.5)',
        letterSpacing: -0.15,
        marginTop: 2,
        fontVariant: ['tabular-nums'],
    },

    // Ghost container card (dashed)
    ghostContainerCard: {
        borderWidth: 2,
        borderColor: 'rgba(42,38,33,0.08)',
        borderStyle: 'dashed',
        borderRadius: 16,
        padding: 18,
    },
    ghostContainerHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    ghostContainerHeaderLeft: {
        flex: 1,
        marginRight: 8,
    },
    ghostContainerName: {
        fontSize: 15,
        fontWeight: '500',
        color: 'rgba(42,38,33,0.6)',
        letterSpacing: -0.23,
    },
    ghostContainerTime: {
        fontSize: 14,
        color: 'rgba(122,115,106,0.6)',
        letterSpacing: -0.15,
        marginTop: 2,
        fontVariant: ['tabular-nums'],
    },
    energyBadge: {
        backgroundColor: 'rgba(232,223,209,0.3)',
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
        alignSelf: 'flex-start',
    },
    energyBadgeText: {
        fontSize: 12,
        color: 'rgba(122,115,106,0.6)',
    },
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
        marginTop: 16,
    },
    noTasksDot: {
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.04)',
    },
    noTasksText: {
        fontSize: 14,
        color: 'rgba(122,115,106,0.4)',
        letterSpacing: -0.15,
    },

    // Wrapper holds the absolute position so the inner PressableScale's press transform doesn't fight it.
    fabWrap: {
        position: 'absolute',
        bottom: 16,
        right: 16,
    },
    fab: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        height: 40,
        paddingHorizontal: 14,
        borderRadius: 20,
        backgroundColor: '#ffffff',
        justifyContent: 'center',
        shadowColor: '#2a2621',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 8,
        elevation: 4,
    },
    fabText: { fontSize: 14, fontWeight: '500', color: '#2a2621', letterSpacing: -0.2 },
});
