import { useEffect, useState } from "react";
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
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle } from "react-native-svg";
import { api } from "../../lib/api";
import type { TaskDetail, EnergyLevel, Priority } from "../../lib/api.types";

const ARC_SIZE = 32;
const ARC_STROKE = 3;
const ARC_R = (ARC_SIZE - ARC_STROKE) / 2;
const ARC_CIRC = 2 * Math.PI * ARC_R;

function CircularProgress({ pct }: { pct: number }) {
    const offset = ARC_CIRC * (1 - Math.max(0, Math.min(100, pct)) / 100);
    return (
        <Svg width={ARC_SIZE} height={ARC_SIZE} viewBox={`0 0 ${ARC_SIZE} ${ARC_SIZE}`}>
            <Circle
                cx={ARC_SIZE / 2} cy={ARC_SIZE / 2} r={ARC_R}
                stroke="rgba(232,228,221,0.8)"
                strokeWidth={ARC_STROKE}
                fill="none"
            />
            <Circle
                cx={ARC_SIZE / 2} cy={ARC_SIZE / 2} r={ARC_R}
                stroke="rgba(212,165,116,0.8)"
                strokeWidth={ARC_STROKE}
                fill="none"
                strokeDasharray={ARC_CIRC}
                strokeDashoffset={offset}
                strokeLinecap="round"
                transform={`rotate(-90 ${ARC_SIZE / 2} ${ARC_SIZE / 2})`}
            />
        </Svg>
    );
}

function formatDeadline(iso: string): string {
    const d = new Date(iso);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const date = `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    const h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    const time = m === 0 ? `${hour12} ${ampm}` : `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
    return `${date} at ${time}`;
}

function formatEstimate(mins: number): string {
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatPriority(p: Priority | null): string {
    if (!p) return '—';
    return p.charAt(0) + p.slice(1).toLowerCase();
}

function formatEffort(e: EnergyLevel | null): string {
    if (!e) return '—';
    return e.charAt(0) + e.slice(1).toLowerCase();
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <View style={styles.propRow}>
            <Text style={styles.propLabel}>{label}</Text>
            <View style={styles.propValueRow}>
                {children}
                <Ionicons name="chevron-forward" size={14} color="rgba(122,115,106,0.3)" />
            </View>
        </View>
    );
}

export default function TaskDetailScreen() {
    const router = useRouter();
    const { taskId } = useLocalSearchParams<{ taskId: string }>();
    const [task, setTask] = useState<TaskDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        if (!taskId) return;
        let active = true;
        api.getTaskDetail(taskId).then(result => {
            if (!active) return;
            if (result.ok) {
                setTask(result.data);
            } else {
                setError(result.error);
            }
            setLoading(false);
        });
        return () => { active = false; };
    }, [taskId]);

    function confirmDelete() {
        Alert.alert(
            'Delete task',
            'This action cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: handleDelete },
            ]
        );
    }

    async function handleDelete() {
        if (!taskId) return;
        setDeleting(true);
        const result = await api.deleteTask(taskId);
        if (result.ok) {
            router.back();
        } else {
            setDeleting(false);
            Alert.alert('Error', result.error);
        }
    }

    const inProgress = task?.status === 'IN_PROGRESS';
    const progress = task?.progress ?? 0;

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.backRow}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.7}>
                    <Ionicons name="chevron-back" size={20} color="#7a736a" />
                    <Text style={styles.backLabel}>Backlog</Text>
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

            {!loading && !error && task && (
                <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                    <View style={styles.titleSection}>
                        <Text style={styles.title}>{task.title}</Text>
                        <View style={[styles.statusBadge, inProgress ? styles.statusBadgeActive : styles.statusBadgeMuted]}>
                            {inProgress && <View style={styles.statusDot} />}
                            <Text style={[styles.statusText, inProgress ? styles.statusTextActive : styles.statusTextMuted]}>
                                {inProgress ? 'In Progress' : 'Todo'}
                            </Text>
                        </View>
                    </View>

                    <View style={styles.card}>
                        <PropRow label="Priority">
                            <Text style={[styles.propValue, !task.priority && styles.propValueEmpty]}>
                                {formatPriority(task.priority)}
                            </Text>
                        </PropRow>
                        <View style={styles.divider} />
                        <PropRow label="Deadline">
                            <Text style={[styles.propValue, !task.deadline && styles.propValueEmpty]}>
                                {task.deadline ? formatDeadline(task.deadline) : '—'}
                            </Text>
                        </PropRow>
                        <View style={styles.divider} />
                        <PropRow label="Estimate">
                            <Text style={styles.propValue}>{formatEstimate(task.estimatedMins)}</Text>
                        </PropRow>
                        <View style={styles.divider} />
                        <PropRow label="Progress">
                            <View style={styles.progressValue}>
                                <CircularProgress pct={progress} />
                                <Text style={styles.propValue}>{progress}%</Text>
                            </View>
                        </PropRow>
                        <View style={styles.divider} />
                        <PropRow label="Energy">
                            <Text style={[styles.propValue, !task.effort && styles.propValueEmpty]}>
                                {formatEffort(task.effort)}
                            </Text>
                        </PropRow>
                    </View>

                    <View style={styles.card}>
                        <Text style={styles.notesLabel}>NOTES</Text>
                        <Text style={[styles.notesContent, !task.notes && styles.notesEmpty]}>
                            {task.notes ?? 'No notes'}
                        </Text>
                    </View>

                    <TouchableOpacity
                        style={styles.deleteButton}
                        onPress={confirmDelete}
                        activeOpacity={0.7}
                        disabled={deleting}
                    >
                        <Ionicons name="trash-outline" size={16} color="rgba(212,24,61,0.7)" />
                        <Text style={styles.deleteLabel}>Delete task</Text>
                    </TouchableOpacity>
                </ScrollView>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: '#fdfcfa' },

    backRow: {
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 4,
    },
    backButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        alignSelf: 'flex-start',
        paddingVertical: 6,
        paddingHorizontal: 4,
    },
    backLabel: { fontSize: 15, color: '#7a736a' },

    centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    errorText: { fontSize: 14, color: '#7a736a', textAlign: 'center' },

    content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 12 },

    titleSection: { paddingHorizontal: 4, paddingBottom: 4, gap: 10 },
    title: { fontSize: 23.2, fontWeight: '500', color: '#2a2621', letterSpacing: -0.3 },
    statusBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        borderWidth: 1,
    },
    statusBadgeActive: {
        backgroundColor: 'rgba(212,165,116,0.1)',
        borderColor: 'rgba(212,165,116,0.2)',
    },
    statusBadgeMuted: {
        backgroundColor: 'rgba(232,228,221,0.4)',
        borderColor: 'rgba(42,38,33,0.06)',
    },
    statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#d4a574' },
    statusText: { fontSize: 12, fontWeight: '500' },
    statusTextActive: { color: '#d4a574' },
    statusTextMuted: { color: 'rgba(122,115,106,0.6)' },

    card: {
        backgroundColor: '#fffef9',
        borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.04)',
        borderRadius: 16,
        overflow: 'hidden',
    },

    propRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 13,
    },
    propLabel: { fontSize: 14, color: 'rgba(122,115,106,0.6)' },
    propValueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    propValue: { fontSize: 14, color: '#2a2621' },
    propValueEmpty: { color: 'rgba(122,115,106,0.4)' },
    progressValue: { flexDirection: 'row', alignItems: 'center', gap: 8 },

    divider: { height: 1, backgroundColor: 'rgba(42,38,33,0.04)', marginHorizontal: 16 },

    notesLabel: {
        fontSize: 10,
        color: 'rgba(122,115,106,0.4)',
        letterSpacing: 1.1,
        textTransform: 'uppercase',
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 8,
    },
    notesContent: {
        fontSize: 14,
        color: '#2a2621',
        lineHeight: 21,
        paddingHorizontal: 16,
        paddingBottom: 16,
    },
    notesEmpty: { color: 'rgba(122,115,106,0.4)' },

    deleteButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 42,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(212,24,61,0.2)',
        marginTop: 4,
    },
    deleteLabel: { fontSize: 14, fontWeight: '500', color: 'rgba(212,24,61,0.7)' },
});
