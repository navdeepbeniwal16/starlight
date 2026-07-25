import { useCallback, useEffect, useRef, useState } from "react";
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Pressable,
    ActivityIndicator,
} from "react-native";
import Animated, {
    Easing,
    FadeIn,
    FadeOut,
    LinearTransition,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../lib/api";
import type { BacklogTask, BacklogBuckets, ScheduledTask, TaskDetail, Priority } from "../../lib/api.types";
import { formatTime } from "../../lib/time";
import { applyCreated, applyToggle, createSequencer } from "../../lib/backlogState";
import CreateTaskModal from "../../components/CreateTaskModal";

// Shared motion constants. The standard curve is interruptible and settles calmly.
const EASE = Easing.bezier(0.2, 0, 0, 1);
const SECTION_LAYOUT = LinearTransition.duration(220).easing(EASE.factory());

// The four lifecycle sections, in fixed display order. Bucket membership and
// ordering are computed server-side; this screen just renders what it gets.
// Collapse state is seeded from these defaults and then persists across visits.
type SectionKey = keyof BacklogBuckets;

const SECTIONS: Array<{ key: SectionKey; label: string; hint: string; defaultOpen: boolean }> = [
    { key: 'carriedOver', label: 'Carried over',    hint: 'Nothing carried over',  defaultOpen: true },
    { key: 'scheduled',   label: 'Scheduled today', hint: 'No plan for today yet', defaultOpen: true },
    { key: 'remaining',   label: 'Remaining',       hint: 'Backlog is clear',      defaultOpen: false },
    { key: 'doneToday',   label: 'Done today',      hint: 'Nothing completed yet', defaultOpen: false },
];

const DEFAULT_OPEN = Object.fromEntries(
    SECTIONS.map(s => [s.key, s.defaultOpen])
) as Record<SectionKey, boolean>;

function formatDeadline(isoString: string): string {
    const d = new Date(isoString);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `Due ${months[d.getMonth()]} ${d.getDate()}`;
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
        if (result.ok) onToggled(result.data);
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

function PriorityBadge({ priority }: { priority: Priority }) {
    const label = priority === 'HIGH' ? 'High priority' : priority === 'MEDIUM' ? 'Med priority' : 'Low priority';
    return (
        <View style={[styles.badge, styles.badgeMuted]}>
            <Text style={[styles.badgeText, styles.badgeTextMuted]}>{label}</Text>
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

function TaskCard({ task, scheduledMeta, index, onPress, onToggled }: {
    task: BacklogTask;
    scheduledMeta?: string;
    index: number;
    onPress: () => void;
    onToggled: (updated: TaskDetail) => void;
}) {
    const isDone = task.status === 'DONE';
    return (
        <Animated.View
            entering={FadeIn.duration(180).delay(Math.min(index * 30, 240))}
            exiting={FadeOut.duration(120)}
            layout={SECTION_LAYOUT}
        >
            <ScaleOnPress onPress={onPress} style={styles.taskCard}>
                <DoneToggle task={task} onToggled={onToggled} />
                <View style={styles.taskCardContent}>
                    <Text style={[styles.taskTitle, isDone && styles.taskTitleDone]} numberOfLines={2}>
                        {task.title}
                    </Text>
                    <View style={styles.badgeRow}>
                        <StatusBadge status={task.status} />
                        {task.priority && <PriorityBadge priority={task.priority} />}
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
    );
}

function SectionHeader({ label, count, open, onToggle }: {
    label: string;
    count: number;
    open: boolean;
    onToggle: () => void;
}) {
    const rotation = useSharedValue(open ? 90 : 0);
    useEffect(() => {
        rotation.value = withTiming(open ? 90 : 0, { duration: 200, easing: EASE });
    }, [open, rotation]);
    const chevronStyle = useAnimatedStyle(() => ({
        transform: [{ rotate: `${rotation.value}deg` }],
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
            <Text style={styles.sectionCount}>{count}</Text>
        </TouchableOpacity>
    );
}

function EmptyIllustration() {
    return (
        <View style={styles.illustration}>
            <View style={[styles.illustrationCard, { transform: [{ rotate: '-4deg' }], opacity: 0.15 }]} />
            <View style={[styles.illustrationCard, { transform: [{ rotate: '2deg' }], opacity: 0.25, marginTop: -28 }]} />
            <View style={[styles.illustrationCard, { opacity: 0.4, marginTop: -28 }]} />
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
            if (result.ok) setBuckets(result.data);
            else if (showLoading) setError(result.error);
        });
    }, [seq]);

    useFocusEffect(
        useCallback(() => { loadBuckets(true); }, [loadBuckets])
    );

    function handleToggled(task: BacklogTask, updated: TaskDetail) {
        setBuckets(prev => prev ? applyToggle(prev, task, updated) : prev);
        loadBuckets(false);
    }

    const taskCount = buckets
        ? SECTIONS.reduce((sum, s) => sum + buckets[s.key].length, 0)
        : 0;
    const showFab = !loading && !error;

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Backlog</Text>
                {buckets !== null && (
                    <Text style={styles.headerCount}>
                        {taskCount === 1 ? '1 task' : `${taskCount} tasks`}
                    </Text>
                )}
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
                    <Text style={styles.emptySubtitle}>Add tasks to track and prioritise your work</Text>
                    <TouchableOpacity
                        style={styles.addFirstButton}
                        onPress={() => setShowCreateModal(true)}
                    >
                        <Ionicons name="add" size={16} color="rgba(42,38,33,0.7)" />
                        <Text style={styles.addFirstLabel}>Add your first task</Text>
                    </TouchableOpacity>
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
                        const muted = section.key === 'doneToday';
                        return (
                            <Animated.View
                                key={section.key}
                                style={[styles.zone, muted && styles.zoneMuted]}
                                entering={FadeIn.duration(220).delay(si * 70)}
                                layout={SECTION_LAYOUT}
                            >
                                <SectionHeader
                                    label={section.label}
                                    count={tasks.length}
                                    open={isOpen}
                                    onToggle={() => setOpen(prev => ({ ...prev, [section.key]: !prev[section.key] }))}
                                />
                                {tasks.length === 0 ? (
                                    <Text style={styles.sectionHint}>{section.hint}</Text>
                                ) : isOpen && (
                                    <View style={styles.cardGroup}>
                                        {tasks.map((task, i) => (
                                            <TaskCard
                                                key={task.id}
                                                task={task}
                                                index={i}
                                                scheduledMeta={section.key === 'scheduled'
                                                    ? `${formatTime((task as ScheduledTask).blockStartTime)} · ${(task as ScheduledTask).blockName}`
                                                    : undefined}
                                                onPress={() => router.push(`/task/${task.id}`)}
                                                onToggled={(updated) => handleToggled(task, updated)}
                                            />
                                        ))}
                                    </View>
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
                    setBuckets(prev => prev ? applyCreated(prev, task) : prev);
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
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(42,38,33,0.06)',
    },
    headerTitle: { fontSize: 18, fontWeight: '600', color: '#2a2621', letterSpacing: -0.3 },
    headerCount: { fontSize: 14, color: '#7a736a', marginTop: 2, fontVariant: ['tabular-nums'] },

    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    errorText: { fontSize: 14, color: '#7a736a', textAlign: 'center' },

    illustration: { alignItems: 'center', marginBottom: 24, height: 80 },
    illustrationCard: {
        width: 120,
        height: 36,
        backgroundColor: '#2a2621',
        borderRadius: 10,
    },
    emptyTitle: { fontSize: 20, fontWeight: '500', color: '#2a2621', marginBottom: 8 },
    emptySubtitle: {
        fontSize: 14,
        color: '#7a736a',
        textAlign: 'center',
        maxWidth: 220,
        marginBottom: 20,
    },
    addFirstButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#f5f3ef',
        borderRadius: 16,
        paddingHorizontal: 20,
        paddingVertical: 12,
    },
    addFirstLabel: { fontSize: 14, fontWeight: '500', color: 'rgba(42,38,33,0.7)' },

    list: { padding: 16, gap: 14, paddingBottom: 96 },

    // Each lifecycle section is a surface; Done recedes on a muted wash.
    zone: {
        backgroundColor: '#fffef9',
        borderRadius: 16,
        padding: 14,
        gap: 10,
    },
    zoneMuted: { backgroundColor: 'rgba(232,228,221,0.25)' },

    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 40,
        marginVertical: -8,  // visual rhythm stays tight while the hit area spans 40px
    },
    sectionLabel: {
        fontSize: 11,
        color: 'rgba(122,115,106,0.55)',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
    },
    sectionCount: {
        fontSize: 11,
        color: 'rgba(122,115,106,0.75)',
        fontWeight: '600',
        fontVariant: ['tabular-nums'],
    },
    sectionHint: { fontSize: 13, color: 'rgba(122,115,106,0.5)', fontStyle: 'italic' },
    cardGroup: { gap: 8 },

    taskCard: {
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.08)',
        borderRadius: 14,
        padding: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    taskCardContent: { flex: 1 },
    taskTitle: { fontSize: 15, fontWeight: '500', color: '#2a2621', letterSpacing: -0.23 },
    taskTitleDone: { color: '#7a736a', textDecorationLine: 'line-through' },
    badgeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 8,
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
        color: 'rgba(122,115,106,0.5)',
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
        bottom: 24,
        right: 20,
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
