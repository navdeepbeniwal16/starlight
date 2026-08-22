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
import { api } from "../lib/api";
import type { BacklogTask, TaskDetail } from "../lib/api.types";
import { createSequencer } from "../lib/backlogState";

const EASE = Easing.bezier(0.2, 0, 0, 1);
const CARD_LAYOUT = LinearTransition.duration(260).easing(EASE.factory());

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

function TaskCard({ task, index, onPress, onToggled }: {
    task: BacklogTask;
    index: number;
    onPress: () => void;
    onToggled: (updated: TaskDetail) => void;
}) {
    const isDone = task.status === 'DONE';
    return (
        <Animated.View
            entering={FadeIn.duration(180).delay(Math.min(index * 30, 240))}
            exiting={FadeOut.duration(120)}
            layout={CARD_LAYOUT}
        >
            <ScaleOnPress onPress={onPress} style={[styles.taskCard, isDone && styles.taskCardDone]}>
                <DoneToggle task={task} onToggled={onToggled} />
                <View style={styles.taskCardContent}>
                    <Text style={[styles.taskTitle, isDone && styles.taskTitleDone]} numberOfLines={2}>
                        {task.title}
                    </Text>
                    <View style={styles.badgeRow}>
                        <StatusBadge status={task.status} />
                        {task.deadline && (
                            <Text style={styles.metaText}>{formatDeadline(task.deadline)}</Text>
                        )}
                    </View>
                </View>
                <CircularProgress progress={task.progress ?? 0} />
            </ScaleOnPress>
        </Animated.View>
    );
}

export default function AllTasksScreen() {
    const router = useRouter();
    const [tasks, setTasks] = useState<BacklogTask[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Only the most recently issued fetch may apply its result, so an out-of-order
    // response can't clobber fresher state or a pending optimistic update.
    const seq = useRef(createSequencer()).current;

    // `showLoading` drives the full-screen loader/error (first load, refocus);
    // silent refreshes pass false so a toggle reconciles without a flash.
    const loadTasks = useCallback((showLoading: boolean) => {
        const token = seq.next();
        if (showLoading) { setLoading(true); setError(null); }
        api.getAllTasks().then(result => {
            if (showLoading) setLoading(false);
            if (!seq.isCurrent(token)) return;
            if (!result.ok) { if (showLoading) setError(result.error); return; }
            setTasks(result.data);
        });
    }, [seq]);

    useFocusEffect(
        useCallback(() => { loadTasks(true); }, [loadTasks])
    );

    function handleToggled(taskId: string, updated: TaskDetail) {
        setTasks(prev => prev?.map(t => (t.id === taskId ? { ...t, ...updated } : t)) ?? prev);
        loadTasks(false);   // reconcile ordering (updatedAt moved) from the server
    }

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <View style={styles.backRow}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.7}>
                    <Ionicons name="chevron-back" size={20} color="#7a736a" />
                    <Text style={styles.backLabel}>Backlog</Text>
                </TouchableOpacity>
            </View>
            <View style={styles.titleRow}>
                <Text style={styles.headerTitle}>All tasks</Text>
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

            {!loading && !error && tasks !== null && tasks.length === 0 && (
                <View style={styles.centered}>
                    <View style={styles.illustration}>
                        <Ionicons name="list-outline" size={64} color="rgba(42,38,33,0.18)" />
                    </View>
                    <Text style={styles.emptyTitle}>No tasks yet</Text>
                    <Text style={styles.emptySubtitle}>Tasks you create will show up here, newest first</Text>
                </View>
            )}

            {!loading && !error && tasks !== null && tasks.length > 0 && (
                <ScrollView
                    contentContainerStyle={styles.list}
                    showsVerticalScrollIndicator={false}
                >
                    {tasks.map((task, i) => (
                        <TaskCard
                            key={task.id}
                            task={task}
                            index={i}
                            onPress={() => router.push(`/task/${task.id}?from=All tasks`)}
                            onToggled={(updated) => handleToggled(task.id, updated)}
                        />
                    ))}
                </ScrollView>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: '#fdfcfa' },

    backRow: { paddingHorizontal: 12, paddingTop: 20, paddingBottom: 2 },
    backButton: {
        flexDirection: 'row', alignItems: 'center', gap: 2,
        alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 4,
    },
    backLabel: { fontSize: 15, color: '#7a736a' },
    titleRow: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
    headerTitle: { fontSize: 18, fontWeight: '600', color: '#2a2621', letterSpacing: -0.3 },

    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
    errorText: { fontSize: 14, color: '#7a736a', textAlign: 'center' },

    illustration: { alignItems: 'center', justifyContent: 'center', marginBottom: 24, height: 80 },
    emptyTitle: { fontSize: 20, fontWeight: '500', color: '#2a2621', marginBottom: 8 },
    emptySubtitle: {
        fontSize: 14,
        color: '#7a736a',
        textAlign: 'center',
        maxWidth: 220,
    },

    list: { padding: 16, gap: 8, paddingBottom: 32 },

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
});
