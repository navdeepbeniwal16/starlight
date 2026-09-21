/**
 * PROTOTYPE (branch proto/sta-16-backlog-projects-merge) — replaces the real Backlog
 * tab so the merge can be felt in the app. Open Backlog on a simulator/device.
 *
 * Two toggleable views of the same tasks+projects (STA-16 — "intuitive over explicit"):
 *   A — List view    : inner "Tasks | Projects" segments. Tasks grouped by lifecycle
 *                      (carried over / scheduled / remaining / done) with a project chip;
 *                      Projects = Todos first, then project cards with focus stars.
 *   B — Groups view  : projects as collapsible sections, focus toggled on the header,
 *                      an All / In-focus lens.
 *
 * Constant across both views (so users always know where things are): the header
 * (title + view toggle + See all) and the "+ New" create FAB (New task / New project).
 * Only the task/project content swaps.
 *
 * Data is mock/in-memory — real backlog tasks carry no projectId yet, so grouping by
 * project can't run on live data until the API surfaces it. Real theme tokens + real
 * focus-cap logic (lib/projectState); create/edit are stubbed to Alerts.
 */
import { useCallback, useState } from "react";
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Pressable,
    Alert,
} from "react-native";
import Animated, { FadeIn, LinearTransition } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing, shadow } from "../../lib/theme";
import type { Project } from "../../lib/api.types";
import {
    MAX_IN_FOCUS,
    inFocusCount,
    focusToggleBlocked,
    setFocus,
} from "../../lib/projectState";

// ── Mock data ────────────────────────────────────────────────────────────────
// Shapes mirror lib/api.types (Project / BacklogTask) plus a projectId link and a
// lifecycle bucket that the real backlog task doesn't carry yet — the thing being explored.

type PProject = Project; // reuse the real shape so projectState's cap helpers accept it
type PStatus = "TODO" | "IN_PROGRESS" | "DONE";
type Bucket = "carriedOver" | "scheduled" | "remaining" | "doneToday";
type PTask = {
    id: string;
    title: string;
    status: PStatus;
    progress: number;
    projectId: string | null; // null → Todos
    bucket: Bucket;
    scheduledMeta?: string;
    deadline?: string;
};

const SEED_PROJECTS: PProject[] = [
    { id: "p1", name: "Launch v2", goal: "Ship the redesign to TestFlight", notes: null, isInFocus: true },
    { id: "p2", name: "Health reset", goal: "Back to 3 runs a week", notes: null, isInFocus: true },
    { id: "p3", name: "Reading", goal: "Finish 2 books this month", notes: null, isInFocus: false },
    { id: "p4", name: "Home admin", goal: null, notes: null, isInFocus: false },
];

const TASKS: PTask[] = [
    { id: "t1", title: "Wire up onboarding flow", status: "IN_PROGRESS", progress: 60, projectId: "p1", bucket: "scheduled", scheduledMeta: "09:00 · Morning focus" },
    { id: "t2", title: "Fix dark-mode contrast", status: "TODO", progress: 0, projectId: "p1", bucket: "remaining" },
    { id: "t3", title: "Cut TestFlight build 42", status: "TODO", progress: 0, projectId: "p1", bucket: "remaining", deadline: "Sep 24" },
    { id: "t4", title: "Sunday long run", status: "TODO", progress: 0, projectId: "p2", bucket: "carriedOver" },
    { id: "t5", title: "Meal prep for the week", status: "IN_PROGRESS", progress: 40, projectId: "p2", bucket: "scheduled", scheduledMeta: "18:00 · Evening" },
    { id: "t6", title: "Finish 'Deep Work' ch. 5", status: "IN_PROGRESS", progress: 75, projectId: "p3", bucket: "remaining" },
    { id: "t7", title: "Start 'The Pragmatic Programmer'", status: "TODO", progress: 0, projectId: "p3", bucket: "remaining" },
    { id: "t8", title: "Renew car registration", status: "TODO", progress: 0, projectId: "p4", bucket: "remaining", deadline: "Sep 30" },
    { id: "t9", title: "Fix the leaking tap", status: "DONE", progress: 100, projectId: "p4", bucket: "doneToday" },
    { id: "t10", title: "Reply to Sam's email", status: "TODO", progress: 0, projectId: null, bucket: "remaining" },
    { id: "t11", title: "Book a dentist appointment", status: "TODO", progress: 0, projectId: null, bucket: "remaining" },
    { id: "t12", title: "Pick up the parcel", status: "DONE", progress: 100, projectId: null, bucket: "doneToday" },
];

const TODOS_ID = "__todos__";

const LIFECYCLE: Array<{ key: Bucket; label: string; desc: string; hint: string; open: boolean }> = [
    { key: "carriedOver", label: "Carried over", desc: "Unfinished tasks carried over from your previous plan", hint: "Nothing carried over", open: true },
    { key: "scheduled", label: "Scheduled today", desc: "Tasks planned into today's blocks", hint: "No plan for today yet", open: true },
    { key: "remaining", label: "Remaining", desc: "Backlog tasks not yet scheduled", hint: "Backlog is clear", open: true },
    { key: "doneToday", label: "Done today", desc: "Tasks you've completed today", hint: "Nothing completed yet", open: false },
];

const tasksFor = (projectId: string | null) => TASKS.filter((t) => t.projectId === projectId);
const tasksInBucket = (bucket: Bucket) => TASKS.filter((t) => t.bucket === bucket);

// ── Small shared pieces ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: PStatus }) {
    if (status === "IN_PROGRESS")
        return (
            <View style={[styles.badge, styles.badgeInProgress]}>
                <Text style={[styles.badgeText, styles.badgeTextInProgress]}>In Progress</Text>
            </View>
        );
    if (status === "DONE")
        return (
            <View style={[styles.badge, styles.badgeDone]}>
                <Text style={[styles.badgeText, styles.badgeTextDone]}>Done</Text>
            </View>
        );
    return (
        <View style={[styles.badge, styles.badgeMuted]}>
            <Text style={[styles.badgeText, styles.badgeTextMuted]}>Todo</Text>
        </View>
    );
}

function ProjectChip({ name }: { name: string }) {
    return (
        <View style={styles.projChip}>
            <Ionicons name="folder-outline" size={10} color={colors.accent.strong} />
            <Text style={styles.projChipText} numberOfLines={1}>
                {name}
            </Text>
        </View>
    );
}

function TaskRow({ task, projectName }: { task: PTask; projectName?: string }) {
    const done = task.status === "DONE";
    return (
        <Animated.View layout={LinearTransition.duration(220)} entering={FadeIn.duration(160)}>
            <View style={[styles.taskCard, done && styles.taskCardDone]}>
                <Ionicons
                    name={done ? "checkmark-circle" : "checkmark-circle-outline"}
                    size={22}
                    color={done ? "#5c5248" : "rgba(122,115,106,0.3)"}
                />
                <View style={styles.taskBody}>
                    <Text style={[styles.taskTitle, done && styles.taskTitleDone]} numberOfLines={2}>
                        {task.title}
                    </Text>
                    <View style={styles.badgeRow}>
                        <StatusBadge status={task.status} />
                        {projectName ? <ProjectChip name={projectName} /> : null}
                        {task.scheduledMeta ? (
                            <Text style={styles.metaText}>{task.scheduledMeta}</Text>
                        ) : task.deadline ? (
                            <Text style={styles.metaText}>Due {task.deadline}</Text>
                        ) : null}
                    </View>
                </View>
                <Text style={styles.progressPct}>{task.progress}%</Text>
            </View>
        </Animated.View>
    );
}

function FocusStar({
    active,
    blocked,
    size = 22,
    onPress,
}: {
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
        >
            <Ionicons
                name={active ? "star" : "star-outline"}
                size={size}
                color={active ? colors.accent.strong : blocked ? colors.text.muted : colors.text.secondary}
            />
        </TouchableOpacity>
    );
}

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

// Collapsible lifecycle section for the List view's Tasks segment.
function LifecycleSection({
    section,
    projectName,
}: {
    section: (typeof LIFECYCLE)[number];
    projectName: (id: string | null) => string | undefined;
}) {
    const [open, setOpen] = useState(section.open);
    const list = tasksInBucket(section.key);
    return (
        <Animated.View layout={LinearTransition.duration(240)} style={styles.zone}>
            <TouchableOpacity style={styles.sectionHeaderRow} activeOpacity={0.6} onPress={() => setOpen((o) => !o)}>
                <Ionicons name={open ? "chevron-down" : "chevron-forward"} size={13} color="rgba(122,115,106,0.6)" />
                <Text style={styles.sectionLabel}>{section.label}</Text>
                <Text style={styles.sectionCount}>{list.length}</Text>
            </TouchableOpacity>
            <Text style={styles.sectionDescription}>{section.desc}</Text>
            {open ? (
                list.length === 0 ? (
                    <Text style={styles.sectionHint}>{section.hint}</Text>
                ) : (
                    <View style={styles.cardGroup}>
                        {list.map((t) => (
                            <TaskRow key={t.id} task={t} projectName={projectName(t.projectId)} />
                        ))}
                    </View>
                )
            ) : null}
        </Animated.View>
    );
}

const stubCreateProject = () =>
    Alert.alert("Prototype", "The create/edit-project form would open here (name + goal).");
const stubEditProject = (name: string) =>
    Alert.alert("Prototype", `Edit "${name}" — rename, set goal, or delete (tasks return to Todos).`);
const stubCreateTask = () => Alert.alert("Prototype", "The create-task form would open here.");

// ── View A — List view (inner Tasks | Projects segments) ─────────────────────

function ViewA({ projects, onToggleFocus }: { projects: PProject[]; onToggleFocus: (id: string) => void }) {
    const [seg, setSeg] = useState<"tasks" | "projects">("tasks");
    const focusCount = inFocusCount(projects);
    const nameOf = (id: string | null) => projects.find((p) => p.id === id)?.name;

    return (
        <>
            <View style={styles.segmentWrap}>
                <View style={styles.segment}>
                    {(["tasks", "projects"] as const).map((key) => (
                        <TouchableOpacity
                            key={key}
                            style={[styles.segmentBtn, seg === key && styles.segmentBtnActive]}
                            activeOpacity={0.7}
                            onPress={() => setSeg(key)}
                        >
                            <Text style={[styles.segmentText, seg === key && styles.segmentTextActive]}>
                                {key === "tasks" ? "Tasks" : "Projects"}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>

            {seg === "tasks" ? (
                <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
                    {LIFECYCLE.map((s) => (
                        <LifecycleSection key={s.key} section={s} projectName={nameOf} />
                    ))}
                </ScrollView>
            ) : (
                <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
                    <View style={styles.counterRow}>
                        <FocusCounter count={focusCount} />
                    </View>

                    {/* Todos first — the common home for anything not under a project. */}
                    <View style={[styles.projCard, styles.todosCard]}>
                        <View style={styles.projCardBody}>
                            <View style={styles.todosTitleRow}>
                                <Ionicons name="file-tray-outline" size={16} color={colors.text.secondary} />
                                <Text style={styles.projName}>Todos</Text>
                                <Text style={styles.groupCount}>{tasksFor(null).length}</Text>
                            </View>
                            <Text style={styles.projGoalMuted}>Tasks not assigned to a project</Text>
                        </View>
                    </View>

                    {projects.map((p) => (
                        <View key={p.id} style={styles.projCard}>
                            <TouchableOpacity style={styles.projCardBody} activeOpacity={0.7} onPress={() => stubEditProject(p.name)}>
                                <Text style={styles.projName} numberOfLines={1}>
                                    {p.name}
                                </Text>
                                <Text style={p.goal ? styles.projGoal : styles.projGoalMuted} numberOfLines={2}>
                                    {p.goal ?? "No goal set"}
                                </Text>
                            </TouchableOpacity>
                            <FocusStar
                                active={p.isInFocus}
                                blocked={!p.isInFocus && focusToggleBlocked(projects, p.id)}
                                onPress={() => onToggleFocus(p.id)}
                            />
                        </View>
                    ))}
                </ScrollView>
            )}
        </>
    );
}

// ── View B — Groups view (projects as collapsible sections) ──────────────────

function ViewB({ projects, onToggleFocus }: { projects: PProject[]; onToggleFocus: (id: string) => void }) {
    const [lens, setLens] = useState<"all" | "focus">("all");
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const focusCount = inFocusCount(projects);

    const shown = lens === "focus" ? projects.filter((p) => p.isInFocus) : projects;
    const toggle = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));

    return (
        <>
            <View style={styles.lensRow}>
                <View style={styles.lensPills}>
                    {(["all", "focus"] as const).map((key) => (
                        <TouchableOpacity
                            key={key}
                            style={[styles.lensPill, lens === key && styles.lensPillActive]}
                            activeOpacity={0.7}
                            onPress={() => setLens(key)}
                        >
                            {key === "focus" ? (
                                <Ionicons name="star" size={11} color={lens === key ? colors.accent.strong : colors.text.secondary} />
                            ) : null}
                            <Text style={[styles.lensText, lens === key && styles.lensTextActive]}>
                                {key === "all" ? "All projects" : "In focus"}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
                <FocusCounter count={focusCount} />
            </View>

            <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
                {shown.map((p) => {
                    const isOpen = !collapsed[p.id];
                    const list = tasksFor(p.id);
                    return (
                        <Animated.View key={p.id} layout={LinearTransition.duration(240)} style={styles.groupCard}>
                            <View style={styles.groupHeader}>
                                <TouchableOpacity style={styles.groupHeaderMain} activeOpacity={0.6} onPress={() => toggle(p.id)}>
                                    <Ionicons name={isOpen ? "chevron-down" : "chevron-forward"} size={14} color="rgba(122,115,106,0.7)" />
                                    <View style={styles.groupTitleCol}>
                                        <View style={styles.groupTitleRow}>
                                            <Text style={styles.groupName} numberOfLines={1}>
                                                {p.name}
                                            </Text>
                                            <Text style={styles.groupCount}>{list.length}</Text>
                                        </View>
                                        {p.goal ? (
                                            <Text style={styles.groupGoal} numberOfLines={1}>
                                                {p.goal}
                                            </Text>
                                        ) : null}
                                    </View>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => stubEditProject(p.name)} hitSlop={8} style={styles.groupEdit}>
                                    <Ionicons name="ellipsis-horizontal" size={16} color={colors.text.muted} />
                                </TouchableOpacity>
                                <FocusStar
                                    active={p.isInFocus}
                                    blocked={!p.isInFocus && focusToggleBlocked(projects, p.id)}
                                    size={20}
                                    onPress={() => onToggleFocus(p.id)}
                                />
                            </View>
                            {isOpen ? (
                                <View style={styles.groupTasks}>
                                    {list.map((t) => (
                                        <TaskRow key={t.id} task={t} />
                                    ))}
                                </View>
                            ) : null}
                        </Animated.View>
                    );
                })}

                {/* Todos stays last in this view (per feedback, B is unchanged here). */}
                {lens === "all" ? (
                    <Animated.View layout={LinearTransition.duration(240)} style={[styles.groupCard, styles.todosGroup]}>
                        <View style={styles.groupHeader}>
                            <TouchableOpacity style={styles.groupHeaderMain} activeOpacity={0.6} onPress={() => toggle(TODOS_ID)}>
                                <Ionicons name={collapsed[TODOS_ID] ? "chevron-forward" : "chevron-down"} size={14} color="rgba(122,115,106,0.7)" />
                                <View style={styles.groupTitleCol}>
                                    <View style={styles.groupTitleRow}>
                                        <Ionicons name="file-tray-outline" size={14} color={colors.text.secondary} />
                                        <Text style={styles.groupName}>Todos</Text>
                                        <Text style={styles.groupCount}>{tasksFor(null).length}</Text>
                                    </View>
                                </View>
                            </TouchableOpacity>
                        </View>
                        {!collapsed[TODOS_ID] ? (
                            <View style={styles.groupTasks}>
                                {tasksFor(null).map((t) => (
                                    <TaskRow key={t.id} task={t} />
                                ))}
                            </View>
                        ) : null}
                    </Animated.View>
                ) : null}
            </ScrollView>
        </>
    );
}

// ── Shared header controls ───────────────────────────────────────────────────

// Top-right toggle between the two views — the real, shipping control (the floating
// dev bar is gone). Sits next to See all.
function ViewToggle({ view, onChange }: { view: "A" | "B"; onChange: (v: "A" | "B") => void }) {
    return (
        <View style={styles.viewToggle}>
            {(
                [
                    { key: "A", icon: "list" },
                    { key: "B", icon: "albums" },
                ] as const
            ).map(({ key, icon }) => {
                const active = view === key;
                return (
                    <TouchableOpacity
                        key={key}
                        style={[styles.viewToggleBtn, active && styles.viewToggleBtnActive]}
                        activeOpacity={0.7}
                        onPress={() => onChange(key)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={key === "A" ? "List view" : "Grouped view"}
                    >
                        <Ionicons name={icon} size={16} color={active ? colors.accent.strong : colors.text.secondary} />
                    </TouchableOpacity>
                );
            })}
        </View>
    );
}

// One create entry point, identical in both views, so the buttons never move. Expands
// to New task / New project.
function CreateFab({ onNewTask, onNewProject }: { onNewTask: () => void; onNewProject: () => void }) {
    const [open, setOpen] = useState(false);
    const pick = (fn: () => void) => {
        setOpen(false);
        fn();
    };
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
                <TouchableOpacity style={styles.fab} activeOpacity={0.85} onPress={() => setOpen((o) => !o)}>
                    <Ionicons name={open ? "close" : "add"} size={18} color={colors.text.onAccent} />
                    <Text style={styles.fabText}>{open ? "Close" : "New"}</Text>
                </TouchableOpacity>
            </View>
        </>
    );
}

export default function BacklogScreen() {
    const router = useRouter();
    const [view, setView] = useState<"A" | "B">("A");
    const [projects, setProjects] = useState<PProject[]>(SEED_PROJECTS);

    // Real cap logic (lib/projectState): turning ON past the cap is blocked and surfaced
    // as the counter going full, not a raw error; swapping OFF→ON is free.
    const onToggleFocus = useCallback((id: string) => {
        setProjects((prev) => {
            const target = prev.find((p) => p.id === id);
            if (target && !target.isInFocus && focusToggleBlocked(prev, id)) {
                Alert.alert("Focus is full", `You can focus up to ${MAX_IN_FOCUS} projects. Turn one off to focus another.`);
                return prev;
            }
            return setFocus(prev, id, !target?.isInFocus);
        });
    }, []);

    return (
        <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Backlog</Text>
                <View style={styles.headerRight}>
                    <ViewToggle view={view} onChange={setView} />
                    <TouchableOpacity style={styles.seeAllLink} activeOpacity={0.6} onPress={() => router.push("/tasks")}>
                        <Text style={styles.seeAllText}>See all</Text>
                        <Ionicons name="chevron-forward" size={14} color={colors.accent.strong} />
                    </TouchableOpacity>
                </View>
            </View>

            {view === "A" ? (
                <ViewA projects={projects} onToggleFocus={onToggleFocus} />
            ) : (
                <ViewB projects={projects} onToggleFocus={onToggleFocus} />
            )}

            <CreateFab onNewTask={stubCreateTask} onNewProject={stubCreateProject} />
        </SafeAreaView>
    );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.surface.page },

    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: spacing.xl,
        paddingTop: spacing.lg,
        paddingBottom: spacing.md,
        borderBottomWidth: 1,
        borderBottomColor: colors.border.hairline,
    },
    headerTitle: { fontSize: 18, fontWeight: "600", color: colors.text.primary, letterSpacing: -0.3 },
    headerRight: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    seeAllLink: { flexDirection: "row", alignItems: "center", gap: 2 },
    seeAllText: { fontSize: 14, fontWeight: "500", color: colors.accent.strong, letterSpacing: -0.15 },

    viewToggle: { flexDirection: "row", backgroundColor: colors.surface.sunken, borderRadius: radius.pill, padding: 2 },
    viewToggleBtn: { width: 34, height: 28, justifyContent: "center", alignItems: "center", borderRadius: radius.pill },
    viewToggleBtnActive: { backgroundColor: colors.accent.tint },

    list: { padding: spacing.lg, gap: spacing.sm + 2, paddingBottom: 120 },
    counterRow: { flexDirection: "row", justifyContent: "flex-end", marginBottom: spacing.xs },
    emptyHint: {
        fontSize: 13,
        color: colors.text.muted,
        fontStyle: "italic",
        textAlign: "center",
        marginVertical: spacing.lg,
        paddingHorizontal: spacing.xl,
    },

    // Lifecycle sections (List view · Tasks)
    zone: { gap: 10 },
    sectionHeaderRow: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32 },
    sectionLabel: { fontSize: 11, color: "rgba(122,115,106,0.5)", letterSpacing: 0.5, textTransform: "uppercase" },
    sectionCount: { fontSize: 11, color: "rgba(122,115,106,0.75)", fontWeight: "600", fontVariant: ["tabular-nums"] },
    sectionDescription: { fontSize: 12, color: "rgba(122,115,106,0.7)", marginLeft: 19, letterSpacing: -0.1 },
    sectionHint: { fontSize: 12, color: "rgba(122,115,106,0.45)", fontStyle: "italic", marginLeft: 19 },
    cardGroup: { gap: 8 },

    // Task card
    taskCard: {
        backgroundColor: colors.surface.raised,
        borderWidth: 1,
        borderColor: colors.border.hairline,
        borderRadius: radius.md,
        paddingHorizontal: 13,
        paddingVertical: 11,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
    },
    taskCardDone: { backgroundColor: "rgba(232,228,221,0.35)" },
    taskBody: { flex: 1 },
    taskTitle: { fontSize: 14, fontWeight: "500", color: colors.text.primary, letterSpacing: -0.15 },
    taskTitleDone: { color: colors.text.secondary },
    badgeRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 6 },
    progressPct: { fontSize: 11, fontWeight: "600", color: colors.text.secondary, fontVariant: ["tabular-nums"] },

    badge: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
    badgeText: { fontSize: 11, fontWeight: "500" },
    badgeInProgress: { backgroundColor: "rgba(212,165,116,0.1)" },
    badgeTextInProgress: { color: colors.accent.default },
    badgeDone: { backgroundColor: "rgba(92,82,72,0.10)" },
    badgeTextDone: { color: "#5c5248" },
    badgeMuted: { backgroundColor: "rgba(232,228,221,0.4)" },
    badgeTextMuted: { color: "rgba(122,115,106,0.6)" },
    metaText: { fontSize: 11, fontWeight: "500", color: colors.text.secondary, fontVariant: ["tabular-nums"] },

    projChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        maxWidth: 140,
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: radius.pill,
        backgroundColor: colors.accent.tint,
    },
    projChipText: { fontSize: 11, fontWeight: "500", color: colors.accent.strong },

    // Focus star + counter
    focusBtn: { width: 32, height: 32, justifyContent: "center", alignItems: "center" },
    focusCounter: {
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.xs,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.xs + 1,
        borderRadius: radius.pill,
        backgroundColor: colors.surface.sunken,
    },
    focusCounterFull: { backgroundColor: colors.accent.tint },
    focusCounterText: { fontSize: 12, fontWeight: "500", color: colors.text.secondary, fontVariant: ["tabular-nums"] },
    focusCounterTextFull: { color: colors.accent.strong },

    // List view · Tasks|Projects segmented control
    segmentWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
    segment: { flexDirection: "row", backgroundColor: colors.surface.sunken, borderRadius: radius.pill, padding: 3 },
    segmentBtn: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: radius.pill },
    segmentBtnActive: { backgroundColor: colors.surface.raised, ...shadow.soft },
    segmentText: { fontSize: 14, fontWeight: "500", color: colors.text.secondary },
    segmentTextActive: { color: colors.text.primary },

    // List view · Projects cards
    projCard: {
        backgroundColor: colors.surface.raised,
        borderWidth: 1,
        borderColor: colors.border.hairline,
        borderRadius: radius.md,
        paddingHorizontal: spacing.md + 1,
        paddingVertical: spacing.md,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
    },
    todosCard: { backgroundColor: colors.surface.block, borderStyle: "dashed", borderColor: colors.border.warm },
    todosTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    projCardBody: { flex: 1, gap: spacing.xs },
    projName: { fontSize: 15, fontWeight: "500", color: colors.text.primary, letterSpacing: -0.15 },
    projGoal: { fontSize: 13, color: colors.text.secondary, lineHeight: 18 },
    projGoalMuted: { fontSize: 13, color: colors.text.muted, fontStyle: "italic" },

    // Groups view · lens row + sections
    lensRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.md,
    },
    lensPills: { flexDirection: "row", gap: spacing.sm },
    lensPill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: spacing.md,
        paddingVertical: 6,
        borderRadius: radius.pill,
        backgroundColor: colors.surface.sunken,
    },
    lensPillActive: { backgroundColor: colors.accent.tint },
    lensText: { fontSize: 13, fontWeight: "500", color: colors.text.secondary },
    lensTextActive: { color: colors.accent.strong },

    groupCard: {
        backgroundColor: colors.surface.raised,
        borderWidth: 1,
        borderColor: colors.border.hairline,
        borderRadius: radius.lg,
        padding: spacing.md,
        gap: spacing.sm,
    },
    todosGroup: { backgroundColor: colors.surface.block, borderStyle: "dashed", borderColor: colors.border.warm },
    groupHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    groupHeaderMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
    groupTitleCol: { flex: 1, gap: 2 },
    groupTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    groupName: { fontSize: 15, fontWeight: "600", color: colors.text.primary, letterSpacing: -0.2 },
    groupCount: { fontSize: 11, fontWeight: "600", color: "rgba(122,115,106,0.75)", fontVariant: ["tabular-nums"] },
    groupGoal: { fontSize: 12, color: colors.text.secondary },
    groupEdit: { width: 28, height: 28, justifyContent: "center", alignItems: "center" },
    groupTasks: { gap: spacing.sm, marginTop: spacing.xs },

    // Create FAB (shared, both views)
    fabBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
    fabWrap: { position: "absolute", bottom: 16, right: 16, alignItems: "flex-end", gap: spacing.sm },
    fabActions: { alignItems: "flex-end", gap: spacing.sm },
    fabAction: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 38,
        paddingHorizontal: 14,
        borderRadius: radius.xl,
        backgroundColor: colors.surface.raised,
        borderWidth: 1,
        borderColor: colors.border.hairline,
        ...shadow.soft,
    },
    fabActionText: { fontSize: 14, fontWeight: "500", color: colors.text.primary, letterSpacing: -0.2 },
    fab: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        height: 40,
        paddingHorizontal: 14,
        borderRadius: radius.xl,
        backgroundColor: colors.accent.default,
        justifyContent: "center",
        ...shadow.soft,
    },
    fabText: { fontSize: 14, fontWeight: "500", color: colors.text.onAccent, letterSpacing: -0.2 },
});
