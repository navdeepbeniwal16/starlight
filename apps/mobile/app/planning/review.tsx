import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
    ActivityIndicator,
    Alert,
    Animated,
    Easing,
    LayoutAnimation,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    UIManager,
    View,
    type StyleProp,
    type ViewStyle,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../lib/api";
import { formatTime } from "../../lib/time";
import type { BacklogBuckets, BacklogTask, ScheduledTask, TaskDetail } from "../../lib/api.types";
import { applyCreated, applyProgress, applyToggle, createSequencer, groupForReconcile, patchTask, restoreTask, withoutTask } from "../../lib/backlogState";
import { usePlanningStore } from "../../stores/planning.store";
import CreateTaskModal from "../../components/CreateTaskModal";
import { ProgressSlider } from "../../components/TaskFields";
import ReanimatedSwipeable, { SwipeDirection, type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

const QUICK_MARKS = [25, 50, 75];

// pickUp stays open always — it's the one group asking for a decision.
type GroupKey = 'pickUp' | 'everythingElse' | 'doneToday';

const GROUPS: Array<{ key: GroupKey; label: string; description: string; collapsible: boolean }> = [
    { key: 'pickUp',         label: 'Pick up where you left off', description: 'Carried over, scheduled, or in progress', collapsible: false },
    { key: 'everythingElse', label: 'Everything else',            description: 'Other tasks still on your backlog',      collapsible: true  },
    { key: 'doneToday',      label: 'Done today',                 description: 'Finished today',                          collapsible: true  },
];

// Above this, "Everything else" defaults collapsed so the backlog isn't a wall.
const EVERYTHING_ELSE_COLLAPSE_THRESHOLD = 6;

// ─── Motion primitives ────────────────────────────────────────────────────────

// Staggered fade + lift on mount. Splits the list into chunks that enter in
// sequence (~60ms apart) rather than animating the whole container at once.
function EnterView({ index = 0, style, children }: { index?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
    const t = useRef(new Animated.Value(0)).current;
    // Frozen at mount: a later reorder changing `index` must not replay the fade,
    // or an in-place edit reads as the card closing and reopening.
    const delay = useRef(index * 60).current;
    useEffect(() => {
        const anim = Animated.timing(t, {
            toValue: 1,
            duration: 320,
            delay,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        });
        anim.start();
        return () => anim.stop();
    }, [t, delay]);
    return (
        <Animated.View
            style={[
                style,
                { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] },
            ]}
        >
            {children}
        </Animated.View>
    );
}

// Subtle scale(0.96) on press for tactile feedback on primary controls.
function PressableScale({ onPress, disabled, style, children }: { onPress?: () => void; disabled?: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
    const scale = useRef(new Animated.Value(1)).current;
    const to = (v: number) =>
        Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            onPressIn={() => to(0.96)}
            onPressOut={() => to(1)}
        >
            <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
        </Pressable>
    );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DoneToggle({ task, onToggle }: { task: BacklogTask; onToggle: (updated: TaskDetail) => void }) {
    const [busy, setBusy] = useState(false);
    const isDone = task.status === 'DONE';

    async function handlePress() {
        if (busy) return;
        setBusy(true);
        const result = await api.updateTask(task.id, { progress: isDone ? 75 : 100 });
        setBusy(false);
        if (result.ok) onToggle(result.data);
    }

    return (
        <TouchableOpacity
            onPress={handlePress}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.6}
        >
            <Ionicons
                name={isDone ? 'checkmark-circle' : 'checkmark-circle-outline'}
                size={22}
                color={isDone ? '#5c5248' : 'rgba(122,115,106,0.3)'}
            />
        </TouchableOpacity>
    );
}

function StatusBadge({ status }: { status: BacklogTask['status'] }) {
    const inProgress = status === 'IN_PROGRESS';
    const done = status === 'DONE';
    const label = done ? 'Done' : inProgress ? 'In Progress' : 'Todo';
    const badgeStyle = inProgress ? s.badgeInProgress : done ? s.badgeDone : s.badgeMuted;
    const textStyle = inProgress ? s.badgeTextInProgress : done ? s.badgeTextDone : s.badgeTextMuted;
    return (
        <View style={[s.badge, badgeStyle]}>
            <Text style={[s.badgeText, textStyle]}>{label}</Text>
        </View>
    );
}

function formatDeadline(iso: string): string {
    const d = new Date(iso);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `Due ${months[d.getMonth()]} ${d.getDate()}`;
}

// Scheduled tasks land here still carrying their block fields; everything else
// falls back to its deadline, matching the backlog card's meta line.
function taskMeta(task: BacklogTask): string | null {
    const sched = task as Partial<ScheduledTask>;
    if (sched.blockStartTime && sched.blockName) return `${formatTime(sched.blockStartTime)} · ${sched.blockName}`;
    return task.deadline ? formatDeadline(task.deadline) : null;
}

function TaskCard({ task, expanded, onToggleExpand, onToggleDone, onSetProgress, onOpen }: {
    task: BacklogTask;
    expanded: boolean;
    onToggleExpand: () => void;
    onToggleDone: (updated: TaskDetail) => void;
    onSetProgress: (value: number) => void;
    onOpen: () => void;
}) {
    const progress = task.progress ?? 0;
    const isDone = task.status === 'DONE';
    const meta = taskMeta(task);
    return (
        <View style={[s.taskCard, expanded && s.taskCardExpanded]}>
            <TouchableOpacity style={s.taskRow} activeOpacity={0.7} onPress={onToggleExpand}>
                <DoneToggle task={task} onToggle={onToggleDone} />
                <View style={s.taskContent}>
                    <Text style={[s.taskTitle, isDone && s.taskTitleDone]} numberOfLines={2}>{task.title}</Text>
                    <View style={s.badgeRow}>
                        <StatusBadge status={task.status} />
                        {meta && <Text style={s.metaText}>{meta}</Text>}
                    </View>
                </View>
                <Ionicons
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color="rgba(122,115,106,0.45)"
                />
            </TouchableOpacity>

            {expanded && (
                <View style={s.expandPanel}>
                    <ProgressSlider value={progress} onChange={() => {}} onRelease={onSetProgress} />
                    <View style={s.quickMarks}>
                        {QUICK_MARKS.map(mark => (
                            <TouchableOpacity
                                key={mark}
                                style={[s.markPill, progress === mark && s.markPillOn]}
                                activeOpacity={0.7}
                                onPress={() => onSetProgress(mark)}
                            >
                                <Text style={[s.markPillText, progress === mark && s.markPillTextOn]}>{mark}%</Text>
                            </TouchableOpacity>
                        ))}
                        <TouchableOpacity style={s.openTask} activeOpacity={0.7} onPress={onOpen}>
                            <Text style={s.openTaskText}>Open task</Text>
                            <Ionicons name="chevron-forward" size={13} color="#7a736a" />
                        </TouchableOpacity>
                    </View>
                </View>
            )}
        </View>
    );
}

function renderDoneAction() {
    return (
        <View style={[s.swipeAction, s.swipeDone]}>
            <Ionicons name="checkmark-circle" size={22} color="#fdfcfa" />
        </View>
    );
}

function renderDeleteAction() {
    return (
        <View style={[s.swipeAction, s.swipeDelete]}>
            <Ionicons name="trash-outline" size={20} color="#fdfcfa" />
        </View>
    );
}

// Swipe is just an alternate trigger for the same optimistic paths as the inline
// controls: right reveals done (progress 100), left reveals delete. Disabled while
// expanded so the gesture can't fight the panel's horizontal slider.
function SwipeableTaskCard({ task, expanded, onMarkDone, onDelete, children }: {
    task: BacklogTask;
    expanded: boolean;
    onMarkDone: () => void;
    onDelete: () => void;
    children: ReactNode;
}) {
    const ref = useRef<SwipeableMethods | null>(null);
    const isDone = task.status === 'DONE';

    function handleOpen(direction: SwipeDirection) {
        ref.current?.close();
        // `direction` is the row's travel, not the panel: revealing the left (done)
        // panel moves the row right, so RIGHT means done and LEFT means delete.
        if (direction === SwipeDirection.RIGHT) onMarkDone();
        else onDelete();
    }

    return (
        <ReanimatedSwipeable
            ref={ref}
            enabled={!expanded}
            friction={2}
            overshootLeft={false}
            overshootRight={false}
            leftThreshold={40}
            rightThreshold={40}
            dragOffsetFromLeftEdge={24}
            dragOffsetFromRightEdge={24}
            renderLeftActions={isDone ? undefined : renderDoneAction}
            renderRightActions={renderDeleteAction}
            onSwipeableOpen={handleOpen}
        >
            {children}
        </ReanimatedSwipeable>
    );
}

function GroupHeader({ label, description, count, collapsible, open, onToggle }: {
    label: string;
    description: string;
    count: number;
    collapsible: boolean;
    open: boolean;
    onToggle: () => void;
}) {
    const content = (
        <View>
            <View style={s.groupHeaderRow}>
                {collapsible && (
                    <Ionicons
                        name={open ? 'chevron-down' : 'chevron-forward'}
                        size={13}
                        color="rgba(122,115,106,0.6)"
                    />
                )}
                <Text style={s.groupLabel}>{label}</Text>
                <Text style={s.groupCount}>{count}</Text>
            </View>
            <Text style={[s.groupDescription, collapsible && s.groupDescriptionIndented]}>{description}</Text>
        </View>
    );
    if (!collapsible) return content;
    return (
        <TouchableOpacity onPress={onToggle} activeOpacity={0.6}>
            {content}
        </TouchableOpacity>
    );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PlanningReviewScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const setProposal = usePlanningStore(s => s.setProposal);

    const [buckets, setBuckets] = useState<BacklogBuckets | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);

    const [openOverrides, setOpenOverrides] = useState<Partial<Record<GroupKey, boolean>>>({});
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // Agent plan generation: full-screen while the agent runs, retry on error.
    const [generating, setGenerating] = useState(false);
    const [generateError, setGenerateError] = useState<string | null>(null);

    // Gates out slow responses that would otherwise clobber an optimistic update.
    const seq = useRef(createSequencer()).current;

    const loadBuckets = useCallback((showLoading: boolean) => {
        const token = seq.next();
        if (showLoading) setError(null);
        api.getBacklog().then(result => {
            if (!seq.isCurrent(token)) return;
            if (!result.ok) { if (showLoading) setError(result.error); return; }
            setBuckets(result.data);
        });
    }, [seq]);

    const planRun = useRef<AbortController | null>(null);

    const handlePlanDay = useCallback(async () => {
        if (generating) return;
        const run = new AbortController();
        planRun.current = run;
        setGenerating(true);
        setGenerateError(null);
        const result = await api.generatePlan(run.signal);
        // Drop the result if this run was superseded, so an aborted request
        // (cancel) or a stale one never errors or navigates.
        if (planRun.current !== run) return;
        planRun.current = null;
        setGenerating(false);
        if (result.ok) {
            setProposal(result.data);
            router.push('/planning/plan');
        } else {
            setGenerateError(result.error);
        }
    }, [generating, router, setProposal]);

    const cancelPlanDay = useCallback(() => {
        planRun.current?.abort();
        planRun.current = null;
        setGenerating(false);
    }, []);

    // Refetch on focus so edits made on the task detail screen reflect here.
    useFocusEffect(
        useCallback(() => { loadBuckets(true); }, [loadBuckets])
    );

    // Placed optimistically off the confirmed status; the refetch then reconciles
    // the true bucket (e.g. a reopened task's plan placement).
    function handleToggleDone(task: BacklogTask, updated: TaskDetail) {
        setBuckets(prev => prev ? applyToggle(prev, task, updated).buckets : prev);
        loadBuckets(false);
    }

    const commitProgress = useCallback(async (task: BacklogTask, value: number) => {
        const result = await api.updateTask(task.id, { progress: value });
        if (!result.ok) return;
        // Burn a token so a refetch in flight (e.g. a prior completion's) can't land
        // with a pre-write snapshot and revert this scrub; the done path refetches below.
        seq.next();
        const done = result.data.status === 'DONE';
        // Completion and a todo→in-progress regroup both relocate the card; animate it.
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setBuckets(prev => {
            if (!prev) return prev;
            return done ? applyProgress(prev, task, result.data).buckets : patchTask(prev, task.id, result.data);
        });
        if (done) loadBuckets(false);
    }, [loadBuckets, seq]);

    function toggleExpand(taskId: string) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpandedId(prev => prev === taskId ? null : taskId);
    }

    const handleDelete = useCallback(async (task: BacklogTask) => {
        const snapshot = buckets;
        if (!snapshot) return;
        // Burn a token so a refetch already in flight can't resurrect the removed task.
        seq.next();
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpandedId(current => current === task.id ? null : current);
        setBuckets(prev => prev ? withoutTask(prev, task.id) : prev);
        const result = await api.deleteTask(task.id);
        if (!result.ok) {
            setBuckets(prev => prev ? restoreTask(prev, snapshot, task.id) : snapshot);
            Alert.alert("Couldn't delete task", result.error);
        }
    }, [buckets, seq]);

    function isGroupOpen(key: GroupKey, count: number): boolean {
        if (key in openOverrides) return openOverrides[key]!;
        if (key === 'doneToday') return false;
        if (key === 'everythingElse') return count <= EVERYTHING_ELSE_COLLAPSE_THRESHOLD;
        return true;
    }

    const loading = buckets === null && !error;
    const groups = buckets ? groupForReconcile(buckets) : null;
    const isEmpty = groups !== null && GROUPS.every(g => groups[g.key].length === 0);

    return (
        <SafeAreaView style={s.container} edges={['top']}>
            <View style={s.header}>
                <View style={s.stepEyebrow}>
                    <View style={[s.stepPip, s.stepPipActive]} />
                    <View style={s.stepPip} />
                    <Text style={s.stepLabel}>Step 1 of 2</Text>
                </View>
                <View style={s.headerRow}>
                    <Text style={s.headerTitle}>Let's plan your day</Text>
                    <TouchableOpacity
                        onPress={() => router.back()}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        activeOpacity={0.6}
                    >
                        <Ionicons name="close" size={22} color="#2a2621" />
                    </TouchableOpacity>
                </View>
                <Text style={s.headerSubtitle}>Sync up your tasks, then let Starlight plan your day.</Text>
            </View>

            {loading && (
                <View style={s.centered}>
                    <ActivityIndicator color="#d4a574" />
                </View>
            )}

            {!loading && error && (
                <View style={s.centered}>
                    <Text style={s.errorText}>{error}</Text>
                </View>
            )}

            {!loading && !error && groups !== null && (
                <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
                    {isEmpty && (
                        <EnterView style={s.emptyState}>
                            <View style={s.emptyIconCircle}>
                                <Ionicons name="sparkles-outline" size={20} color="#d4a574" />
                            </View>
                            <Text style={s.emptyTitle}>Nothing to reconcile</Text>
                            <Text style={s.emptySubtitle}>Add a task below, or plan your day and let the agent schedule it.</Text>
                        </EnterView>
                    )}

                    {!isEmpty && (
                        <EnterView>
                            <Text style={s.hint}>Tap a task to update it · swipe right to complete, left to delete.</Text>
                        </EnterView>
                    )}

                    {(() => {
                        let animIndex = 0;
                        return GROUPS.map(group => {
                            const tasks = groups[group.key];
                            if (tasks.length === 0) return null;
                            const open = isGroupOpen(group.key, tasks.length);
                            const headerIndex = animIndex++;
                            return (
                                <View key={group.key} style={s.section}>
                                    <EnterView index={headerIndex}>
                                        <GroupHeader
                                            label={group.label}
                                            description={group.description}
                                            count={tasks.length}
                                            collapsible={group.collapsible}
                                            open={open}
                                            onToggle={() => setOpenOverrides(prev => ({ ...prev, [group.key]: !open }))}
                                        />
                                    </EnterView>
                                    {open && (
                                        <View style={s.cardGroup}>
                                            {tasks.map(task => (
                                                <EnterView key={task.id} index={animIndex++}>
                                                    <SwipeableTaskCard
                                                        task={task}
                                                        expanded={expandedId === task.id}
                                                        onMarkDone={() => commitProgress(task, 100)}
                                                        onDelete={() => handleDelete(task)}
                                                    >
                                                        <TaskCard
                                                            task={task}
                                                            expanded={expandedId === task.id}
                                                            onToggleExpand={() => toggleExpand(task.id)}
                                                            onToggleDone={(updated) => handleToggleDone(task, updated)}
                                                            onSetProgress={(value) => commitProgress(task, value)}
                                                            onOpen={() => router.push(`/task/${task.id}?from=Review`)}
                                                        />
                                                    </SwipeableTaskCard>
                                                </EnterView>
                                            ))}
                                        </View>
                                    )}
                                </View>
                            );
                        });
                    })()}

                    <EnterView style={s.addTaskWrap}>
                        <PressableScale style={s.addTaskButton} onPress={() => setShowCreateModal(true)}>
                            <Ionicons name="add" size={16} color="#7a736a" />
                            <Text style={s.addTaskLabel}>Add task</Text>
                        </PressableScale>
                    </EnterView>
                </ScrollView>
            )}

            {!loading && !error && (
                <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 24) }]}>
                    <PressableScale
                        style={s.doneButton}
                        onPress={handlePlanDay}
                    >
                        <Text style={s.doneButtonLabel}>Plan my day</Text>
                    </PressableScale>
                </View>
            )}

            <CreateTaskModal
                visible={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                onCreated={(task) => {
                    if (buckets) setBuckets(applyCreated(buckets, task).buckets);
                    loadBuckets(false);
                    setShowCreateModal(false);
                }}
            />

            {(generating || generateError) && (
                <View style={s.generateOverlay}>
                    {generating ? (
                        <>
                            <ActivityIndicator color="#d4a574" size="large" />
                            <Text style={s.generateSubtitle}>Starlight is scheduling your tasks into your day.</Text>
                            <PressableScale style={s.cancelButton} onPress={cancelPlanDay}>
                                <Text style={s.cancelButtonLabel}>Cancel</Text>
                            </PressableScale>
                        </>
                    ) : (
                        <>
                            <View style={s.generateErrorIcon}>
                                <Ionicons name="alert-circle-outline" size={24} color="#d4a574" />
                            </View>
                            <Text style={s.generateTitle}>Couldn't build your plan</Text>
                            <Text style={s.generateSubtitle}>{generateError}</Text>
                            <PressableScale style={s.retryButton} onPress={handlePlanDay}>
                                <Text style={s.retryButtonLabel}>Try again</Text>
                            </PressableScale>
                            <TouchableOpacity onPress={() => setGenerateError(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                                <Text style={s.retryDismiss}>Back to tasks</Text>
                            </TouchableOpacity>
                        </>
                    )}
                </View>
            )}
        </SafeAreaView>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fdfcfa',
    },
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
    headerTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#2a2621',
        letterSpacing: -0.3,
    },
    headerSubtitle: {
        fontSize: 13,
        color: '#7a736a',
        lineHeight: 18,
        marginTop: 6,
        maxWidth: 320,
    },

    centered: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    errorText: {
        fontSize: 14,
        color: '#7a736a',
        textAlign: 'center',
    },

    scrollContent: {
        padding: 16,
        paddingBottom: 8,
        gap: 24,
    },

    hint: {
        fontSize: 12,
        color: 'rgba(122,115,106,0.7)',
        lineHeight: 16,
        letterSpacing: -0.1,
    },

    section: {
        gap: 10,
    },
    groupDescription: {
        fontSize: 12,
        color: 'rgba(122,115,106,0.7)',
        letterSpacing: -0.1,
        marginTop: 3,
    },
    groupDescriptionIndented: { marginLeft: 20 },
    groupHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        minHeight: 24,
    },
    groupLabel: {
        fontSize: 13,
        fontWeight: '600',
        color: '#5c5248',
        letterSpacing: -0.15,
    },
    groupCount: {
        fontSize: 12,
        fontWeight: '600',
        color: 'rgba(122,115,106,0.6)',
        fontVariant: ['tabular-nums'],
    },
    cardGroup: {
        gap: 8,
    },

    taskCard: {
        backgroundColor: '#fffef9',
        borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.10)',
        borderRadius: 14,
        overflow: 'hidden',
    },
    taskCardExpanded: {
        borderColor: 'rgba(42,38,33,0.20)',
    },
    swipeAction: {
        width: 76,
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 14,
    },
    swipeDone: { backgroundColor: '#5c5248' },
    swipeDelete: { backgroundColor: '#c85050' },
    taskRow: {
        paddingHorizontal: 13,
        paddingVertical: 11,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    taskContent: {
        flex: 1,
    },
    expandPanel: {
        paddingHorizontal: 13,
        paddingBottom: 13,
        paddingTop: 4,
        gap: 10,
        borderTopWidth: 1,
        borderTopColor: 'rgba(42,38,33,0.06)',
    },
    quickMarks: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
    },
    markPill: {
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 6,
        backgroundColor: 'rgba(42,38,33,0.06)',
    },
    markPillOn: { backgroundColor: '#2a2621' },
    markPillText: { fontSize: 13, fontWeight: '500', color: '#2a2621' },
    markPillTextOn: { color: '#fdfcfa' },
    openTask: {
        marginLeft: 'auto',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        paddingVertical: 6,
    },
    openTaskText: { fontSize: 13, fontWeight: '500', color: '#7a736a' },
    taskTitle: {
        fontSize: 14,
        fontWeight: '500',
        color: '#2a2621',
        letterSpacing: -0.15,
    },
    taskTitleDone: { color: '#7a736a' },
    badgeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 6,
    },

    badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    badgeText: { fontSize: 11, fontWeight: '500' },
    badgeInProgress: { backgroundColor: 'rgba(212,165,116,0.1)' },
    badgeTextInProgress: { color: '#d4a574' },
    badgeDone: { backgroundColor: 'rgba(92,82,72,0.10)' },
    badgeTextDone: { color: '#5c5248' },
    badgeMuted: { backgroundColor: 'rgba(232,228,221,0.4)' },
    badgeTextMuted: { color: 'rgba(122,115,106,0.6)' },
    metaText: {
        fontSize: 11,
        fontWeight: '500',
        color: '#7a736a',
        fontVariant: ['tabular-nums'],
    },

    addTaskWrap: {
        alignItems: 'flex-start',
    },
    addTaskButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: 12,
        backgroundColor: '#f5f3ef',
    },
    addTaskLabel: {
        fontSize: 14,
        fontWeight: '500',
        color: '#7a736a',
    },

    emptyState: {
        alignItems: 'center',
        paddingVertical: 48,
        gap: 8,
    },
    emptyIconCircle: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: 'rgba(212,165,116,0.12)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 4,
    },
    emptyTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#2a2621',
        letterSpacing: -0.2,
    },
    emptySubtitle: {
        fontSize: 13,
        color: '#7a736a',
        textAlign: 'center',
        lineHeight: 18,
        maxWidth: 240,
    },

    footer: {
        paddingHorizontal: 16,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: 'rgba(42,38,33,0.06)',
    },
    doneButton: {
        backgroundColor: '#2a2621',
        borderRadius: 14,
        paddingVertical: 15,
        alignItems: 'center',
    },
    doneButtonLabel: {
        fontSize: 15,
        fontWeight: '600',
        color: '#fdfcfa',
        letterSpacing: -0.2,
    },

    generateOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#fdfcfa',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 40,
        gap: 12,
    },
    generateErrorIcon: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: 'rgba(212,165,116,0.12)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    generateTitle: {
        fontSize: 17,
        fontWeight: '600',
        color: '#2a2621',
        letterSpacing: -0.3,
        marginTop: 4,
    },
    generateSubtitle: {
        fontSize: 13,
        color: '#7a736a',
        textAlign: 'center',
        lineHeight: 18,
        maxWidth: 260,
    },
    retryButton: {
        backgroundColor: '#2a2621',
        borderRadius: 14,
        paddingVertical: 14,
        paddingHorizontal: 32,
        alignItems: 'center',
        marginTop: 12,
    },
    retryButtonLabel: {
        fontSize: 15,
        fontWeight: '600',
        color: '#fdfcfa',
        letterSpacing: -0.2,
    },
    retryDismiss: {
        fontSize: 14,
        color: '#7a736a',
        marginTop: 4,
    },
    cancelButton: {
        marginTop: 8,
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 12,
        backgroundColor: '#f5f3ef',
    },
    cancelButtonLabel: {
        fontSize: 14,
        fontWeight: '500',
        color: '#7a736a',
    },
});
