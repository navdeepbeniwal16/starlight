import { useCallback, useRef, useState } from "react";
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
    Alert,
} from "react-native";
import Animated, { Easing, FadeIn, LinearTransition } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../lib/api";
import type { Project } from "../../lib/api.types";
import {
    MAX_IN_FOCUS,
    inFocusCount,
    focusToggleBlocked,
    applyCreated,
    replaceProject,
    withoutProject,
    setFocus,
} from "../../lib/projectState";
import { createSequencer } from "../../lib/sequencer";
import { PressableScale } from "../../components/PressableScale";
import ProjectFormModal from "../../components/ProjectFormModal";
import { colors, radius, spacing } from "../../lib/theme";

const EASE = Easing.bezier(0.2, 0, 0, 1);
const CARD_LAYOUT = LinearTransition.duration(240).easing(EASE.factory());

function FocusStar({ active, blocked, onPress }: { active: boolean; blocked: boolean; onPress: () => void }) {
    return (
        <TouchableOpacity
            onPress={onPress}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.6}
            style={styles.focusBtn}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: blocked }}
            accessibilityLabel={active ? 'In focus' : 'Set in focus'}
        >
            <Ionicons
                name={active ? 'star' : 'star-outline'}
                size={22}
                color={active ? colors.accent.strong : blocked ? colors.text.muted : colors.text.secondary}
            />
        </TouchableOpacity>
    );
}

function ProjectCard({ project, blocked, index, onPress, onToggleFocus }: {
    project: Project;
    blocked: boolean;
    index: number;
    onPress: () => void;
    onToggleFocus: () => void;
}) {
    return (
        <Animated.View entering={FadeIn.duration(180).delay(Math.min(index * 30, 240))} layout={CARD_LAYOUT}>
            <View style={styles.card}>
                <PressableScale onPress={onPress} containerStyle={styles.cardBody} style={styles.cardBodyInner}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{project.name}</Text>
                    {project.goal ? (
                        <Text style={styles.cardGoal} numberOfLines={2}>{project.goal}</Text>
                    ) : (
                        <Text style={styles.cardGoalMuted}>No goal set</Text>
                    )}
                </PressableScale>
                <FocusStar active={project.isInFocus} blocked={blocked} onPress={onToggleFocus} />
            </View>
        </Animated.View>
    );
}

// Todos is a synthetic entry standing in for uncategorised tasks; it is not a real
// Project, so it carries no goal, focus toggle, or edit affordance.
function TodosCard() {
    return (
        <Animated.View layout={CARD_LAYOUT}>
            <View style={[styles.card, styles.todosCard]}>
                <View style={styles.cardBody}>
                    <View style={styles.todosTitleRow}>
                        <Ionicons name="file-tray-outline" size={16} color={colors.text.secondary} />
                        <Text style={styles.cardTitle}>Todos</Text>
                    </View>
                    <Text style={styles.cardGoalMuted}>Tasks not assigned to a project</Text>
                </View>
            </View>
        </Animated.View>
    );
}

export default function ProjectsScreen() {
    const [projects, setProjects] = useState<Project[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [modalVisible, setModalVisible] = useState(false);
    const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
    const [editing, setEditing] = useState<Project | null>(null);

    // Only the most recently issued fetch may apply its result, so an out-of-order
    // response can't clobber a fresher optimistic focus toggle.
    const seq = useRef(createSequencer()).current;

    const loadProjects = useCallback((showLoading: boolean) => {
        const token = seq.next();
        if (showLoading) { setLoading(true); setError(null); }
        api.getProjects().then(result => {
            if (showLoading) setLoading(false);
            if (!seq.isCurrent(token)) return;
            if (!result.ok) { if (showLoading) setError(result.error); return; }
            setProjects(result.data);
        });
    }, [seq]);

    useFocusEffect(useCallback(() => { loadProjects(true); }, [loadProjects]));

    async function handleToggleFocus(project: Project) {
        if (!projects) return;
        // Turning on while the cap is full: explain it rather than firing a doomed
        // request. The counter and dimmed stars already signal the limit.
        if (!project.isInFocus && focusToggleBlocked(projects, project.id)) {
            Alert.alert('Focus limit reached', `You can focus up to ${MAX_IN_FOCUS} projects at once. Turn one off to focus another.`);
            return;
        }
        const next = !project.isInFocus;
        setProjects(prev => (prev ? setFocus(prev, project.id, next) : prev));
        const result = await api.setProjectFocus(project.id, next);
        if (result.ok) {
            setProjects(prev => (prev ? replaceProject(prev, result.data) : prev));
        } else {
            // Revert the optimistic flip; a 409 here means a race beat us to the cap.
            setProjects(prev => (prev ? setFocus(prev, project.id, project.isInFocus) : prev));
            Alert.alert(next ? "Couldn't focus project" : "Couldn't unfocus project", result.error);
        }
    }

    function openCreate() {
        setModalMode('create');
        setEditing(null);
        setModalVisible(true);
    }

    function openEdit(project: Project) {
        setModalMode('edit');
        setEditing(project);
        setModalVisible(true);
    }

    function handleSaved(saved: Project) {
        setProjects(prev => {
            if (!prev) return prev;
            return modalMode === 'create' ? applyCreated(prev, saved) : replaceProject(prev, saved);
        });
        setModalVisible(false);
        loadProjects(false);
    }

    function handleDeleted(projectId: string) {
        setProjects(prev => (prev ? withoutProject(prev, projectId) : prev));
        setModalVisible(false);
        loadProjects(false);
    }

    const focusCount = projects ? inFocusCount(projects) : 0;
    const atCap = focusCount >= MAX_IN_FOCUS;

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Projects</Text>
                {projects !== null && (
                    <View style={[styles.focusCounter, atCap && styles.focusCounterFull]}>
                        <Ionicons name="star" size={12} color={atCap ? colors.accent.strong : colors.text.secondary} />
                        <Text style={[styles.focusCounterText, atCap && styles.focusCounterTextFull]}>
                            {focusCount}/{MAX_IN_FOCUS} in focus
                        </Text>
                    </View>
                )}
            </View>

            {loading && (
                <View style={styles.centered}>
                    <ActivityIndicator color={colors.accent.default} />
                </View>
            )}

            {!loading && error && (
                <View style={styles.centered}>
                    <Text style={styles.errorText}>{error}</Text>
                </View>
            )}

            {!loading && !error && projects !== null && (
                <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
                    {atCap && (
                        <Text style={styles.capHint}>Focus is full — turn one off to focus another.</Text>
                    )}

                    {projects.map((project, i) => (
                        <ProjectCard
                            key={project.id}
                            project={project}
                            index={i}
                            blocked={!project.isInFocus && atCap}
                            onPress={() => openEdit(project)}
                            onToggleFocus={() => handleToggleFocus(project)}
                        />
                    ))}

                    {projects.length === 0 && (
                        <Text style={styles.emptyHint}>No projects yet. Create one to group your tasks under a goal.</Text>
                    )}

                    <TodosCard />
                </ScrollView>
            )}

            {!loading && !error && (
                <View style={styles.fabWrap}>
                    <PressableScale onPress={openCreate} style={styles.fab}>
                        <Ionicons name="add" size={18} color={colors.text.onAccent} />
                        <Text style={styles.fabText}>Project</Text>
                    </PressableScale>
                </View>
            )}

            <ProjectFormModal
                visible={modalVisible}
                mode={modalMode}
                project={editing}
                onClose={() => setModalVisible(false)}
                onSaved={handleSaved}
                onDeleted={handleDeleted}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.surface.page },

    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.xl,
        paddingTop: spacing.lg,
        paddingBottom: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.border.hairline,
    },
    headerTitle: { fontSize: 18, fontWeight: '600', color: colors.text.primary, letterSpacing: -0.3 },
    focusCounter: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs + 1,
        borderRadius: radius.pill,
        backgroundColor: colors.surface.sunken,
    },
    focusCounterFull: { backgroundColor: colors.accent.tint },
    focusCounterText: { fontSize: 12, fontWeight: '500', color: colors.text.secondary, fontVariant: ['tabular-nums'] },
    focusCounterTextFull: { color: colors.accent.strong },

    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xxl },
    errorText: { fontSize: 14, color: colors.text.secondary, textAlign: 'center' },

    list: { padding: spacing.lg, gap: spacing.sm + 2, paddingBottom: 96 },
    capHint: { fontSize: 12, color: colors.accent.strong, marginBottom: spacing.xs, marginLeft: spacing.xs },
    emptyHint: {
        fontSize: 13,
        color: colors.text.muted,
        fontStyle: 'italic',
        textAlign: 'center',
        marginVertical: spacing.md,
        paddingHorizontal: spacing.xl,
    },

    card: {
        backgroundColor: colors.surface.raised,
        borderWidth: 1,
        borderColor: colors.border.hairline,
        borderRadius: radius.md,
        paddingHorizontal: spacing.md + 1,
        paddingVertical: spacing.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
    },
    todosCard: { backgroundColor: colors.surface.block, borderStyle: 'dashed', borderColor: colors.border.warm },
    todosTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

    cardBody: { flex: 1 },
    cardBodyInner: { gap: spacing.xs },
    cardTitle: { fontSize: 15, fontWeight: '500', color: colors.text.primary, letterSpacing: -0.15 },
    cardGoal: { fontSize: 13, color: colors.text.secondary, lineHeight: 18 },
    cardGoalMuted: { fontSize: 13, color: colors.text.muted, fontStyle: 'italic' },

    focusBtn: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },

    fabWrap: { position: 'absolute', bottom: 16, right: 16 },
    fab: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        height: 40,
        paddingHorizontal: 14,
        borderRadius: radius.xl,
        backgroundColor: colors.accent.default,
        justifyContent: 'center',
        shadowColor: colors.text.primary,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 10,
        elevation: 4,
    },
    fabText: { fontSize: 14, fontWeight: '500', color: colors.text.onAccent, letterSpacing: -0.2 },
});
