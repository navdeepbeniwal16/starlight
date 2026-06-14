import { useCallback, useState } from "react";
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Alert,
    ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../lib/api";
import type { BacklogTask, Priority } from "../../lib/api.types";
import CreateTaskModal from "../../components/CreateTaskModal";

const PRIORITY_ORDER: Record<Priority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

function sortTasks(tasks: BacklogTask[]): BacklogTask[] {
    return [...tasks].sort((a, b) => {
        const pa = a.priority !== null ? PRIORITY_ORDER[a.priority] : 3;
        const pb = b.priority !== null ? PRIORITY_ORDER[b.priority] : 3;
        if (pa !== pb) return pa - pb;
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;
        return a.deadline.localeCompare(b.deadline);
    });
}

type PriorityGroup = { key: Priority | 'NONE'; label: string; tasks: BacklogTask[] };

const PRIORITY_GROUPS: Array<{ key: Priority | 'NONE'; label: string }> = [
    { key: 'HIGH',   label: 'HIGH PRIORITY' },
    { key: 'MEDIUM', label: 'MEDIUM PRIORITY' },
    { key: 'LOW',    label: 'LOW PRIORITY' },
    { key: 'NONE',   label: 'NO PRIORITY' },
];

function groupByPriority(tasks: BacklogTask[]): PriorityGroup[] {
    const map: Record<string, BacklogTask[]> = { HIGH: [], MEDIUM: [], LOW: [], NONE: [] };
    for (const task of tasks) {
        map[task.priority ?? 'NONE'].push(task);
    }
    return PRIORITY_GROUPS
        .filter(g => map[g.key].length > 0)
        .map(g => ({ ...g, tasks: map[g.key] }));
}

function formatDeadline(isoString: string): string {
    const d = new Date(isoString);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `Due ${months[d.getMonth()]} ${d.getDate()}`;
}

function PriorityDot({ priority }: { priority: Priority | null }) {
    const color =
        priority === 'HIGH'   ? '#d4a574' :
        priority === 'MEDIUM' ? '#7a736a' :
                                'rgba(122,115,106,0.4)';
    return <View style={[styles.priorityDot, { backgroundColor: color }]} />;
}

function StatusBadge({ status }: { status: BacklogTask['status'] }) {
    const inProgress = status === 'IN_PROGRESS';
    return (
        <View style={[styles.badge, inProgress ? styles.badgeInProgress : styles.badgeMuted]}>
            <Text style={[styles.badgeText, inProgress ? styles.badgeTextInProgress : styles.badgeTextMuted]}>
                {inProgress ? 'In Progress' : 'Todo'}
            </Text>
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

function TaskCard({ task, onPress }: { task: BacklogTask; onPress: () => void }) {
    return (
        <TouchableOpacity
            style={styles.taskCard}
            activeOpacity={0.7}
            onPress={onPress}
        >
            <PriorityDot priority={task.priority} />
            <View style={styles.taskCardContent}>
                <Text style={styles.taskTitle}>{task.title}</Text>
                <View style={styles.badgeRow}>
                    <StatusBadge status={task.status} />
                    {task.priority && <PriorityBadge priority={task.priority} />}
                    {task.deadline && (
                        <Text style={styles.deadlineText}>{formatDeadline(task.deadline)}</Text>
                    )}
                </View>
                {(task.progress ?? 0) > 0 && (
                    <View style={styles.progressRow}>
                        <View style={styles.progressTrack}>
                            <View style={[styles.progressFill, { width: `${task.progress ?? 0}%` }]} />
                        </View>
                        <Text style={styles.progressLabel}>{task.progress ?? 0}%</Text>
                    </View>
                )}
            </View>
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
    const [tasks, setTasks] = useState<BacklogTask[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);

    useFocusEffect(
        useCallback(() => {
            let active = true;
            setLoading(true);
            setError(null);
            api.getBacklog().then(result => {
                if (!active) return;
                if (result.ok) {
                    setTasks(sortTasks(result.data.filter(t => t.status !== 'DONE')));
                } else {
                    setError(result.error);
                }
                setLoading(false);
            });
            return () => { active = false; };
        }, [])
    );

    const groups = tasks ? groupByPriority(tasks) : [];
    const taskCount = tasks?.length ?? 0;
    const showFab = !loading && !error;

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.header}>
                <View style={styles.headerTop}>
                    <View>
                        <Text style={styles.headerTitle}>Backlog</Text>
                        {tasks !== null && (
                            <Text style={styles.headerCount}>
                                {taskCount === 1 ? '1 task' : `${taskCount} tasks`}
                            </Text>
                        )}
                    </View>
                    <TouchableOpacity
                        style={styles.filterButton}
                        onPress={() => Alert.alert('Filters', 'Filtering coming soon')}
                    >
                        <Ionicons name="options-outline" size={14} color="#7a736a" />
                        <Text style={styles.filterLabel}>Filter</Text>
                        <Ionicons name="chevron-down" size={12} color="#7a736a" />
                    </TouchableOpacity>
                </View>
                <View style={styles.sortRow}>
                    <Text style={styles.sortedBy}>Sorted by </Text>
                    <Text style={styles.sortedByValue}>Priority · Deadline</Text>
                </View>
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

            {!loading && !error && taskCount === 0 && (
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

            {!loading && !error && taskCount > 0 && (
                <ScrollView
                    contentContainerStyle={styles.list}
                    showsVerticalScrollIndicator={false}
                >
                    {groups.map((group, gi) => (
                        <View key={group.key}>
                            <Text style={[styles.sectionHeader, gi > 0 && styles.sectionHeaderMargin]}>
                                {group.label}
                            </Text>
                            <View style={styles.cardGroup}>
                                {group.tasks.map(task => (
                                    <TaskCard key={task.id} task={task} onPress={() => router.push(`/task/${task.id}`)} />
                                ))}
                            </View>
                        </View>
                    ))}
                </ScrollView>
            )}

            {showFab && (
                <TouchableOpacity
                    style={styles.fab}
                    onPress={() => setShowCreateModal(true)}
                    activeOpacity={0.8}
                >
                    <Ionicons name="add" size={24} color="#2a2621" />
                </TouchableOpacity>
            )}

            <CreateTaskModal
                visible={showCreateModal}
                onClose={() => setShowCreateModal(false)}
                onCreated={(task) => {
                    if (task.status !== 'DONE') {
                        setTasks(prev => sortTasks([...(prev ?? []), task]));
                    }
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
        borderBottomColor: 'rgba(42,38,33,0.04)',
    },
    headerTop: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    headerTitle: { fontSize: 18, fontWeight: '500', color: '#2a2621' },
    headerCount: { fontSize: 14, color: '#7a736a', marginTop: 2 },
    filterButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        backgroundColor: '#f5f3ef',
        borderRadius: 16,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    filterLabel: { fontSize: 14, fontWeight: '500', color: '#7a736a' },
    sortRow: { flexDirection: 'row', marginTop: 8 },
    sortedBy: { fontSize: 12, color: 'rgba(122,115,106,0.5)' },
    sortedByValue: { fontSize: 12, color: '#7a736a' },

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

    list: { padding: 16, paddingBottom: 80 },
    sectionHeader: {
        fontSize: 12,
        color: 'rgba(122,115,106,0.5)',
        letterSpacing: 0.3,
        textTransform: 'uppercase',
        marginBottom: 10,
    },
    sectionHeaderMargin: { marginTop: 20 },
    cardGroup: { gap: 8 },

    taskCard: {
        backgroundColor: '#fffef9',
        borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.04)',
        borderRadius: 16,
        padding: 16,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
    },
    priorityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
    taskCardContent: { flex: 1 },
    taskTitle: { fontSize: 15, fontWeight: '500', color: '#2a2621', letterSpacing: -0.23 },
    badgeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 6,
        marginTop: 8,
    },

    badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
    badgeText: { fontSize: 11, fontWeight: '500' },
    badgeInProgress: { backgroundColor: 'rgba(212,165,116,0.1)' },
    badgeTextInProgress: { color: '#d4a574' },
    badgeMuted: { backgroundColor: 'rgba(232,228,221,0.4)' },
    badgeTextMuted: { color: 'rgba(122,115,106,0.6)' },
    deadlineText: { fontSize: 11, fontWeight: '500', color: 'rgba(122,115,106,0.5)' },

    progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
    progressTrack: {
        flex: 1,
        height: 4,
        backgroundColor: 'rgba(232,228,221,0.5)',
        borderRadius: 999,
    },
    progressFill: { height: 4, backgroundColor: 'rgba(212,165,116,0.6)', borderRadius: 999 },
    progressLabel: { fontSize: 11, fontWeight: '500', color: 'rgba(122,115,106,0.4)' },

    fab: {
        position: 'absolute',
        bottom: 24,
        right: 20,
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: '#ffffff',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 4,
    },
});
