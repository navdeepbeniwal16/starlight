import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
    ActivityIndicator,
    Animated,
    Easing,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    type StyleProp,
    type ViewStyle,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../lib/api";
import type { BacklogBuckets, BacklogTask, TaskDetail } from "../../lib/api.types";
import { applyCreated, applyToggle, createSequencer, groupForReconcile } from "../../lib/backlogState";
import { usePlanningStore } from "../../stores/planning.store";
import CreateTaskModal from "../../components/CreateTaskModal";

// pickUp stays open always — it's the one group asking for a decision.
type GroupKey = 'pickUp' | 'everythingElse' | 'doneToday';

const GROUPS: Array<{ key: GroupKey; label: string; collapsible: boolean }> = [
    { key: 'pickUp',         label: 'Pick up where you left off', collapsible: false },
    { key: 'everythingElse', label: 'Everything else',            collapsible: true  },
    { key: 'doneToday',      label: 'Done today',                 collapsible: true  },
];

// Above this, "Everything else" defaults collapsed so the backlog isn't a wall.
const EVERYTHING_ELSE_COLLAPSE_THRESHOLD = 6;

// ─── Motion primitives ────────────────────────────────────────────────────────

// Staggered fade + lift on mount. Splits the list into chunks that enter in
// sequence (~60ms apart) rather than animating the whole container at once.
function EnterView({ index = 0, style, children }: { index?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
    const t = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        const anim = Animated.timing(t, {
            toValue: 1,
            duration: 320,
            delay: index * 60,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        });
        anim.start();
        return () => anim.stop();
    }, [t, index]);
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

function DoneToggle({ task, onDone }: { task: BacklogTask; onDone: (updated: TaskDetail) => void }) {
    const [completing, setCompleting] = useState(false);
    const isDone = task.status === 'DONE' || completing;

    async function handlePress() {
        if (completing || task.status === 'DONE') return;
        setCompleting(true);
        const result = await api.updateTask(task.id, { progress: 100 });
        if (result.ok) {
            setCompleting(false);
            onDone(result.data);
        } else {
            setCompleting(false);
        }
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

// Only in-progress work earns a chip: Todo is the default, Done is already
// carried by the filled check and muted title.
function StatusBadge({ status }: { status: BacklogTask['status'] }) {
    if (status !== 'IN_PROGRESS') return null;
    return (
        <View style={[s.badge, s.badgeInProgress]}>
            <Text style={[s.badgeText, s.badgeTextInProgress]}>In Progress</Text>
        </View>
    );
}

const RING = 30;
const STROKE = 2.5;
const RING_R = (RING - STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_R;

function ProgressRing({ progress }: { progress: number }) {
    const done = progress === 100;
    const fill = done ? '#5c5248' : 'rgba(212,165,116,0.85)';
    const offset = RING_CIRC * (1 - progress / 100);
    return (
        <View style={s.ringWrap}>
            <Svg width={RING} height={RING}>
                <Circle
                    cx={RING / 2} cy={RING / 2} r={RING_R}
                    stroke="rgba(232,228,221,0.7)" strokeWidth={STROKE} fill="none"
                />
                {progress > 0 && (
                    <Circle
                        cx={RING / 2} cy={RING / 2} r={RING_R}
                        stroke={fill} strokeWidth={STROKE} fill="none"
                        strokeDasharray={RING_CIRC} strokeDashoffset={offset}
                        strokeLinecap="round"
                        transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
                    />
                )}
            </Svg>
            <Text style={[s.ringLabel, done && s.ringLabelDone]}>{progress}%</Text>
        </View>
    );
}

function TaskCard({ task, onPress, onDone }: { task: BacklogTask; onPress: () => void; onDone: (updated: TaskDetail) => void }) {
    const progress = task.progress ?? 0;
    const isDone = task.status === 'DONE';
    const showBadge = task.status === 'IN_PROGRESS';
    return (
        <TouchableOpacity style={s.taskCard} activeOpacity={0.7} onPress={onPress}>
            <DoneToggle task={task} onDone={onDone} />
            <View style={s.taskContent}>
                <Text style={[s.taskTitle, isDone && s.taskTitleDone]} numberOfLines={2}>{task.title}</Text>
                {showBadge && (
                    <View style={s.badgeRow}>
                        <StatusBadge status={task.status} />
                    </View>
                )}
            </View>
            {progress > 0 && <ProgressRing progress={progress} />}
        </TouchableOpacity>
    );
}

function GroupHeader({ label, count, collapsible, open, onToggle }: {
    label: string;
    count: number;
    collapsible: boolean;
    open: boolean;
    onToggle: () => void;
}) {
    const header = (
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
    );
    if (!collapsible) return header;
    return (
        <TouchableOpacity onPress={onToggle} activeOpacity={0.6}>
            {header}
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

    const handlePlanDay = useCallback(async () => {
        if (generating) return;
        setGenerating(true);
        setGenerateError(null);
        const result = await api.generatePlan();
        if (result.ok) {
            setProposal(result.data);
            setGenerating(false);
            router.push('/planning/plan');
        } else {
            setGenerating(false);
            setGenerateError(result.error);
        }
    }, [generating, router, setProposal]);

    // Refetch on focus so edits made on the task detail screen reflect here.
    useFocusEffect(
        useCallback(() => { loadBuckets(true); }, [loadBuckets])
    );

    function handleDone(task: BacklogTask, updated: TaskDetail) {
        if (!buckets) return;
        const { buckets: next } = applyToggle(buckets, task, updated);
        setBuckets(next);
        loadBuckets(false);
    }

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
                <Text style={s.headerTitle}>Plan day</Text>
                <TouchableOpacity
                    onPress={() => router.back()}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    activeOpacity={0.6}
                >
                    <Ionicons name="close" size={22} color="#2a2621" />
                </TouchableOpacity>
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
                                                    <TaskCard
                                                        task={task}
                                                        onPress={() => router.push(`/task/${task.id}?from=Review`)}
                                                        onDone={(updated) => handleDone(task, updated)}
                                                    />
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
                            <Text style={s.generateTitle}>Building your plan</Text>
                            <Text style={s.generateSubtitle}>The agent is scheduling your tasks into the day.</Text>
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
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: 24,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(42,38,33,0.06)',
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#2a2621',
        letterSpacing: -0.3,
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

    section: {
        gap: 10,
    },
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
        borderRadius: 16,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    taskContent: {
        flex: 1,
        gap: 8,
    },
    taskTitle: {
        fontSize: 15,
        fontWeight: '500',
        color: '#2a2621',
        letterSpacing: -0.23,
    },
    taskTitleDone: { color: '#7a736a' },
    badgeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
    },

    badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    badgeText: { fontSize: 11, fontWeight: '500' },
    badgeInProgress: { backgroundColor: 'rgba(212,165,116,0.1)' },
    badgeTextInProgress: { color: '#d4a574' },

    ringWrap: {
        width: RING,
        height: RING,
        justifyContent: 'center',
        alignItems: 'center',
    },
    ringLabel: {
        position: 'absolute',
        fontSize: 7,
        fontWeight: '600',
        color: 'rgba(122,115,106,0.5)',
        fontVariant: ['tabular-nums'],
    },
    ringLabelDone: { color: '#5c5248' },

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
});
