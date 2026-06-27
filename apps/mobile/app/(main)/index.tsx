import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Alert,
    ActivityIndicator,
} from "react-native";
import CreateTaskModal from "../../components/CreateTaskModal";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../lib/api";
import { DayPlan, DayTemplate, DayTemplateBlock, PlannedBlock, PlannedTask, TaskStatus } from "../../lib/api.types";
import { toMins, toHHmm, formatTime } from "../../lib/time";

function formatDuration(startTime: string, endTime: string): string {
    const mins = toMins(endTime) - toMins(startTime);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
}

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

// ─── Shared timeline primitives ───────────────────────────────────────────────

function ThreadSegment() {
    return (
        <View style={styles.threadSegment}>
            <View style={styles.threadLine} />
        </View>
    );
}

function DayBoundaryMarker({ label, time }: { label: 'Wake' | 'Sleep'; time: string }) {
    const isWake = label === 'Wake';
    return (
        <View style={styles.boundaryRow}>
            <Ionicons
                name={isWake ? 'sunny-outline' : 'moon-outline'}
                size={16}
                color={isWake ? '#d4a574' : '#9b8c7f'}
                style={styles.boundaryIcon}
            />
            <Text style={[styles.boundaryLabel, !isWake && styles.boundaryLabelSleep]}>
                {label.toLowerCase()}
            </Text>
            <Text style={[styles.boundaryTime, !isWake && styles.boundaryTimeSleep]}>
                {formatTime(time)}
            </Text>
        </View>
    );
}

function FreeSlotIndicator({ startTime, endTime, elapsed }: { startTime: string; endTime: string; elapsed?: boolean }) {
    return (
        <View style={[styles.freeSlotRow, elapsed && styles.elapsedOpacity]}>
            <View style={styles.freeSlotPill}>
                <Text style={styles.freeSlotText}>
                    {formatTime(startTime)} – {formatTime(endTime)}  ·  {formatDuration(startTime, endTime)}  ·  free slot
                </Text>
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

function EmptyState({ template }: { template: DayTemplate | null }) {
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
    listItems.forEach((item, i) => {
        if (i > 0) {
            timelineElements.push(<ThreadSegment key={`t-${i}`} />);
        }
        if (item.kind === 'block') {
            timelineElements.push(
                item.block.type === 'CONTAINER'
                    ? <GhostContainerBlock key={`i-${i}`} block={item.block} />
                    : <GhostAnchorBlock key={`i-${i}`} block={item.block} />
            );
        } else if (item.kind === 'gap') {
            timelineElements.push(<FreeSlotIndicator key={`i-${i}`} startTime={item.start} endTime={item.end} />);
        } else {
            timelineElements.push(<DayBoundaryMarker key={`i-${i}`} label={item.label} time={item.time} />);
        }
    });

    return (
        <>
            <View style={styles.emptyBanner}>
                <View style={styles.emptyIconCircle}>
                    <Text style={styles.emptyIcon}>✦</Text>
                </View>
                <Text style={styles.emptyBannerText}>{"Today's plan is empty"}</Text>
            </View>

            {listItems.length > 0 && (
                <View style={styles.templateTimeline}>
                    {timelineElements}
                </View>
            )}
        </>
    );
}

// ─── Populated timeline components ───────────────────────────────────────────

function CurrentTimeIndicator({ time }: { time: string }) {
    return (
        <View style={styles.currentTimeRow}>
            <View style={styles.currentTimeDot} />
            <View style={styles.currentTimeLine} />
            <Text style={styles.currentTimeLabel}>{formatTime(time)}</Text>
        </View>
    );
}

function AnchorBlockCard({ block, elapsed }: { block: PlannedBlock; elapsed: boolean }) {
    return (
        <View style={[styles.anchorCard, elapsed && styles.elapsedOpacity]}>
            <Text style={styles.blockName}>{block.name}</Text>
            <Text style={styles.blockTime}>{formatTime(block.startTime)} – {formatTime(block.endTime)}</Text>
        </View>
    );
}

function TaskDoneToggle({ task, onDone }: { task: PlannedTask; onDone: () => void }) {
    const [completing, setCompleting] = useState(false);
    const isDone = task.status === 'DONE' || completing;

    async function handlePress() {
        if (completing || task.status === 'DONE') return;
        setCompleting(true);
        const result = await api.updateTask(task.id, { progress: 100 });
        if (result.ok) {
            setCompleting(false);
            onDone();
        } else {
            setCompleting(false);
        }
    }

    return (
        <TouchableOpacity
            onPress={handlePress}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.6}
        >
            <Ionicons
                name={isDone ? 'checkmark-circle' : 'checkmark-circle-outline'}
                size={20}
                color={isDone ? '#5c5248' : 'rgba(122,115,106,0.3)'}
            />
        </TouchableOpacity>
    );
}

function ContainerBlockCard({ block, elapsed, onTaskDone, onTaskPress }: { block: PlannedBlock; elapsed: boolean; onTaskDone: (taskId: string) => void; onTaskPress: (taskId: string) => void }) {
    const energyLabel = block.energyLevel
        ? block.energyLevel.charAt(0) + block.energyLevel.slice(1).toLowerCase() + ' energy'
        : null;

    return (
        <View style={[styles.containerCard, elapsed && styles.elapsedOpacity]}>
            <View style={styles.containerCardHeader}>
                <View style={styles.containerCardHeaderLeft}>
                    <Text style={styles.blockName}>{block.name}</Text>
                    <Text style={styles.blockTime}>{formatTime(block.startTime)} – {formatTime(block.endTime)}</Text>
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
                        <TouchableOpacity key={task.id} style={styles.taskCard} activeOpacity={0.7} onPress={() => onTaskPress(task.id)}>
                            <TaskDoneToggle task={task} onDone={() => onTaskDone(task.id)} />
                            <Text style={styles.taskTitle} numberOfLines={2}>{task.title}</Text>
                            <Text style={styles.taskEstimate}>{formatEstimatedMins(task.estimatedMins)}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            )}
        </View>
    );
}

type TimelineItem =
    | { kind: 'block'; block: PlannedBlock; elapsed: boolean }
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
        items.push({
            kind: 'block',
            block,
            elapsed: nowMins >= toMins(block.endTime),
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

function Timeline({
    plan,
    currentTime,
    onNowLayout,
    onTaskDone,
    onTaskPress,
}: {
    plan: DayPlan;
    currentTime: string;
    onNowLayout: (y: number) => void;
    onTaskDone: (taskId: string) => void;
    onTaskPress: (taskId: string) => void;
}) {
    const items = buildTimelineItems(plan, currentTime);

    const elements: ReactNode[] = [];
    items.forEach((item, i) => {
        // Skip the thread segment on either side of the current-time indicator —
        // it serves as its own visual separator.
        if (i > 0) {
            const prev = items[i - 1];
            if (item.kind !== 'current-time' && prev.kind !== 'current-time') {
                elements.push(<ThreadSegment key={`sep-${i}`} />);
            }
        }

        if (item.kind === 'boundary') {
            elements.push(<DayBoundaryMarker key={`item-${i}`} label={item.label} time={item.time} />);
        } else if (item.kind === 'gap') {
            elements.push(<FreeSlotIndicator key={`item-${i}`} startTime={item.start} endTime={item.end} elapsed={item.elapsed} />);
        } else if (item.kind === 'current-time') {
            elements.push(
                <View key={`item-${i}`} onLayout={(e) => onNowLayout(e.nativeEvent.layout.y)}>
                    <CurrentTimeIndicator time={item.time} />
                </View>
            );
        } else if (item.block.type === 'CONTAINER') {
            elements.push(<ContainerBlockCard key={`item-${i}`} block={item.block} elapsed={item.elapsed} onTaskDone={onTaskDone} onTaskPress={onTaskPress} />);
        } else {
            elements.push(<AnchorBlockCard key={`item-${i}`} block={item.block} elapsed={item.elapsed} />);
        }
    });

    return <View>{elements}</View>;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TodayScreen() {
    const router = useRouter();
    const [state, setState] = useState<ScreenState>({ status: 'loading' });
    const [currentTime, setCurrentTime] = useState(() => toHHmm(new Date()));
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [isPlanningLoading, setIsPlanningLoading] = useState(false);
    const scrollRef = useRef<ScrollView>(null);
    const scrollViewHeight = useRef(0);
    const hasScrolledToNow = useRef(false);

    const dayOfWeek = useMemo(() => new Date().toLocaleDateString('en-US', { weekday: 'long' }), []);
    const date = useMemo(() => new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), []);

    const load = useCallback(async () => {
        hasScrolledToNow.current = false;
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

    // Keep current time fresh; re-renders the now indicator every minute.
    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentTime(toHHmm(new Date()));
        }, 60_000);
        return () => clearInterval(interval);
    }, []);

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

    const handleTaskPress = (taskId: string) => router.push(`/task/${taskId}`);

    const handlePlanDay = async () => {
        setIsPlanningLoading(true);
        const result = await api.createDayPlan();
        setIsPlanningLoading(false);

        if (!result.ok) {
            const title = result.status === 400 ? 'Cannot plan day' : 'Something went wrong';
            Alert.alert(title, result.error);
            return;
        }

        router.push(`/planning/${result.data.id}`);
    };
    const handleAddTask = () => setShowCreateModal(true);

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.header}>
                <View>
                    <Text style={styles.dayOfWeek}>{dayOfWeek}</Text>
                    <Text style={styles.date}>{date}</Text>
                </View>
                <TouchableOpacity
                    style={styles.planButton}
                    onPress={handlePlanDay}
                    activeOpacity={0.8}
                    disabled={isPlanningLoading}
                >
                    {isPlanningLoading
                        ? <ActivityIndicator size="small" color="#2a2621" style={styles.planButtonSpinner} />
                        : <Text style={styles.planButtonIcon}>✦</Text>
                    }
                    <Text style={styles.planButtonText}>Plan day</Text>
                </TouchableOpacity>
            </View>

            {state.status === 'loading' && (
                <View style={styles.centered}>
                    <ActivityIndicator size="large" color="#d4a574" />
                </View>
            )}

            {state.status === 'error' && (
                <View style={styles.centered}>
                    <Text style={styles.errorText}>{state.message}</Text>
                    <TouchableOpacity style={styles.retryButton} onPress={load}>
                        <Text style={styles.retryButtonText}>Retry</Text>
                    </TouchableOpacity>
                </View>
            )}

            {state.status === 'empty' && (
                <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                    <EmptyState template={state.template} />
                </ScrollView>
            )}

            {state.status === 'loaded' && (
                <ScrollView
                    ref={scrollRef}
                    contentContainerStyle={styles.scrollContent}
                    showsVerticalScrollIndicator={false}
                    onLayout={(e) => { scrollViewHeight.current = e.nativeEvent.layout.height; }}
                >
                    <Timeline plan={state.plan} currentTime={currentTime} onNowLayout={handleNowLayout} onTaskDone={handleTaskDone} onTaskPress={handleTaskPress} />
                </ScrollView>
            )}

            {(state.status === 'empty' || state.status === 'loaded') && (
                <TouchableOpacity style={styles.fab} onPress={handleAddTask} activeOpacity={0.85}>
                    <Ionicons name="add" size={24} color="#2a2621" />
                </TouchableOpacity>
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
        backgroundColor: '#d4a574',
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 10,
    },
    planButtonIcon: {
        fontSize: 12,
        color: '#2a2621',
    },
    planButtonSpinner: {
        width: 12,
        height: 12,
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

    // Thread primitives
    threadSegment: {
        height: 12,
        paddingLeft: 10,
        justifyContent: 'center',
    },
    threadLine: {
        width: 1,
        flex: 1,
        backgroundColor: 'rgba(42,38,33,0.12)',
    },

    // Day boundary markers
    boundaryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingVertical: 2,
    },
    boundaryIcon: {
        width: 22,
        textAlign: 'center',
    },
    boundaryLabel: {
        fontSize: 10,
        fontWeight: '400',
        color: '#d4a574',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
    },
    boundaryLabelSleep: {
        color: '#9b8c7f',
    },
    boundaryTime: {
        fontSize: 13,
        fontWeight: '500',
        color: '#2a2621',
        letterSpacing: -0.15,
    },
    boundaryTimeSleep: {
        color: 'rgba(42,38,33,0.6)',
    },

    // Free slot indicator
    freeSlotRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    freeSlotPill: {
        backgroundColor: 'rgba(42,38,33,0.05)',
        borderWidth: 0.5,
        borderColor: 'rgba(42,38,33,0.14)',
        borderRadius: 100,
        paddingHorizontal: 10,
        paddingVertical: 4,
        marginHorizontal: 8,
    },
    freeSlotText: {
        fontSize: 10,
        fontWeight: '400',
        color: 'rgba(122,115,106,0.8)',
    },

    // Current time indicator
    currentTimeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 6,
    },
    currentTimeDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#d4a574',
    },
    currentTimeLine: {
        flex: 1,
        height: 1,
        borderTopWidth: 1,
        borderStyle: 'dashed',
        borderColor: 'rgba(212,165,116,0.5)',
        marginHorizontal: 6,
    },
    currentTimeLabel: {
        fontSize: 11,
        fontWeight: '500',
        color: '#d4a574',
    },

    // Elapsed opacity (shared)
    elapsedOpacity: {
        opacity: 1,
    },

    // Populated timeline
    anchorCard: {
        backgroundColor: 'rgba(232,228,221,0.45)',
        borderRadius: 16,
        padding: 16,
    },
    containerCard: {
        backgroundColor: '#fdfcfa',
        borderWidth: 1.5,
        borderColor: 'rgba(42,38,33,0.16)',
        borderStyle: 'dashed',
        borderRadius: 16,
        padding: 16,
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
    blockTime: {
        fontSize: 12,
        color: '#9a9389',
        letterSpacing: -0.15,
        marginTop: 2,
    },
    taskList: {
        gap: 6,
        marginTop: 12,
    },
    taskCard: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: '#fffef9',
        borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.04)',
        borderRadius: 16,
        padding: 15,
    },
    taskTitle: {
        flex: 1,
        fontSize: 15,
        color: '#2a2621',
        letterSpacing: -0.23,
        marginRight: 12,
    },
    taskEstimate: {
        fontSize: 14,
        color: '#7a736a',
        letterSpacing: -0.15,
    },

    // Empty state banner
    emptyBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: '#fffef9',
        borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.04)',
        borderRadius: 16,
        padding: 17,
    },
    emptyIconCircle: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: 'rgba(212,165,116,0.1)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyIcon: {
        fontSize: 14,
        color: '#d4a574',
    },
    emptyBannerText: {
        fontSize: 14,
        color: '#7a736a',
        letterSpacing: -0.15,
    },

    // Template section (empty state)
    templateTimeline: {
        marginTop: 12,
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
        borderRadius: 16,
        paddingHorizontal: 17,
        paddingVertical: 13,
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

    // Floating action button
    fab: {
        position: 'absolute',
        bottom: 16,
        right: 16,
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#ffffff',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#2a2621',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.12,
        shadowRadius: 8,
        elevation: 4,
    },
});
