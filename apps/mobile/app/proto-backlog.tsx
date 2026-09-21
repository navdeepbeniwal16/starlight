/**
 * PROTOTYPE — throwaway. Delete before merging to a feature branch.
 *
 * Question it answers: how should Projects fold into the Backlog screen so the two
 * stop being separate tabs? (STA-16 — merge Backlog + Projects, "intuitive over explicit".)
 *
 * Three structurally-different answers, switch with the floating bar (or ←/→ on web):
 *   A — Segmented tabs   : literal "Tasks | Projects" toggle inside one screen.
 *   B — Grouped list     : no tab at all; projects ARE the backlog's section headers.
 *   C — Filter pill rail : one task list, a horizontal rail of project lenses on top.
 *
 * Root-level route (no Clerk guard) with mock in-memory data, so it runs with zero
 * server/login:   cd apps/mobile && npm run web   →   http://localhost:8081/proto-backlog
 * Real theme tokens + real focus-cap logic; create/edit are stubbed (Alerts) — the
 * design question is placement, not the form.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Alert,
    Platform,
} from "react-native";
import Animated, { FadeIn, LinearTransition } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing, shadow } from "../lib/theme";
import type { Project } from "../lib/api.types";
import {
    MAX_IN_FOCUS,
    inFocusCount,
    focusToggleBlocked,
    setFocus,
} from "../lib/projectState";

// ── Mock data ────────────────────────────────────────────────────────────────
// Shapes mirror lib/api.types (Project / BacklogTask) plus a projectId link that
// the real backlog task doesn't carry yet — the whole point being explored.

// Reuse the real Project shape so lib/projectState's cap helpers accept it verbatim.
type PProject = Project;
type PStatus = "TODO" | "IN_PROGRESS" | "DONE";
type PTask = {
    id: string;
    title: string;
    status: PStatus;
    progress: number;
    projectId: string | null; // null → Todos
    deadline?: string;
};

const SEED_PROJECTS: PProject[] = [
    { id: "p1", name: "Launch v2", goal: "Ship the redesign to TestFlight", notes: null, isInFocus: true },
    { id: "p2", name: "Health reset", goal: "Back to 3 runs a week", notes: null, isInFocus: true },
    { id: "p3", name: "Reading", goal: "Finish 2 books this month", notes: null, isInFocus: false },
    { id: "p4", name: "Home admin", goal: null, notes: null, isInFocus: false },
];

const TASKS: PTask[] = [
    { id: "t1", title: "Wire up onboarding flow", status: "IN_PROGRESS", progress: 60, projectId: "p1" },
    { id: "t2", title: "Fix dark-mode contrast", status: "TODO", progress: 0, projectId: "p1" },
    { id: "t3", title: "Cut TestFlight build 42", status: "TODO", progress: 0, projectId: "p1", deadline: "Sep 24" },
    { id: "t4", title: "Sunday long run", status: "TODO", progress: 0, projectId: "p2" },
    { id: "t5", title: "Meal prep for the week", status: "IN_PROGRESS", progress: 40, projectId: "p2" },
    { id: "t6", title: "Finish 'Deep Work' ch. 5", status: "IN_PROGRESS", progress: 75, projectId: "p3" },
    { id: "t7", title: "Start 'The Pragmatic Programmer'", status: "TODO", progress: 0, projectId: "p3" },
    { id: "t8", title: "Renew car registration", status: "TODO", progress: 0, projectId: "p4", deadline: "Sep 30" },
    { id: "t9", title: "Fix the leaking tap", status: "DONE", progress: 100, projectId: "p4" },
    { id: "t10", title: "Reply to Sam's email", status: "TODO", progress: 0, projectId: null },
    { id: "t11", title: "Book a dentist appointment", status: "TODO", progress: 0, projectId: null },
    { id: "t12", title: "Pick up the parcel", status: "DONE", progress: 100, projectId: null },
];

const TODOS_ID = "__todos__";

function tasksFor(projectId: string | null): PTask[] {
    return TASKS.filter((t) => t.projectId === projectId);
}

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
                        {task.deadline ? <Text style={styles.metaText}>Due {task.deadline}</Text> : null}
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

function Fab({ label, onPress }: { label: string; onPress: () => void }) {
    return (
        <View style={styles.fabWrap}>
            <TouchableOpacity style={styles.fab} activeOpacity={0.85} onPress={onPress}>
                <Ionicons name="add" size={18} color={colors.text.onAccent} />
                <Text style={styles.fabText}>{label}</Text>
            </TouchableOpacity>
        </View>
    );
}

const stubCreateProject = () =>
    Alert.alert("Prototype", "The create/edit-project form would open here (name + goal).");
const stubEditProject = (name: string) =>
    Alert.alert("Prototype", `Edit "${name}" — rename, set goal, or delete (tasks return to Todos).`);
const stubCreateTask = () => Alert.alert("Prototype", "The create-task form would open here.");

// ── Variant A — Segmented "Tasks | Projects" tabs ────────────────────────────
// The literal reading of the ask: one screen, an inner segmented control. Explicit
// and familiar; project↔task link shown only as a chip on each task.

function VariantA({
    projects,
    onToggleFocus,
}: {
    projects: PProject[];
    onToggleFocus: (id: string) => void;
}) {
    const [seg, setSeg] = useState<"tasks" | "projects">("tasks");
    const focusCount = inFocusCount(projects);
    const nameOf = (id: string | null) => projects.find((p) => p.id === id)?.name;

    return (
        <>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Backlog</Text>
            </View>

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
                    {TASKS.map((t) => (
                        <TaskRow key={t.id} task={t} projectName={nameOf(t.projectId)} />
                    ))}
                </ScrollView>
            ) : (
                <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
                    <View style={styles.counterRow}>
                        <FocusCounter count={focusCount} />
                    </View>
                    {projects.map((p) => (
                        <View key={p.id} style={styles.projCard}>
                            <TouchableOpacity
                                style={styles.projCardBody}
                                activeOpacity={0.7}
                                onPress={() => stubEditProject(p.name)}
                            >
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
                    <View style={[styles.projCard, styles.todosCard]}>
                        <View style={styles.projCardBody}>
                            <View style={styles.todosTitleRow}>
                                <Ionicons name="file-tray-outline" size={16} color={colors.text.secondary} />
                                <Text style={styles.projName}>Todos</Text>
                            </View>
                            <Text style={styles.projGoalMuted}>Tasks not assigned to a project</Text>
                        </View>
                    </View>
                </ScrollView>
            )}

            <Fab label={seg === "tasks" ? "Task" : "Project"} onPress={seg === "tasks" ? stubCreateTask : stubCreateProject} />
        </>
    );
}

// ── Variant B — Grouped list, projects as collapsible section headers ────────
// No tab. Projects ARE the structure of the backlog. Focus is toggled right on the
// section header where the project's tasks live. A top "All / In focus" lens gives
// focus a job. Most "intuitive over explicit".

function VariantB({
    projects,
    onToggleFocus,
}: {
    projects: PProject[];
    onToggleFocus: (id: string) => void;
}) {
    const [lens, setLens] = useState<"all" | "focus">("all");
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const focusCount = inFocusCount(projects);

    const shown = lens === "focus" ? projects.filter((p) => p.isInFocus) : projects;
    const toggle = (id: string) => setCollapsed((c) => ({ ...c, [id]: !c[id] }));

    return (
        <>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Backlog</Text>
                <FocusCounter count={focusCount} />
            </View>

            <View style={styles.lensRow}>
                {(["all", "focus"] as const).map((key) => (
                    <TouchableOpacity
                        key={key}
                        style={[styles.lensPill, lens === key && styles.lensPillActive]}
                        activeOpacity={0.7}
                        onPress={() => setLens(key)}
                    >
                        {key === "focus" ? (
                            <Ionicons
                                name="star"
                                size={11}
                                color={lens === key ? colors.accent.strong : colors.text.secondary}
                            />
                        ) : null}
                        <Text style={[styles.lensText, lens === key && styles.lensTextActive]}>
                            {key === "all" ? "All projects" : "In focus"}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
                {shown.map((p) => {
                    const isOpen = !collapsed[p.id];
                    const list = tasksFor(p.id);
                    return (
                        <Animated.View key={p.id} layout={LinearTransition.duration(240)} style={styles.groupCard}>
                            <View style={styles.groupHeader}>
                                <TouchableOpacity
                                    style={styles.groupHeaderMain}
                                    activeOpacity={0.6}
                                    onPress={() => toggle(p.id)}
                                >
                                    <Ionicons
                                        name={isOpen ? "chevron-down" : "chevron-forward"}
                                        size={14}
                                        color="rgba(122,115,106,0.7)"
                                    />
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

                {/* Todos always last; never focusable. Hidden by the "In focus" lens. */}
                {lens === "all" ? (
                    <Animated.View layout={LinearTransition.duration(240)} style={[styles.groupCard, styles.todosGroup]}>
                        <View style={styles.groupHeader}>
                            <TouchableOpacity
                                style={styles.groupHeaderMain}
                                activeOpacity={0.6}
                                onPress={() => toggle(TODOS_ID)}
                            >
                                <Ionicons
                                    name={collapsed[TODOS_ID] ? "chevron-forward" : "chevron-down"}
                                    size={14}
                                    color="rgba(122,115,106,0.7)"
                                />
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

                <TouchableOpacity style={styles.newProjectRow} activeOpacity={0.7} onPress={stubCreateProject}>
                    <Ionicons name="add" size={16} color={colors.accent.strong} />
                    <Text style={styles.newProjectText}>New project</Text>
                </TouchableOpacity>
            </ScrollView>

            <Fab label="Task" onPress={stubCreateTask} />
        </>
    );
}

// ── Variant C — Filter pill rail, one task list, projects as lenses ──────────
// Task-centric. A horizontal rail selects which lens filters the single list.
// Default lens is "In Focus" (union of focused projects). Stars on project pills
// toggle focus in place; "Manage" reaches rename/delete/goal.

function VariantC({
    projects,
    onToggleFocus,
}: {
    projects: PProject[];
    onToggleFocus: (id: string) => void;
}) {
    const [sel, setSel] = useState<string>("focus"); // 'focus' | 'all' | TODOS_ID | projectId
    const focusCount = inFocusCount(projects);
    const nameOf = (id: string | null) => projects.find((p) => p.id === id)?.name;

    const visibleTasks = useMemo(() => {
        if (sel === "all") return TASKS;
        if (sel === TODOS_ID) return tasksFor(null);
        if (sel === "focus") {
            const ids = new Set(projects.filter((p) => p.isInFocus).map((p) => p.id));
            return TASKS.filter((t) => t.projectId && ids.has(t.projectId));
        }
        return tasksFor(sel);
    }, [sel, projects]);

    return (
        <>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Backlog</Text>
                <TouchableOpacity style={styles.manageBtn} activeOpacity={0.6} onPress={stubCreateProject}>
                    <Ionicons name="options-outline" size={14} color={colors.accent.strong} />
                    <Text style={styles.manageText}>Manage</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.railWrap}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.rail}
                >
                    <TouchableOpacity
                        style={[styles.railPill, sel === "focus" && styles.railPillActive]}
                        activeOpacity={0.7}
                        onPress={() => setSel("focus")}
                    >
                        <Ionicons
                            name="star"
                            size={12}
                            color={sel === "focus" ? colors.text.onAccent : colors.accent.strong}
                        />
                        <Text style={[styles.railText, sel === "focus" && styles.railTextActive]}>
                            In Focus · {focusCount}/{MAX_IN_FOCUS}
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.railPill, sel === "all" && styles.railPillActive]}
                        activeOpacity={0.7}
                        onPress={() => setSel("all")}
                    >
                        <Text style={[styles.railText, sel === "all" && styles.railTextActive]}>All</Text>
                    </TouchableOpacity>

                    {projects.map((p) => {
                        const active = sel === p.id;
                        const blocked = !p.isInFocus && focusToggleBlocked(projects, p.id);
                        return (
                            <View key={p.id} style={[styles.railPill, styles.railPillProject, active && styles.railPillActive]}>
                                <TouchableOpacity
                                    onPress={() => onToggleFocus(p.id)}
                                    hitSlop={8}
                                    style={styles.railStar}
                                >
                                    <Ionicons
                                        name={p.isInFocus ? "star" : "star-outline"}
                                        size={13}
                                        color={
                                            active
                                                ? colors.text.onAccent
                                                : p.isInFocus
                                                ? colors.accent.strong
                                                : blocked
                                                ? colors.text.muted
                                                : colors.text.secondary
                                        }
                                    />
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => setSel(p.id)} activeOpacity={0.7}>
                                    <Text style={[styles.railText, active && styles.railTextActive]} numberOfLines={1}>
                                        {p.name}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        );
                    })}

                    <TouchableOpacity
                        style={[styles.railPill, sel === TODOS_ID && styles.railPillActive]}
                        activeOpacity={0.7}
                        onPress={() => setSel(TODOS_ID)}
                    >
                        <Ionicons
                            name="file-tray-outline"
                            size={12}
                            color={sel === TODOS_ID ? colors.text.onAccent : colors.text.secondary}
                        />
                        <Text style={[styles.railText, sel === TODOS_ID && styles.railTextActive]}>Todos</Text>
                    </TouchableOpacity>
                </ScrollView>
            </View>

            <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
                {sel === "focus" && focusCount === 0 ? (
                    <Text style={styles.emptyHint}>
                        No projects in focus. Tap a ☆ on the rail to focus up to {MAX_IN_FOCUS}.
                    </Text>
                ) : null}
                {visibleTasks.map((t) => (
                    <TaskRow
                        key={t.id}
                        task={t}
                        projectName={sel === "focus" || sel === "all" ? nameOf(t.projectId) : undefined}
                    />
                ))}
                {visibleTasks.length === 0 && sel !== "focus" ? (
                    <Text style={styles.emptyHint}>Nothing here yet.</Text>
                ) : null}
            </ScrollView>

            <Fab label="Task" onPress={stubCreateTask} />
        </>
    );
}

// ── Faux app shell + variant switcher ────────────────────────────────────────

// The real tab bar, minus a "Projects" tab — the merge, made visible. Non-interactive.
function FauxTabBar() {
    const tabs = [
        { icon: "today-outline", label: "Today", active: false },
        { icon: "list", label: "Backlog", active: true },
        { icon: "settings-outline", label: "Settings", active: false },
    ] as const;
    return (
        <View style={styles.tabBar}>
            {tabs.map((t) => (
                <View key={t.label} style={styles.tabItem}>
                    <Ionicons
                        name={t.icon}
                        size={22}
                        color={t.active ? colors.text.primary : colors.text.secondary}
                    />
                    <Text style={[styles.tabLabel, t.active && styles.tabLabelActive]}>{t.label}</Text>
                </View>
            ))}
        </View>
    );
}

const VARIANTS = [
    { key: "A", name: "Segmented tabs" },
    { key: "B", name: "Grouped list" },
    { key: "C", name: "Filter rail" },
] as const;

function Switcher({ current, onChange }: { current: string; onChange: (k: string) => void }) {
    if (process.env.NODE_ENV === "production") return null;
    const idx = Math.max(0, VARIANTS.findIndex((v) => v.key === current));
    const cur = VARIANTS[idx];
    const go = (delta: number) => onChange(VARIANTS[(idx + delta + VARIANTS.length) % VARIANTS.length].key);

    return (
        <View style={styles.switcher} pointerEvents="box-none">
            <View style={styles.switcherBar}>
                <TouchableOpacity onPress={() => go(-1)} style={styles.switcherArrow} hitSlop={10}>
                    <Ionicons name="chevron-back" size={18} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.switcherLabel}>
                    {cur.key} · {cur.name}
                </Text>
                <TouchableOpacity onPress={() => go(1)} style={styles.switcherArrow} hitSlop={10}>
                    <Ionicons name="chevron-forward" size={18} color="#fff" />
                </TouchableOpacity>
            </View>
        </View>
    );
}

export default function ProtoBacklogScreen() {
    const params = useLocalSearchParams<{ variant?: string }>();
    const variant = (Array.isArray(params.variant) ? params.variant[0] : params.variant)?.toUpperCase() || "A";
    const setVariant = useCallback((k: string) => router.setParams({ variant: k }), []);

    const [projects, setProjects] = useState<PProject[]>(SEED_PROJECTS);

    // Real cap logic (lib/projectState): turning ON past the cap is blocked and
    // surfaced as the 3/3 counter going full, not a raw error; swapping OFF→ON is free.
    const onToggleFocus = useCallback((id: string) => {
        setProjects((prev) => {
            const target = prev.find((p) => p.id === id);
            if (target && !target.isInFocus && focusToggleBlocked(prev, id)) {
                Alert.alert(
                    "Focus is full",
                    `You can focus up to ${MAX_IN_FOCUS} projects. Turn one off to focus another.`,
                );
                return prev;
            }
            return setFocus(prev, id, !target?.isInFocus);
        });
    }, []);

    // Web-only keyboard cycling; ignored while typing in a field.
    useEffect(() => {
        if (Platform.OS !== "web" || typeof window === "undefined") return;
        const onKey = (e: KeyboardEvent) => {
            const el = e.target as HTMLElement | null;
            const tag = el?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return;
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            const idx = Math.max(0, VARIANTS.findIndex((v) => v.key === variant));
            const delta = e.key === "ArrowRight" ? 1 : -1;
            setVariant(VARIANTS[(idx + delta + VARIANTS.length) % VARIANTS.length].key);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [variant, setVariant]);

    return (
        <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
            <View style={styles.screen}>
                {variant === "B" ? (
                    <VariantB projects={projects} onToggleFocus={onToggleFocus} />
                ) : variant === "C" ? (
                    <VariantC projects={projects} onToggleFocus={onToggleFocus} />
                ) : (
                    <VariantA projects={projects} onToggleFocus={onToggleFocus} />
                )}
            </View>
            <FauxTabBar />
            <Switcher current={variant} onChange={setVariant} />
        </SafeAreaView>
    );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.surface.page },
    screen: { flex: 1 },

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
    progressPct: {
        fontSize: 11,
        fontWeight: "600",
        color: colors.text.secondary,
        fontVariant: ["tabular-nums"],
    },

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
    focusCounterText: {
        fontSize: 12,
        fontWeight: "500",
        color: colors.text.secondary,
        fontVariant: ["tabular-nums"],
    },
    focusCounterTextFull: { color: colors.accent.strong },

    // Variant A — segmented control
    segmentWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
    segment: {
        flexDirection: "row",
        backgroundColor: colors.surface.sunken,
        borderRadius: radius.pill,
        padding: 3,
    },
    segmentBtn: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: radius.pill },
    segmentBtnActive: { backgroundColor: colors.surface.raised, ...shadow.soft },
    segmentText: { fontSize: 14, fontWeight: "500", color: colors.text.secondary },
    segmentTextActive: { color: colors.text.primary },

    // Variant A — project cards
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

    // Variant B — lens pills + grouped sections
    lensRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
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
    groupCount: {
        fontSize: 11,
        fontWeight: "600",
        color: "rgba(122,115,106,0.75)",
        fontVariant: ["tabular-nums"],
    },
    groupGoal: { fontSize: 12, color: colors.text.secondary },
    groupEdit: { width: 28, height: 28, justifyContent: "center", alignItems: "center" },
    groupTasks: { gap: spacing.sm, marginTop: spacing.xs },
    newProjectRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: spacing.xs,
        paddingVertical: spacing.md,
    },
    newProjectText: { fontSize: 14, fontWeight: "500", color: colors.accent.strong },

    // Variant C — rail
    manageBtn: { flexDirection: "row", alignItems: "center", gap: 3 },
    manageText: { fontSize: 14, fontWeight: "500", color: colors.accent.strong, letterSpacing: -0.15 },
    railWrap: { borderBottomWidth: 1, borderBottomColor: colors.border.hairline },
    rail: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
    railPill: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: spacing.md,
        paddingVertical: 7,
        borderRadius: radius.pill,
        backgroundColor: colors.surface.sunken,
    },
    railPillProject: { paddingLeft: spacing.sm },
    railPillActive: { backgroundColor: colors.accent.default },
    railStar: { padding: 2 },
    railText: { fontSize: 13, fontWeight: "500", color: colors.text.secondary, maxWidth: 150 },
    railTextActive: { color: colors.text.onAccent },

    // FAB
    fabWrap: { position: "absolute", bottom: 84, right: 16 },
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

    // Faux tab bar
    tabBar: {
        flexDirection: "row",
        borderTopWidth: 1,
        borderTopColor: colors.border.hairline,
        backgroundColor: colors.surface.raised,
        paddingTop: 8,
        paddingBottom: 10,
    },
    tabItem: { flex: 1, alignItems: "center", gap: 3 },
    tabLabel: { fontSize: 12, fontWeight: "500", color: colors.text.secondary },
    tabLabelActive: { color: colors.text.primary },

    // Prototype switcher — deliberately un-app-like so it reads as scaffolding.
    switcher: { position: "absolute", left: 0, right: 0, bottom: 70, alignItems: "center" },
    switcherBar: {
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        backgroundColor: "#2a2621",
        paddingHorizontal: spacing.sm,
        paddingVertical: 6,
        borderRadius: radius.pill,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 12,
        elevation: 8,
    },
    switcherArrow: { width: 30, height: 30, justifyContent: "center", alignItems: "center" },
    switcherLabel: {
        fontSize: 13,
        fontWeight: "600",
        color: "#fff",
        minWidth: 130,
        textAlign: "center",
        fontVariant: ["tabular-nums"],
    },
});
