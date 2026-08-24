import { useCallback, useEffect, useRef, useState } from "react";
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Pressable,
    ActivityIndicator,
    Alert,
} from "react-native";
import Animated, {
    Easing,
    FadeIn,
    FadeOut,
    LinearTransition,
    useAnimatedStyle,
    useSharedValue,
    withSequence,
    withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../lib/api";
import type { BacklogTask, BacklogBuckets, ScheduledTask, TaskDetail } from "../../lib/api.types";
import { formatTime } from "../../lib/time";
import { applyCreated, applyToggle, bucketOf, createSequencer } from "../../lib/backlogState";
import CreateTaskModal from "../../components/CreateTaskModal";

// Shared motion constants. The standard curve is interruptible and settles calmly.
const EASE = Easing.bezier(0.2, 0, 0, 1);
const SECTION_LAYOUT = LinearTransition.duration(260).easing(EASE.factory());

// The four lifecycle sections, in fixed display order. Bucket membership and
// ordering are computed server-side; this screen just renders what it gets.
// Collapse state is seeded from these defaults and then persists across visits.
type SectionKey = keyof BacklogBuckets;

const SECTIONS: Array<{ key: SectionKey; label: string; description: string; hint: string; defaultOpen: boolean }> = [
    { key: 'carriedOver', label: 'Carried over',    description: 'Unfinished tasks carried over from your previous plan', hint: 'Nothing carried over',  defaultOpen: true },
    { key: 'scheduled',   label: 'Scheduled today', description: "Tasks planned into today's blocks",                     hint: 'No plan for today yet', defaultOpen: true },
    { key: 'remaining',   label: 'Remaining',       description: 'Backlog tasks not yet scheduled',                       hint: 'Backlog is clear',      defaultOpen: false },
    { key: 'doneToday',   label: 'Done today',      description: "Tasks you've completed today",                          hint: 'Nothing completed yet', defaultOpen: false },
];

const DEFAULT_OPEN = Object.fromEntries(
    SECTIONS.map(s => [s.key, s.defaultOpen])
) as Record<SectionKey, boolean>;

function formatDeadline(isoString: string): string {
    const d = new Date(isoString);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    // Deadlines are stored at UTC midnight; read in UTC so the date doesn't shift a day back west of UTC.
    return `Due ${months[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// Subtle press-down; 0.96 reads as tactile without feeling exaggerated.
function ScaleOnPress({ onPress, style, children }: {
    onPress: () => void;
    style?: object;
    children: React.ReactNode;
}) {
    const pressed = useSharedValue(0);
    const animated = useAnimatedStyle(() => ({
        transform: [{ scale: 1 - 0.04 * pressed.value }],
    }));
    return (
        <Pressable
            onPress={onPress}
            onPressIn={() => { pressed.value = withTiming(1, { duration: 110, easing: EASE }); }}
            onPressOut={() => { pressed.value = withTiming(0, { duration: 180, easing: EASE }); }}
        >
            <Animated.View style={[style, animated]}>{children}</Animated.View>
        </Pressable>
    );
}

function DoneToggle({ task, onToggled }: { task: BacklogTask; onToggled: (updated: TaskDetail) => void }) {
    const [busy, setBusy] = useState(false);
    const isDone = task.status === 'DONE';

    // Cross-fade between two mounted icons (outline + filled) rather than swapping.
    const done = useSharedValue(isDone ? 1 : 0);
    useEffect(() => {
        done.value = withTiming(isDone ? 1 : 0, { duration: 240, easing: EASE });
    }, [isDone, done]);

    const outlineStyle = useAnimatedStyle(() => ({ opacity: 1 - done.value }));
    const filledStyle = useAnimatedStyle(() => ({
        opacity: done.value,
        transform: [{ scale: 0.25 + 0.75 * done.value }],
    }));

    async function handlePress() {
        if (busy) return;
        setBusy(true);
        // Reopening reverts to 75%, matching the task detail screen's toggle.
        const result = await api.updateTask(task.id, { progress: isDone ? 75 : 100 });
        setBusy(false);
        if (result.ok) {
            onToggled(result.data);
        } else {
            // The ring animates back on its own (status is unchanged); tell the user why.
            Alert.alert("Couldn't update task", 'Please check your connection and try again.');
        }
    }

    return (
        <TouchableOpacity
            onPress={handlePress}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.6}
        >
            <View style={styles.toggleStack}>
                <Animated.View style={outlineStyle}>
                    <Ionicons name="checkmark-circle-outline" size={22} color="rgba(122,115,106,0.3)" />
                </Animated.View>
                <Animated.View style={[styles.toggleFilled, filledStyle]}>
                    <Ionicons name="checkmark-circle" size={22} color="#5c5248" />
                </Animated.View>
            </View>
        </TouchableOpacity>
    );
}

function StatusBadge({ status }: { status: BacklogTask['status'] }) {
    const inProgress = status === 'IN_PROGRESS';
    const done = status === 'DONE';
    const label = done ? 'Done' : inProgress ? 'In Progress' : 'Todo';
    const badgeStyle = inProgress ? styles.badgeInProgress : done ? styles.badgeDone : styles.badgeMuted;
    const textStyle = inProgress ? styles.badgeTextInProgress : done ? styles.badgeTextDone : styles.badgeTextMuted;
    return (
        <View style={[styles.badge, badgeStyle]}>
            <Text style={[styles.badgeText, textStyle]}>{label}</Text>
        </View>
    );
}

const RING_SIZE = 32;
const RING_STROKE = 2.5;
const RING_R = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_R;

function CircularProgress({ progress }: { progress: number }) {
    const isDone = progress === 100;
    const fillColor = isDone ? '#5c5248' : 'rgba(212,165,116,0.85)';
    const offset = RING_CIRC * (1 - progress / 100);
    return (
        <View style={styles.ringWrap}>
            <Svg width={RING_SIZE} height={RING_SIZE}>
                <Circle
                    cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_R}
                    stroke="rgba(232,228,221,0.7)" strokeWidth={RING_STROKE} fill="none"
                />
                {progress > 0 && (
                    <Circle
                        cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_R}
                        stroke={fillColor} strokeWidth={RING_STROKE} fill="none"
                        strokeDasharray={RING_CIRC} strokeDashoffset={offset}
                        strokeLinecap="round"
                        transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
                    />
                )}
            </Svg>
            <Text style={[styles.ringLabel, isDone && styles.ringLabelDone]}>
                {progress}%
            </Text>
        </View>
    );
}

function TaskCard({ task, scheduledMeta, index, justArrived, onPress, onToggled }: {
    task: BacklogTask;
    scheduledMeta?: string;
    index: number;
    justArrived: boolean;
    onPress: () => void;
    onToggled: (updated: TaskDetail) => void;
}) {
    const isDone = task.status === 'DONE';

    const wash = useSharedValue(0);
    const pop = useSharedValue(0);
    useEffect(() => {
        if (!justArrived) return;
        wash.value = 1;
        wash.value = withTiming(0, { duration: 1300, easing: Easing.inOut(Easing.quad) });
        pop.value = withSequence(
            withTiming(1, { duration: 220, easing: EASE }),
            withTiming(0, { duration: 560, easing: EASE }),
        );
    }, [justArrived, wash, pop]);

    const washStyle = useAnimatedStyle(() => ({ opacity: wash.value }));
    const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.03 * pop.value }] }));

    return (
        <Animated.View
            entering={FadeIn.duration(180).delay(Math.min(index * 30, 240))}
            exiting={FadeOut.duration(120)}
            layout={SECTION_LAYOUT}
        >
          <Animated.View style={popStyle}>
            <ScaleOnPress onPress={onPress} style={[styles.taskCard, isDone && styles.taskCardDone]}>
                <Animated.View pointerEvents="none" style={[styles.arrivalWash, washStyle]} />
                <DoneToggle task={task} onToggled={onToggled} />
                <View style={styles.taskCardContent}>
                    <Text style={[styles.taskTitle, isDone && styles.taskTitleDone]} numberOfLines={2}>
                        {task.title}
                    </Text>
                    <View style={styles.badgeRow}>
                        <StatusBadge status={task.status} />
                        {scheduledMeta ? (
                            <Text style={styles.metaText}>{scheduledMeta}</Text>
                        ) : task.deadline && (
                            <Text style={styles.metaText}>{formatDeadline(task.deadline)}</Text>
                        )}
                    </View>
                </View>
                <CircularProgress progress={task.progress ?? 0} />
            </ScaleOnPress>
          </Animated.View>
        </Animated.View>
    );
}

function SectionHeader({ label, count, open, justReceived, onToggle }: {
    label: string;
    count: number;
    open: boolean;
    justReceived: boolean;
    onToggle: () => void;
}) {
    const rotation = useSharedValue(open ? 90 : 0);
    useEffect(() => {
        rotation.value = withTiming(open ? 90 : 0, { duration: 200, easing: EASE });
    }, [open, rotation]);
    const chevronStyle = useAnimatedStyle(() => ({
        transform: [{ rotate: `${rotation.value}deg` }],
    }));

    // The count of the section a task just moved into pulses, so a change in a
    // collapsed section still registers.
    const countPop = useSharedValue(0);
    useEffect(() => {
        if (!justReceived) return;
        countPop.value = withSequence(
            withTiming(1, { duration: 200, easing: EASE }),
            withTiming(0, { duration: 420, easing: EASE }),
        );
    }, [justReceived, countPop]);
    const countStyle = useAnimatedStyle(() => ({
        transform: [{ scale: 1 + 0.24 * countPop.value }],
    }));

    return (
        <TouchableOpacity
            style={styles.sectionHeaderRow}
            onPress={onToggle}
            activeOpacity={0.6}
        >
            <Animated.View style={chevronStyle}>
                <Ionicons name="chevron-forward" size={13} color="rgba(122,115,106,0.6)" />
            </Animated.View>
            <Text style={styles.sectionLabel}>{label}</Text>
            <Animated.Text style={[styles.sectionCount, countStyle]}>{count}</Animated.Text>
        </TouchableOpacity>
    );
}

function EmptyIllustration() {
    return (
        <View style={styles.illustration}>
            <Ionicons name="list-outline" size={64} color="rgba(42,38,33,0.18)" />
        </View>
    );
}

export default function BacklogScreen() {
    const router = useRouter();
    const [buckets, setBuckets] = useState<BacklogBuckets | null>(null);
    const [open, setOpen] = useState<Record<SectionKey, boolean>>(DEFAULT_OPEN);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);

    // Which task/section just received a move, for the landing cue. Cleared on a
    // timer so a later refresh re-rendering the same card doesn't replay it.
    const [arrivedTaskId, setArrivedTaskId] = useState<string | null>(null);
    const [receivedSection, setReceivedSection] = useState<SectionKey | null>(null);
    const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

    const flashArrival = useCallback((taskId: string, dest: SectionKey) => {
        setArrivedTaskId(taskId);
        setReceivedSection(dest);
        setOpen(prev => (prev[dest] ? prev : { ...prev, [dest]: true }));
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => {
            setArrivedTaskId(null);
            setReceivedSection(null);
        }, 1300);
    }, []);

    // A move whose destination the client can't predict (a reopen lands in its
    // plan bucket, known only server-side); the next refresh flashes wherever it
    // actually reconciled, so the cue is consistent regardless of destination.
    const pendingArrival = useRef<string | null>(null);

    // Only the most recently issued fetch may apply its result, so an out-of-order
    // response can't clobber fresher state or a pending optimistic update.
    const seq = useRef(createSequencer()).current;

    // `showLoading` drives the full-screen loader/error (first load, refocus);
    // silent refreshes pass false so optimistic updates reconcile without a flash.
    const loadBuckets = useCallback((showLoading: boolean) => {
        const token = seq.next();
        if (showLoading) { setLoading(true); setError(null); }
        api.getBacklog().then(result => {
            if (showLoading) setLoading(false);   // clear the spinner even if superseded
            if (!seq.isCurrent(token)) return;     // a newer fetch owns the data
            if (!result.ok) { if (showLoading) setError(result.error); return; }
            setBuckets(result.data);
            const pending = pendingArrival.current;
            if (pending) {
                pendingArrival.current = null;
                const landed = bucketOf(result.data, pending);
                if (landed) flashArrival(pending, landed);
            }
        });
    }, [seq, flashArrival]);

    useFocusEffect(
        useCallback(() => { loadBuckets(true); }, [loadBuckets])
    );

    function handleToggled(task: BacklogTask, updated: TaskDetail) {
        if (!buckets) return;
        const { buckets: next, dest, settled } = applyToggle(buckets, task, updated);
        setBuckets(next);
        if (settled) flashArrival(task.id, dest);
        else pendingArrival.current = task.id;   // reveal wherever the refresh reconciles it
        loadBuckets(false);
    }

    const taskCount = buckets
        ? SECTIONS.reduce((sum, s) => sum + buckets[s.key].length, 0)
        : 0;
    const showFab = !loading && !error;

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Backlog</Text>
                <TouchableOpacity
                    style={styles.seeAllLink}
                    activeOpacity={0.6}
                    onPress={() => router.push('/tasks')}
                >
                    <Text style={styles.seeAllText}>See all</Text>
                    <Ionicons name="chevron-forward" size={14} color="#b07841" />
                </TouchableOpacity>
            </View>

            {loading && (
                <View style={styles.centered}>
                    <ActivityIndicator color="#d4a574" />
                </View>
            )}

            {!loading && error && (
                <View style={styles.centered}>
                    <Text style={styles.errorText}>{error}</Text>
                </View>
            )}

            {!loading && !error && buckets !== null && taskCount === 0 && (
                <View style={styles.centered}>
                    <EmptyIllustration />
                    <Text style={styles.emptyTitle}>Your backlog is clear</Text>
                    <Text style={styles.emptySubtitle}>Add tasks you want to track and schedule into your days</Text>
                </View>
            )}

            {!loading && !error && buckets !== null && taskCount > 0 && (
                <ScrollView
                    contentContainerStyle={styles.list}
                    showsVerticalScrollIndicator={false}
                >
                    {SECTIONS.map((section, si) => {
                        const tasks = buckets[section.key];
                        const isOpen = open[section.key];
                        return (
                            <Animated.View
                                key={section.key}
                                style={styles.zone}
                                entering={FadeIn.duration(220).delay(si * 70)}
                                layout={SECTION_LAYOUT}
                            >
                                <View>
                                    <SectionHeader
                                        label={section.label}
                                        count={tasks.length}
                                        open={isOpen}
                                        justReceived={receivedSection === section.key}
                                        onToggle={() => setOpen(prev => ({ ...prev, [section.key]: !prev[section.key] }))}
                                    />
                                    <Text style={styles.sectionDescription}>{section.description}</Text>
                                </View>
                                {isOpen && (
                                    tasks.length === 0 ? (
                                        <Text style={styles.sectionHint}>{section.hint}</Text>
                                    ) : (
                                        <View style={styles.cardGroup}>
                                            {tasks.map((task, i) => (
                                                <TaskCard
                                                    key={task.id}
                                                    task={task}
                                                    index={i}
                                                    justArrived={task.id === arrivedTaskId}
                                                    scheduledMeta={section.key === 'scheduled'
                                                        ? `${formatTime((task as ScheduledTask).blockStartTime)} · ${(task as ScheduledTask).blockName}`
                                                        : undefined}
                                                    onPress={() => router.push(`/task/${task.id}`)}
                                                    onToggled={(updated) => handleToggled(task, updated)}
                                                />
                                            ))}
                                        </View>
                                    )
                                )}
                            </Animated.View>
                        );
                    })}
                </ScrollView>
            )}

            {showFab && (
                <View style={styles.fabWrap}>
                    <ScaleOnPress onPress={() => setShowCreateModal(true)} style={styles.fab}>
                        <Ionicons name="add" size={24} color="#2a2621" />
                    </ScaleOnPress>
                </View>
            )}

            <CreateTaskModal
                visible={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                onCreated={(task) => {
                    if (buckets) {
                        const { buckets: next, dest } = applyCreated(buckets, task);
                        setBuckets(next);
                        flashArrival(task.id, dest);
                    }
                    loadBuckets(false);
                    setShowCreateModal(false);
                }}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: '#fdfcfa' },

    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(42,38,33,0.06)',
    },
    headerTitle: { fontSize: 18, fontWeight: '600', color: '#2a2621', letterSpacing: -0.3 },
    seeAllLink: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
    seeAllText: { fontSize: 14, fontWeight: '500', color: '#b07841', letterSpacing: -0.15 },

    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    errorText: { fontSize: 14, color: '#7a736a', textAlign: 'center' },

    illustration: { alignItems: 'center', justifyContent: 'center', marginBottom: 24, height: 80 },
    emptyTitle: { fontSize: 20, fontWeight: '500', color: '#2a2621', marginBottom: 8 },
    emptySubtitle: {
        fontSize: 14,
        color: '#7a736a',
        textAlign: 'center',
        maxWidth: 220,
        marginBottom: 20,
    },
    list: { padding: 16, gap: 14, paddingBottom: 96 },

    zone: { gap: 10 },

    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 40,
        marginVertical: -8,  // visual rhythm stays tight while the hit area spans 40px
    },
    sectionLabel: {
        fontSize: 11,
        color: 'rgba(122,115,106,0.5)',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
    },
    sectionCount: {
        fontSize: 11,
        color: 'rgba(122,115,106,0.75)',
        fontWeight: '600',
        fontVariant: ['tabular-nums'],
    },
    sectionDescription: { fontSize: 12, color: 'rgba(122,115,106,0.7)', marginLeft: 19, letterSpacing: -0.1 },
    sectionHint: { fontSize: 12, color: 'rgba(122,115,106,0.45)', fontStyle: 'italic', marginLeft: 19 },
    cardGroup: { gap: 8 },

    taskCard: {
        backgroundColor: '#fffef9',
        borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.10)',
        borderRadius: 14,
        paddingHorizontal: 13,
        paddingVertical: 11,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    taskCardDone: { backgroundColor: 'rgba(232,228,221,0.35)' },
    arrivalWash: {
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        borderRadius: 14,   // matches taskCard so the wash tracks the rounded edge
        backgroundColor: 'rgba(212,165,116,0.28)',
    },
    taskCardContent: { flex: 1 },
    taskTitle: { fontSize: 14, fontWeight: '500', color: '#2a2621', letterSpacing: -0.15 },
    taskTitleDone: { color: '#7a736a' },
    badgeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 6,
    },

    toggleStack: { width: 22, height: 22 },
    toggleFilled: { position: 'absolute', top: 0, left: 0 },

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

    ringWrap: {
        width: RING_SIZE, height: RING_SIZE,
        justifyContent: 'center', alignItems: 'center',
    },
    ringLabel: {
        position: 'absolute',
        fontSize: 7, fontWeight: '600',
        color: 'rgba(122,115,106,0.5)',
        fontVariant: ['tabular-nums'],
    },
    ringLabelDone: { color: '#5c5248' },

    fabWrap: {
        position: 'absolute',
        bottom: 16,
        right: 16,
    },
    fab: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#ffffff',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#2a2621',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 10,
        elevation: 4,
    },
});
