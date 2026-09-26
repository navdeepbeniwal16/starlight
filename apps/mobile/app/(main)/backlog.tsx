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
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../lib/api";
import type { BacklogTask, BacklogBuckets, Project, ScheduledTask, TaskDetail } from "../../lib/api.types";
import { formatTime } from "../../lib/time";
import { applyCreated as applyTaskCreated, applyToggle, bucketOf, createSequencer } from "../../lib/backlogState";
import {
    MAX_IN_FOCUS,
    inFocusCount,
    focusToggleBlocked,
    applyCreated as applyProjectCreated,
    replaceProject,
    withoutProject,
    setFocus,
} from "../../lib/projectState";
import { groupBacklogByProject } from "../../lib/projectGrouping";
import CreateTaskModal from "../../components/CreateTaskModal";
import ProjectFormModal from "../../components/ProjectFormModal";
import CircularProgress from "../../components/CircularProgress";
import { colors, radius, spacing, shadow } from "../../lib/theme";

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

const TODOS_KEY = '__todos__';

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

function ProjectChip({ name }: { name: string }) {
    return (
        <View style={styles.projChip}>
            <Ionicons name="folder-outline" size={10} color={colors.accent.strong} />
            <Text style={styles.projChipText} numberOfLines={1}>{name}</Text>
        </View>
    );
}

function TaskCard({ task, scheduledMeta, projectName, index, justArrived, onPress, onToggled }: {
    task: BacklogTask;
    scheduledMeta?: string;
    projectName?: string | null;
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
                        {projectName ? <ProjectChip name={projectName} /> : null}
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

// Read-only by design — inline completion lives in the List view's Tasks segment.
function GroupTaskRow({ task, onPress }: { task: BacklogTask; onPress: () => void }) {
    const done = task.status === 'DONE';
    return (
        <Animated.View layout={SECTION_LAYOUT} entering={FadeIn.duration(160)}>
            <ScaleOnPress onPress={onPress} style={[styles.taskCard, done && styles.taskCardDone]}>
                <Ionicons
                    name={done ? 'checkmark-circle' : 'checkmark-circle-outline'}
                    size={22}
                    color={done ? '#5c5248' : 'rgba(122,115,106,0.3)'}
                />
                <View style={styles.taskCardContent}>
                    <Text style={[styles.taskTitle, done && styles.taskTitleDone]} numberOfLines={2}>{task.title}</Text>
                    <View style={styles.badgeRow}>
                        <StatusBadge status={task.status} />
                        {task.deadline ? <Text style={styles.metaText}>{formatDeadline(task.deadline)}</Text> : null}
                    </View>
                </View>
                <CircularProgress progress={task.progress ?? 0} />
            </ScaleOnPress>
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

function FocusStar({ active, blocked, size = 22, onPress }: {
    active: boolean;
    blocked: boolean;
    size?: number;
    onPress: () => void;
}) {
    return (
        <TouchableOpacity
            onPress={onPress}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.6}
            style={styles.focusBtn}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={active ? 'In focus' : 'Set in focus'}
            accessibilityHint={blocked ? `Focus is full at ${MAX_IN_FOCUS}; turn one off first` : undefined}
        >
            <Ionicons
                name={active ? 'star' : 'star-outline'}
                size={size}
                color={active ? colors.accent.strong : blocked ? colors.text.muted : colors.text.secondary}
            />
        </TouchableOpacity>
    );
}

// The n/3 counter is the primary focus signal — it turns "full"/accent at the cap so
// the limit reads during selection, rather than surfacing only as a rejected 4th tap.
function FocusCounter({ count }: { count: number }) {
    const full = count >= MAX_IN_FOCUS;
    return (
        <View style={[styles.focusCounter, full && styles.focusCounterFull]}>
            <Ionicons name="star" size={12} color={full ? colors.accent.strong : colors.text.secondary} />
            <Text style={[styles.focusCounterText, full && styles.focusCounterTextFull]}>
                {count}/{MAX_IN_FOCUS} in focus
            </Text>
        </View>
    );
}

function ListView({ buckets, projects, open, arrivedTaskId, receivedSection, onToggleSection, onTaskPress, onToggled, onToggleFocus, onEditProject }: {
    buckets: BacklogBuckets;
    projects: Project[];
    open: Record<SectionKey, boolean>;
    arrivedTaskId: string | null;
    receivedSection: SectionKey | null;
    onToggleSection: (key: SectionKey) => void;
    onTaskPress: (taskId: string) => void;
    onToggled: (task: BacklogTask, updated: TaskDetail) => void;
    onToggleFocus: (project: Project) => void;
    onEditProject: (project: Project) => void;
}) {
    const [seg, setSeg] = useState<'tasks' | 'projects'>('tasks');
    const focusCount = inFocusCount(projects);
    const taskCount = SECTIONS.reduce((sum, s) => sum + buckets[s.key].length, 0);

    return (
        <>
            <View style={styles.segmentWrap}>
                <View style={styles.segment}>
                    {(['tasks', 'projects'] as const).map(key => (
                        <TouchableOpacity
                            key={key}
                            style={[styles.segmentBtn, seg === key && styles.segmentBtnActive]}
                            activeOpacity={0.7}
                            onPress={() => setSeg(key)}
                        >
                            <Text style={[styles.segmentText, seg === key && styles.segmentTextActive]}>
                                {key === 'tasks' ? 'Tasks' : 'Projects'}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>

            {seg === 'tasks' ? (
                taskCount === 0 ? (
                    <View style={styles.centered}>
                        <EmptyIllustration />
                        <Text style={styles.emptyTitle}>Your backlog is clear</Text>
                        <Text style={styles.emptySubtitle}>Add tasks you want to track and schedule into your days</Text>
                    </View>
                ) : (
                    <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
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
                                            onToggle={() => onToggleSection(section.key)}
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
                                                        projectName={task.projectName}
                                                        scheduledMeta={section.key === 'scheduled'
                                                            ? `${formatTime((task as ScheduledTask).blockStartTime)} · ${(task as ScheduledTask).blockName}`
                                                            : undefined}
                                                        onPress={() => onTaskPress(task.id)}
                                                        onToggled={(updated) => onToggled(task, updated)}
                                                    />
                                                ))}
                                            </View>
                                        )
                                    )}
                                </Animated.View>
                            );
                        })}
                    </ScrollView>
                )
            ) : (
                <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
                    <View style={styles.counterRow}>
                        <FocusCounter count={focusCount} />
                    </View>

                    {projects.map((project, i) => (
                        <Animated.View key={project.id} entering={FadeIn.duration(180).delay(Math.min(i * 30, 240))} layout={SECTION_LAYOUT}>
                            <View style={styles.projCard}>
                                <ScaleOnPress onPress={() => onEditProject(project)} style={styles.projCardBody}>
                                    <Text style={styles.projName} numberOfLines={1}>{project.name}</Text>
                                    <Text style={project.goal ? styles.projGoal : styles.projGoalMuted} numberOfLines={2}>
                                        {project.goal ?? 'No goal set'}
                                    </Text>
                                    {project.notes ? (
                                        <Text style={styles.projNotes} numberOfLines={2}>{project.notes}</Text>
                                    ) : null}
                                </ScaleOnPress>
                                <FocusStar
                                    active={project.isInFocus}
                                    blocked={!project.isInFocus && focusToggleBlocked(projects, project.id)}
                                    onPress={() => onToggleFocus(project)}
                                />
                            </View>
                        </Animated.View>
                    ))}

                    {projects.length === 0 && (
                        <Text style={styles.emptyHint}>No projects yet. Create one to group your tasks under a goal.</Text>
                    )}
                </ScrollView>
            )}
        </>
    );
}

function GroupsView({ buckets, projects, onTaskPress, onToggleFocus, onEditProject }: {
    buckets: BacklogBuckets;
    projects: Project[];
    onTaskPress: (taskId: string) => void;
    onToggleFocus: (project: Project) => void;
    onEditProject: (project: Project) => void;
}) {
    const [lens, setLens] = useState<'all' | 'focus'>('all');
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const focusCount = inFocusCount(projects);

    const { groups, todos } = groupBacklogByProject(buckets, projects);
    const shown = lens === 'focus' ? groups.filter(g => g.project.isInFocus) : groups;
    const toggle = (id: string) => setCollapsed(c => ({ ...c, [id]: !c[id] }));

    return (
        <>
            <View style={styles.lensRow}>
                <View style={styles.lensPills}>
                    {(['all', 'focus'] as const).map(key => (
                        <TouchableOpacity
                            key={key}
                            style={[styles.lensPill, lens === key && styles.lensPillActive]}
                            activeOpacity={0.7}
                            onPress={() => setLens(key)}
                        >
                            {key === 'focus' ? (
                                <Ionicons name="star" size={11} color={lens === key ? colors.accent.strong : colors.text.secondary} />
                            ) : null}
                            <Text style={[styles.lensText, lens === key && styles.lensTextActive]}>
                                {key === 'all' ? 'All projects' : 'In focus'}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
                <FocusCounter count={focusCount} />
            </View>

            <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
                {shown.map(({ project, tasks }) => {
                    const isOpen = !collapsed[project.id];
                    return (
                        <Animated.View key={project.id} layout={SECTION_LAYOUT} style={styles.groupCard}>
                            <View style={styles.groupHeader}>
                                <TouchableOpacity style={styles.groupHeaderMain} activeOpacity={0.6} onPress={() => toggle(project.id)}>
                                    <Ionicons name={isOpen ? 'chevron-down' : 'chevron-forward'} size={14} color="rgba(122,115,106,0.7)" />
                                    <View style={styles.groupTitleCol}>
                                        <View style={styles.groupTitleRow}>
                                            <Text style={styles.groupName} numberOfLines={1}>{project.name}</Text>
                                            <Text style={styles.groupCount}>{tasks.length}</Text>
                                        </View>
                                        {project.goal ? <Text style={styles.groupGoal} numberOfLines={1}>{project.goal}</Text> : null}
                                    </View>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => onEditProject(project)} hitSlop={8} style={styles.groupEdit}>
                                    <Ionicons name="ellipsis-horizontal" size={16} color={colors.text.muted} />
                                </TouchableOpacity>
                                <FocusStar
                                    active={project.isInFocus}
                                    blocked={!project.isInFocus && focusToggleBlocked(projects, project.id)}
                                    size={20}
                                    onPress={() => onToggleFocus(project)}
                                />
                            </View>
                            {isOpen && (
                                tasks.length === 0 ? (
                                    <Text style={styles.groupHint}>No tasks in this project yet</Text>
                                ) : (
                                    <View style={styles.groupTasks}>
                                        {tasks.map(task => (
                                            <GroupTaskRow key={task.id} task={task} onPress={() => onTaskPress(task.id)} />
                                        ))}
                                    </View>
                                )
                            )}
                        </Animated.View>
                    );
                })}

                {shown.length === 0 && (
                    <Text style={styles.emptyHint}>
                        {lens === 'focus' ? 'No projects in focus. Star a project to focus it.' : 'No projects yet. Create one to group your tasks under a goal.'}
                    </Text>
                )}

                {/* Todos stays last in this view and is never focusable. */}
                {lens === 'all' && (
                    <Animated.View layout={SECTION_LAYOUT} style={[styles.groupCard, styles.todosGroup]}>
                        <View style={styles.groupHeader}>
                            <TouchableOpacity style={styles.groupHeaderMain} activeOpacity={0.6} onPress={() => toggle(TODOS_KEY)}>
                                <Ionicons name={collapsed[TODOS_KEY] ? 'chevron-forward' : 'chevron-down'} size={14} color="rgba(122,115,106,0.7)" />
                                <View style={styles.groupTitleCol}>
                                    <View style={styles.groupTitleRow}>
                                        <Ionicons name="file-tray-outline" size={14} color={colors.text.secondary} />
                                        <Text style={styles.groupName}>Todos</Text>
                                        <Text style={styles.groupCount}>{todos.length}</Text>
                                    </View>
                                </View>
                            </TouchableOpacity>
                        </View>
                        {!collapsed[TODOS_KEY] && (
                            todos.length === 0 ? (
                                <Text style={styles.groupHint}>Nothing here — unassigned tasks land in Todos</Text>
                            ) : (
                                <View style={styles.groupTasks}>
                                    {todos.map(task => (
                                        <GroupTaskRow key={task.id} task={task} onPress={() => onTaskPress(task.id)} />
                                    ))}
                                </View>
                            )
                        )}
                    </Animated.View>
                )}
            </ScrollView>
        </>
    );
}

function ViewToggle({ view, onChange }: { view: 'list' | 'groups'; onChange: (v: 'list' | 'groups') => void }) {
    return (
        <View style={styles.viewToggle}>
            {([
                { key: 'list', icon: 'list' },
                { key: 'groups', icon: 'albums' },
            ] as const).map(({ key, icon }) => {
                const active = view === key;
                return (
                    <TouchableOpacity
                        key={key}
                        style={[styles.viewToggleBtn, active && styles.viewToggleBtnActive]}
                        activeOpacity={0.7}
                        onPress={() => onChange(key)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={key === 'list' ? 'List view' : 'Grouped view'}
                    >
                        <Ionicons name={icon} size={16} color={active ? colors.accent.strong : colors.text.secondary} />
                    </TouchableOpacity>
                );
            })}
        </View>
    );
}

// One create entry point, identical in both views, so the create anchor never moves.
function CreateFab({ onNewTask, onNewProject }: { onNewTask: () => void; onNewProject: () => void }) {
    const [open, setOpen] = useState(false);
    const pick = (fn: () => void) => { setOpen(false); fn(); };
    return (
        <>
            {open ? <Pressable style={styles.fabBackdrop} onPress={() => setOpen(false)} /> : null}
            <View style={styles.fabWrap}>
                {open ? (
                    <Animated.View entering={FadeIn.duration(120)} style={styles.fabActions}>
                        <TouchableOpacity style={styles.fabAction} activeOpacity={0.85} onPress={() => pick(onNewProject)}>
                            <Ionicons name="folder-outline" size={16} color={colors.text.primary} />
                            <Text style={styles.fabActionText}>New project</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.fabAction} activeOpacity={0.85} onPress={() => pick(onNewTask)}>
                            <Ionicons name="checkbox-outline" size={16} color={colors.text.primary} />
                            <Text style={styles.fabActionText}>New task</Text>
                        </TouchableOpacity>
                    </Animated.View>
                ) : null}
                <ScaleOnPress onPress={() => setOpen(o => !o)} style={styles.fab}>
                    <Ionicons name={open ? 'close' : 'add'} size={18} color={colors.text.onAccent} />
                    <Text style={styles.fabText}>{open ? 'Close' : 'New'}</Text>
                </ScaleOnPress>
            </View>
        </>
    );
}

export default function BacklogScreen() {
    const router = useRouter();
    const [view, setView] = useState<'list' | 'groups'>('list');
    const [buckets, setBuckets] = useState<BacklogBuckets | null>(null);
    const [projects, setProjects] = useState<Project[] | null>(null);
    const [open, setOpen] = useState<Record<SectionKey, boolean>>(DEFAULT_OPEN);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [showCreateTask, setShowCreateTask] = useState(false);
    const [projectModalVisible, setProjectModalVisible] = useState(false);
    const [projectModalMode, setProjectModalMode] = useState<'create' | 'edit'>('create');
    const [editingProject, setEditingProject] = useState<Project | null>(null);

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

    // Independent gates for the two data sets: a slow backlog fetch can't clobber a
    // fresher one, and the projects sequencer is shared by fetch + focus toggle so an
    // in-flight refetch can't overwrite an optimistic focus flip (and vice-versa).
    const backlogSeq = useRef(createSequencer()).current;
    const projectSeq = useRef(createSequencer()).current;

    // Synchronous mirror of `projects` so the focus guard and optimistic flips read the
    // freshest list across rapid taps that haven't re-rendered — this is what lets a
    // swap (turn one off, then another on) not be falsely capped.
    const projectsRef = useRef<Project[] | null>(null);
    const commitProjects = useCallback((next: Project[]) => {
        projectsRef.current = next;
        setProjects(next);
    }, []);

    const loadBuckets = useCallback((showLoading: boolean) => {
        const token = backlogSeq.next();
        return api.getBacklog().then(result => {
            if (!backlogSeq.isCurrent(token)) return;   // a newer fetch owns the data
            if (!result.ok) { if (showLoading) setError(result.error); return; }
            setBuckets(result.data);
            const pending = pendingArrival.current;
            if (pending) {
                pendingArrival.current = null;
                const landed = bucketOf(result.data, pending);
                if (landed) flashArrival(pending, landed);
            }
        });
    }, [backlogSeq, flashArrival]);

    const loadProjects = useCallback((showLoading: boolean) => {
        const token = projectSeq.next();
        return api.getProjects().then(result => {
            if (!projectSeq.isCurrent(token)) return;
            if (!result.ok) { if (showLoading) setError(result.error); return; }
            commitProjects(result.data);
        });
    }, [projectSeq, commitProjects]);

    // `showLoading` drives the full-screen loader/error (first load, refocus); silent
    // refreshes pass false so optimistic updates reconcile without a flash. The spinner
    // clears once both fetches settle, regardless of which superseded which.
    const loadAll = useCallback((showLoading: boolean) => {
        if (showLoading) { setLoading(true); setError(null); }
        const done = Promise.allSettled([loadBuckets(showLoading), loadProjects(showLoading)]);
        if (showLoading) done.finally(() => setLoading(false));
    }, [loadBuckets, loadProjects]);

    // Backlog opens on List every visit — the view choice is per-visit only (STA-16).
    useFocusEffect(useCallback(() => {
        setView('list');
        loadAll(true);
    }, [loadAll]));

    function handleToggled(task: BacklogTask, updated: TaskDetail) {
        if (!buckets) return;
        const { buckets: next, dest, settled } = applyToggle(buckets, task, updated);
        setBuckets(next);
        if (settled) flashArrival(task.id, dest);
        else pendingArrival.current = task.id;   // reveal wherever the refresh reconciles it
        loadBuckets(false);
    }

    async function handleToggleFocus(project: Project) {
        const current = projectsRef.current;
        if (!current) return;

        // Read live focus state, not the render-time snapshot, so a rapid swap sees
        // the capacity freed by the immediately preceding toggle.
        const live = current.find(p => p.id === project.id) ?? project;
        if (!live.isInFocus && focusToggleBlocked(current, project.id)) {
            Alert.alert('Focus is full', `You can focus up to ${MAX_IN_FOCUS} projects at once. Turn one off to focus another.`);
            return;
        }

        const next = !live.isInFocus;
        commitProjects(setFocus(current, project.id, next));

        // Claim the latest token before awaiting, so an older refetch can't clobber
        // this flip and a superseding op invalidates our own success apply below.
        const token = projectSeq.next();
        const result = await api.setProjectFocus(project.id, next);

        if (result.ok) {
            if (!projectSeq.isCurrent(token)) return;   // a newer op owns the state now
            commitProjects(replaceProject(projectsRef.current ?? current, result.data));
        } else {
            // Always revert a failed flip, even if superseded, so the list never shows
            // a focus the server rejected (e.g. a race lost the cap 409).
            commitProjects(setFocus(projectsRef.current ?? current, project.id, live.isInFocus));
            Alert.alert(next ? "Couldn't focus project" : "Couldn't unfocus project", result.error);
        }
    }

    function openCreateProject() {
        setProjectModalMode('create');
        setEditingProject(null);
        setProjectModalVisible(true);
    }

    function openEditProject(project: Project) {
        setProjectModalMode('edit');
        setEditingProject(project);
        setProjectModalVisible(true);
    }

    function handleProjectSaved(saved: Project) {
        const current = projectsRef.current ?? [];
        commitProjects(projectModalMode === 'create' ? applyProjectCreated(current, saved) : replaceProject(current, saved));
        setProjectModalVisible(false);
        loadProjects(false);
        // A rename flows into task chips / group headers, so refresh the backlog too.
        if (projectModalMode === 'edit') loadBuckets(false);
    }

    function handleProjectDeleted(projectId: string) {
        commitProjects(withoutProject(projectsRef.current ?? [], projectId));
        setProjectModalVisible(false);
        loadProjects(false);
        // Deleting a project returns its tasks to Todos server-side (SetNull); refresh
        // the backlog so chips clear and the tasks re-home under Todos.
        loadBuckets(false);
    }

    const ready = !loading && !error && buckets !== null && projects !== null;

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Backlog</Text>
                <View style={styles.headerRight}>
                    {ready && <ViewToggle view={view} onChange={setView} />}
                    <TouchableOpacity style={styles.seeAllLink} activeOpacity={0.6} onPress={() => router.push('/tasks')}>
                        <Text style={styles.seeAllText}>See all</Text>
                        <Ionicons name="chevron-forward" size={14} color={colors.accent.strong} />
                    </TouchableOpacity>
                </View>
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

            {ready && (
                view === 'list' ? (
                    <ListView
                        buckets={buckets}
                        projects={projects}
                        open={open}
                        arrivedTaskId={arrivedTaskId}
                        receivedSection={receivedSection}
                        onToggleSection={(key) => setOpen(prev => ({ ...prev, [key]: !prev[key] }))}
                        onTaskPress={(taskId) => router.push(`/task/${taskId}`)}
                        onToggled={handleToggled}
                        onToggleFocus={handleToggleFocus}
                        onEditProject={openEditProject}
                    />
                ) : (
                    <GroupsView
                        buckets={buckets}
                        projects={projects}
                        onTaskPress={(taskId) => router.push(`/task/${taskId}`)}
                        onToggleFocus={handleToggleFocus}
                        onEditProject={openEditProject}
                    />
                )
            )}

            {ready && (
                <CreateFab onNewTask={() => setShowCreateTask(true)} onNewProject={openCreateProject} />
            )}

            <CreateTaskModal
                visible={showCreateTask}
                onClose={() => setShowCreateTask(false)}
                onCreated={(task) => {
                    if (buckets) {
                        const { buckets: next, dest } = applyTaskCreated(buckets, task);
                        setBuckets(next);
                        flashArrival(task.id, dest);
                    }
                    loadBuckets(false);
                    setShowCreateTask(false);
                }}
            />

            <ProjectFormModal
                visible={projectModalVisible}
                mode={projectModalMode}
                project={editingProject}
                onClose={() => setProjectModalVisible(false)}
                onSaved={handleProjectSaved}
                onDeleted={handleProjectDeleted}
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
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    seeAllLink: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    seeAllText: { fontSize: 14, fontWeight: '500', color: colors.accent.strong, letterSpacing: -0.15 },

    viewToggle: { flexDirection: 'row', backgroundColor: colors.surface.sunken, borderRadius: radius.pill, padding: 2 },
    viewToggleBtn: { width: 34, height: 28, justifyContent: 'center', alignItems: 'center', borderRadius: radius.pill },
    viewToggleBtnActive: { backgroundColor: colors.accent.tint },

    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xxl },
    errorText: { fontSize: 14, color: colors.text.secondary, textAlign: 'center' },

    illustration: { alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xxl, height: 80 },
    emptyTitle: { fontSize: 20, fontWeight: '500', color: colors.text.primary, marginBottom: spacing.sm },
    emptySubtitle: { fontSize: 14, color: colors.text.secondary, textAlign: 'center', maxWidth: 220 },

    list: { padding: spacing.lg, gap: spacing.sm + 2, paddingBottom: 120 },
    counterRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: spacing.xs },
    emptyHint: {
        fontSize: 13,
        color: colors.text.muted,
        fontStyle: 'italic',
        textAlign: 'center',
        marginVertical: spacing.md,
        paddingHorizontal: spacing.xl,
    },

    zone: { gap: 10 },
    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 40,
        marginVertical: -8,  // visual rhythm stays tight while the hit area spans 40px
    },
    sectionLabel: { fontSize: 11, color: 'rgba(122,115,106,0.5)', letterSpacing: 0.5, textTransform: 'uppercase' },
    sectionCount: { fontSize: 11, color: 'rgba(122,115,106,0.75)', fontWeight: '600', fontVariant: ['tabular-nums'] },
    sectionDescription: { fontSize: 12, color: 'rgba(122,115,106,0.7)', marginLeft: 19, letterSpacing: -0.1 },
    sectionHint: { fontSize: 12, color: 'rgba(122,115,106,0.45)', fontStyle: 'italic', marginLeft: 19 },
    cardGroup: { gap: 8 },

    taskCard: {
        backgroundColor: colors.surface.raised,
        borderWidth: 1,
        borderColor: colors.border.hairline,
        borderRadius: radius.md,
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
        borderRadius: radius.md,   // matches taskCard so the wash tracks the rounded edge
        backgroundColor: 'rgba(212,165,116,0.28)',
    },
    taskCardContent: { flex: 1 },
    taskTitle: { fontSize: 14, fontWeight: '500', color: colors.text.primary, letterSpacing: -0.15 },
    taskTitleDone: { color: colors.text.secondary },
    badgeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6 },

    toggleStack: { width: 22, height: 22 },
    toggleFilled: { position: 'absolute', top: 0, left: 0 },

    badge: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
    badgeText: { fontSize: 11, fontWeight: '500' },
    badgeInProgress: { backgroundColor: 'rgba(212,165,116,0.1)' },
    badgeTextInProgress: { color: colors.accent.default },
    badgeDone: { backgroundColor: 'rgba(92,82,72,0.10)' },
    badgeTextDone: { color: '#5c5248' },
    badgeMuted: { backgroundColor: 'rgba(232,228,221,0.4)' },
    badgeTextMuted: { color: 'rgba(122,115,106,0.6)' },
    metaText: { fontSize: 11, fontWeight: '500', color: colors.text.secondary, fontVariant: ['tabular-nums'] },

    projChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        maxWidth: 140,
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: radius.pill,
        backgroundColor: colors.accent.tint,
    },
    projChipText: { fontSize: 11, fontWeight: '500', color: colors.accent.strong },

    focusBtn: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
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

    segmentWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
    segment: { flexDirection: 'row', backgroundColor: colors.surface.sunken, borderRadius: radius.pill, padding: 3 },
    segmentBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radius.pill },
    segmentBtnActive: { backgroundColor: colors.surface.raised, ...shadow.soft },
    segmentText: { fontSize: 14, fontWeight: '500', color: colors.text.secondary },
    segmentTextActive: { color: colors.text.primary },

    projCard: {
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
    projCardBody: { flex: 1, gap: spacing.xs },
    projName: { fontSize: 15, fontWeight: '500', color: colors.text.primary, letterSpacing: -0.15 },
    projGoal: { fontSize: 13, color: colors.text.secondary, lineHeight: 18 },
    projGoalMuted: { fontSize: 13, color: colors.text.muted, fontStyle: 'italic' },
    projNotes: { fontSize: 12, color: colors.text.muted, lineHeight: 17 },

    lensRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.md,
    },
    lensPills: { flexDirection: 'row', gap: spacing.sm },
    lensPill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: spacing.md,
        paddingVertical: 6,
        borderRadius: radius.pill,
        backgroundColor: colors.surface.sunken,
    },
    lensPillActive: { backgroundColor: colors.accent.tint },
    lensText: { fontSize: 13, fontWeight: '500', color: colors.text.secondary },
    lensTextActive: { color: colors.accent.strong },

    groupCard: {
        backgroundColor: colors.surface.raised,
        borderWidth: 1,
        borderColor: colors.border.hairline,
        borderRadius: radius.lg,
        padding: spacing.md,
        gap: spacing.sm,
    },
    todosGroup: { backgroundColor: colors.surface.block, borderStyle: 'dashed', borderColor: colors.border.warm },
    groupHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    groupHeaderMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    groupTitleCol: { flex: 1, gap: 2 },
    groupTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    groupName: { fontSize: 15, fontWeight: '600', color: colors.text.primary, letterSpacing: -0.2 },
    groupCount: { fontSize: 11, fontWeight: '600', color: 'rgba(122,115,106,0.75)', fontVariant: ['tabular-nums'] },
    groupGoal: { fontSize: 12, color: colors.text.secondary },
    groupEdit: { width: 28, height: 28, justifyContent: 'center', alignItems: 'center' },
    groupTasks: { gap: spacing.sm, marginTop: spacing.xs },
    groupHint: { fontSize: 12, color: 'rgba(122,115,106,0.45)', fontStyle: 'italic', marginTop: spacing.xs, marginLeft: 22 },

    fabBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    fabWrap: { position: 'absolute', bottom: 16, right: 16, alignItems: 'flex-end', gap: spacing.sm },
    fabActions: { alignItems: 'flex-end', gap: spacing.sm },
    fabAction: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 38,
        paddingHorizontal: 14,
        borderRadius: radius.xl,
        backgroundColor: colors.surface.raised,
        borderWidth: 1,
        borderColor: colors.border.hairline,
        ...shadow.soft,
    },
    fabActionText: { fontSize: 14, fontWeight: '500', color: colors.text.primary, letterSpacing: -0.2 },
    fab: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        height: 40,
        paddingHorizontal: 14,
        borderRadius: radius.xl,
        backgroundColor: colors.accent.default,
        justifyContent: 'center',
        ...shadow.soft,
    },
    fabText: { fontSize: 14, fontWeight: '500', color: colors.text.onAccent, letterSpacing: -0.2 },
});
