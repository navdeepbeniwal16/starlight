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
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../lib/api";
import type { Priority, ReviewTask, TaskDetail } from "../../lib/api.types";
import CreateTaskModal from "../../components/CreateTaskModal";

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

function DoneToggle({ task, onDone }: { task: ReviewTask; onDone: (updated: TaskDetail) => void }) {
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

function StatusBadge({ status }: { status: ReviewTask['status'] }) {
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

function PriorityBadge({ priority }: { priority: Priority }) {
    const label = priority === 'HIGH' ? 'High' : priority === 'MEDIUM' ? 'Med' : 'Low';
    return (
        <View style={[s.badge, s.badgeMuted]}>
            <Text style={[s.badgeText, s.badgeTextMuted]}>{label} priority</Text>
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

function TaskCard({ task, onPress, onDone }: { task: ReviewTask; onPress: () => void; onDone: (updated: TaskDetail) => void }) {
    return (
        <TouchableOpacity style={s.taskCard} activeOpacity={0.7} onPress={onPress}>
            <DoneToggle task={task} onDone={onDone} />
            <View style={s.taskContent}>
                <Text style={s.taskTitle} numberOfLines={2}>{task.title}</Text>
                <View style={s.badgeRow}>
                    <StatusBadge status={task.status} />
                    {task.priority && <PriorityBadge priority={task.priority} />}
                </View>
            </View>
            <ProgressRing progress={task.progress ?? 0} />
        </TouchableOpacity>
    );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PlanningReviewScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { planId } = useLocalSearchParams<{ planId: string }>();

    const [carriedOver, setCarriedOver] = useState<ReviewTask[] | null>(null);
    const [backlog, setBacklog] = useState<ReviewTask[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);

    // Refetch whenever the screen regains focus (e.g. returning from task detail)
    // so edits made there are reflected on the review cards. The full-screen
    // loader only shows on the first load (carriedOver === null).
    useFocusEffect(
        useCallback(() => {
            if (!planId) return;
            let active = true;
            api.getPlanTasks(planId).then(result => {
                if (!active) return;
                if (result.ok) {
                    setCarriedOver(result.data.carriedOver);
                    setBacklog(result.data.backlog);
                    setError(null);
                } else {
                    setError(result.error);
                }
            });
            return () => { active = false; };
        }, [planId])
    );

    function patchTask(section: 'carriedOver' | 'backlog', taskId: string, updated: TaskDetail) {
        const patch = (tasks: ReviewTask[]) =>
            tasks.map(t => t.id === taskId ? { ...t, status: updated.status, progress: updated.progress } : t);
        if (section === 'carriedOver') setCarriedOver(prev => prev ? patch(prev) : prev);
        else setBacklog(prev => patch(prev));
    }

    const loading = carriedOver === null && !error;
    const carried = carriedOver ?? [];
    const isEmpty = carried.length === 0 && backlog.length === 0;

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

            {!loading && !error && (
                <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
                    {isEmpty && (
                        <EnterView style={s.emptyState}>
                            <View style={s.emptyIconCircle}>
                                <Ionicons name="sparkles-outline" size={20} color="#d4a574" />
                            </View>
                            <Text style={s.emptyTitle}>Nothing to review</Text>
                            <Text style={s.emptySubtitle}>Add a task below, or proceed to let the agent plan your day.</Text>
                        </EnterView>
                    )}

                    {carried.length > 0 && (
                        <View style={s.section}>
                            <EnterView><Text style={s.sectionLabel}>CARRIED OVER</Text></EnterView>
                            <View style={s.cardGroup}>
                                {carried.map((task, i) => (
                                    <EnterView key={task.id} index={i + 1}>
                                        <TaskCard
                                            task={task}
                                            onPress={() => router.push(`/task/${task.id}?from=Review`)}
                                            onDone={(updated) => patchTask('carriedOver', task.id, updated)}
                                        />
                                    </EnterView>
                                ))}
                            </View>
                        </View>
                    )}

                    {backlog.length > 0 && (
                        <View style={s.section}>
                            <EnterView index={carried.length + 1}><Text style={s.sectionLabel}>BACKLOG</Text></EnterView>
                            <View style={s.cardGroup}>
                                {backlog.map((task, i) => (
                                    <EnterView key={task.id} index={carried.length + 2 + i}>
                                        <TaskCard
                                            task={task}
                                            onPress={() => router.push(`/task/${task.id}?from=Review`)}
                                            onDone={(updated) => patchTask('backlog', task.id, updated)}
                                        />
                                    </EnterView>
                                ))}
                            </View>
                        </View>
                    )}

                    <EnterView index={carried.length + backlog.length + 2} style={s.addTaskWrap}>
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
                        // T-06: advances to agent generation step
                    >
                        <Text style={s.doneButtonLabel}>Done reviewing</Text>
                    </PressableScale>
                </View>
            )}

            <CreateTaskModal
                visible={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                onCreated={(task) => {
                    if (task.status !== 'DONE') {
                        setBacklog(prev => [...prev, task]);
                    }
                    setShowCreateModal(false);
                }}
            />
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
    sectionLabel: {
        fontSize: 11,
        color: 'rgba(122,115,106,0.5)',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
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
    badgeDone: { backgroundColor: 'rgba(92,82,72,0.10)' },
    badgeTextDone: { color: '#5c5248' },
    badgeMuted: { backgroundColor: 'rgba(232,228,221,0.4)' },
    badgeTextMuted: { color: 'rgba(122,115,106,0.6)' },

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
});
