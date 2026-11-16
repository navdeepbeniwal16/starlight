import { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Stop, Rect } from "react-native-svg";
import Animated, {
    Easing,
    Extrapolation,
    FadeInDown,
    interpolate,
    interpolateColor,
    type SharedValue,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withDelay,
    withRepeat,
    withSequence,
    withTiming,
} from "react-native-reanimated";
import { colors, radius, shadow, spacing } from "../lib/theme";

// Shared decelerate curve used across the app's motion.
const EASE = Easing.bezier(0.2, 0, 0, 1);
// Symmetric curve for the "thinking" breath, which eases in and out.
const EASE_INOUT = Easing.inOut(Easing.ease);

type Point = { x: number; y: number };

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

type AnchorRow = { id: string; kind: 'anchor'; gutter: string; name: string; time: string };
type ContainerRow = { id: string; kind: 'container'; gutter: string; name: string; time: string };
type TimelineRow = AnchorRow | ContainerRow;

const TIMELINE: TimelineRow[] = [
    { id: 'walk', kind: 'anchor', gutter: '7 am', name: 'Morning walk', time: '7:00 – 7:45' },
    { id: 'morning', kind: 'container', gutter: '9 am', name: 'Morning Focus', time: '9 – 12' },
    { id: 'lunch', kind: 'anchor', gutter: '12 pm', name: 'Lunch', time: '12:00 – 1:00' },
    { id: 'afternoon', kind: 'container', gutter: '2 pm', name: 'Afternoon Focus', time: '2 – 4' },
    { id: 'family', kind: 'anchor', gutter: '6 pm', name: 'Family time', time: '6:30 – 8:30' },
];

type TaskDef = { id: string; title: string; dur: string; block: string };
const TASKS: TaskDef[] = [
    { id: 'q3', title: 'Q3 pitch deck', dur: '1h 30m', block: 'morning' },
    { id: 'acme', title: 'Acme proposal', dur: '30m', block: 'morning' },
    { id: 'team', title: 'Team update', dur: '30m', block: 'afternoon' },
];

// Loose to-dos Starlight sets aside — filed away for later once it picks.
const LATER = [
    { id: 'fonts', title: 'Browse fonts' },
    { id: 'notion', title: 'Tidy Notion' },
];

// Where each floating pill rests in the backlog cluster, in stage coordinates
// (px from the stage's top-left). Jaunty, slightly overlapping — "tossed in".
const CLUSTER: Record<string, Point> = {
    acme: { x: 44, y: 0 },
    fonts: { x: 158, y: 30 },
    q3: { x: 78, y: 40 },
    notion: { x: 150, y: 74 },
    team: { x: 54, y: 82 },
};

// template → backlog (all alike) → thinking → selecting (pick vs. file away)
// → scheduling (picks fly in) → resolved.
type Phase = 'template' | 'backlog' | 'thinking' | 'selecting' | 'scheduling' | 'resolved';
const COPY: Record<Phase, { icon: IoniconName; caption: string }> = {
    template: { icon: 'today-outline', caption: 'Your routine, as a template' },
    backlog: { icon: 'file-tray-outline', caption: 'Tasks looking for space in your day' },
    thinking: { icon: 'scale-outline', caption: 'Weighing what fits' },
    selecting: { icon: 'color-wand-outline', caption: 'Picking what matters' },
    scheduling: { icon: 'extension-puzzle-outline', caption: 'Fitting them around your routine' },
    resolved: { icon: 'checkmark-done', caption: 'Your day, planned' },
};

// Ordered steps the stepper walks through, one tick each.
const PHASE_ORDER: Phase[] = ['template', 'backlog', 'thinking', 'selecting', 'scheduling', 'resolved'];

const TEMPLATE_MS = 1300;
const BACKLOG_MS = 1200;
const THINKING_MS = 750;
const SELECTING_MS = 1500;
const PLACE_STAGGER = 900;
const PLACE_SETTLE = 760;
// A beat after picking lands before the first pill flies, so the pick and the
// allocation read as two separate moments rather than one abrupt jump.
const PLACE_LEAD_IN = 600;
const RESOLVED_MS = 3000;
const THINKING_AT = TEMPLATE_MS + BACKLOG_MS;
const SELECTING_AT = THINKING_AT + THINKING_MS;
const SCHED_START = SELECTING_AT + SELECTING_MS;
const RESOLVED_AT = SCHED_START + PLACE_LEAD_IN + (TASKS.length - 1) * PLACE_STAGGER + PLACE_SETTLE;
const LOOP_MS = RESOLVED_AT + RESOLVED_MS;

function KeptTag() {
    return (
        <View style={styles.keptTag}>
            <Ionicons name="lock-closed" size={11} color="#b5996f" />
        </View>
    );
}

function AnchorCard({ row, kept }: { row: AnchorRow; kept: boolean }) {
    return (
        <View style={styles.anchorCard}>
            <Text style={styles.anchorName}>{row.name}</Text>
            <Text style={styles.anchorTime}>{row.time}</Text>
            <View style={styles.flexSpacer} />
            {kept && <KeptTag />}
        </View>
    );
}

function TaskRowView({ title, dur, animatedStyle }: { title: string; dur: string; animatedStyle?: object }) {
    return (
        <Animated.View style={[styles.taskRow, animatedStyle]}>
            <Text style={styles.taskTitle} numberOfLines={1}>{title}</Text>
            <Text style={styles.taskDur}>{dur}</Text>
        </Animated.View>
    );
}

/**
 * A loose to-do in the backlog. Before Starlight picks, every pill looks the
 * same (a neutral dot). Once `marked`, a picked pill shows a checkmark and
 * later flies to its block when `landed`; a deferred pill (`later`) gets the
 * "not scheduled" tray icon, dims, and settles down — filed away.
 */
function FlyingPill({
    title,
    dur,
    later,
    marked,
    thinking,
    cluster,
    home,
    visible,
    landed,
    index,
    reducedMotion,
}: {
    title: string;
    dur?: string;
    later?: boolean;
    marked: boolean;
    thinking: boolean;
    cluster: Point;
    home: Point | null;
    visible: boolean;
    landed: boolean;
    index: number;
    reducedMotion: boolean;
}) {
    const tx = useSharedValue(cluster.x);
    const ty = useSharedValue(cluster.y);
    const opacity = useSharedValue(0);
    const scale = useSharedValue(0.9);

    const deferred = !!later && marked;

    useEffect(() => {
        const delay = index * 120;
        // Picked pills fly to their row and fade out so the settled row shows through.
        if (landed && home) {
            tx.value = withTiming(home.x, { duration: 560, easing: EASE });
            ty.value = withTiming(home.y, { duration: 560, easing: EASE });
            scale.value = withTiming(1, { duration: 560, easing: EASE });
            opacity.value = withDelay(360, withTiming(0, { duration: 220, easing: EASE }));
            return;
        }
        // Deferred pills stay put (just dimmed); everything else rests at full strength.
        const targetOpacity = !visible ? 0 : deferred ? 0.85 : 1;
        tx.value = withTiming(cluster.x, { duration: 360, easing: EASE });
        ty.value = withTiming(cluster.y, { duration: 400, easing: EASE });
        opacity.value = withDelay(delay, withTiming(targetOpacity, { duration: 380, easing: EASE }));
        // A gentle breath while Starlight weighs each to-do.
        if (thinking) {
            scale.value = withRepeat(
                withSequence(
                    withTiming(1.04, { duration: 620, easing: EASE_INOUT }),
                    withTiming(1, { duration: 620, easing: EASE_INOUT }),
                ),
                -1,
                false,
            );
        } else {
            scale.value = withDelay(delay, withTiming(visible ? 1 : 0.9, { duration: 380, easing: EASE }));
        }
    }, [visible, landed, home, cluster.x, cluster.y, deferred, thinking]);

    const style = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
    }));

    if (reducedMotion) return null;

    // Pills look identical until Starlight picks; then a corner badge marks each
    // one — a warm "pulled into today" arrow, or the "filed for later" tray.
    return (
        <Animated.View style={[styles.flyingPill, styles.noPointer, style]}>
            <View style={[styles.pill, deferred && styles.pillLater]}>
                <Text style={[styles.pillTitle, deferred && styles.pillTitleLater]} numberOfLines={1}>{title}</Text>
                {dur && <Text style={styles.pillDur}>{dur}</Text>}
            </View>
            {marked && (
                <View style={[styles.pillBadge, later ? styles.pillBadgeLater : styles.pillBadgePicked]}>
                    {later ? (
                        <Ionicons name="file-tray-outline" size={11} color="#8a8276" />
                    ) : (
                        <Ionicons name="arrow-forward" size={11} color="#ffffff" />
                    )}
                </View>
            )}
        </Animated.View>
    );
}

/**
 * One tick in the stepper, driven by a shared `prog` (the animated step index).
 * Each tick derives its width and colour from its distance to `prog`, so the
 * accent pill flows continuously from one step into the next — grow/shrink and
 * recolour happen in lockstep across neighbours rather than as separate events.
 */
function Step({ index, prog }: { index: number; prog: SharedValue<number> }) {
    const style = useAnimatedStyle(() => {
        const dist = Math.abs(index - prog.value);
        const width = interpolate(dist, [0, 1], [16, 5], Extrapolation.CLAMP);
        // signed < 0 → already passed (done), 0 → active, > 0 → upcoming.
        const backgroundColor = interpolateColor(
            index - prog.value,
            [-1, 0, 1],
            ['rgba(42,38,33,0.32)', colors.accent.strong, 'rgba(42,38,33,0.14)'],
        );
        return { width, backgroundColor };
    });

    return <Animated.View style={[styles.step, style]} />;
}

/**
 * A soft specular highlight that sweeps once across the whole plan when it
 * resolves — light catching the surface as the day is smoothed into place.
 * Mounted keyed by cycle so it replays each loop.
 */
function ShineSweep({ width, height }: { width: number; height: number }) {
    const BAND = 120;
    const p = useSharedValue(0);

    useEffect(() => {
        // Hold until the deferred pills have finished fading out, so the glint
        // sweeps a settled plan rather than one still clearing itself.
        p.value = withDelay(900, withTiming(1, { duration: 1100, easing: EASE }));
    }, []);

    const style = useAnimatedStyle(() => ({
        transform: [{ translateX: -BAND + p.value * (width + BAND * 2) }, { skewX: '-14deg' }],
    }));

    if (width === 0 || height === 0) return null;

    return (
        <Animated.View style={[styles.shine, styles.noPointer, { width: BAND, height }, style]}>
            <Svg width={BAND} height={height}>
                <Defs>
                    <SvgLinearGradient id="planShine" x1="0" y1="0" x2="1" y2="0">
                        <Stop offset="0" stopColor="#ffffff" stopOpacity={0} />
                        <Stop offset="0.5" stopColor="#ffffff" stopOpacity={0.6} />
                        <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
                    </SvgLinearGradient>
                </Defs>
                <Rect x="0" y="0" width={BAND} height={height} fill="url(#planShine)" />
            </Svg>
        </Animated.View>
    );
}

export function PlanPreview() {
    const reducedMotion = useReducedMotion();

    const [active, setActive] = useState(false);
    const [phase, setPhase] = useState<Phase>('template');
    const [placed, setPlaced] = useState(0);
    const [cycle, setCycle] = useState(0);

    // Task-row landing positions, in stage coordinates.
    const stageRef = useRef<View>(null);
    const slotRefs = useRef<Record<string, View | null>>({});
    const [homes, setHomes] = useState<Record<string, Point>>({});
    const [stageSize, setStageSize] = useState({ w: 0, h: 0 });

    const measure = useCallback(() => {
        const stage = stageRef.current;
        if (!stage) return;
        stage.measureInWindow((sx, sy) => {
            const next: Record<string, Point> = {};
            let pending = TASKS.length;
            if (pending === 0) return;
            TASKS.forEach((t) => {
                const slot = slotRefs.current[t.id];
                if (!slot) { pending -= 1; return; }
                slot.measureInWindow((x, y) => {
                    next[t.id] = { x: x - sx, y: y - sy };
                    pending -= 1;
                    if (pending === 0) setHomes(next);
                });
            });
        });
    }, []);

    useFocusEffect(
        useCallback(() => {
            setActive(true);
            return () => setActive(false);
        }, []),
    );

    useEffect(() => {
        if (reducedMotion || !active) return;
        let cancelled = false;
        const timers: ReturnType<typeof setTimeout>[] = [];
        const at = (ms: number, fn: () => void) => {
            timers.push(setTimeout(() => { if (!cancelled) fn(); }, ms));
        };
        const run = () => {
            setPhase('template');
            setPlaced(0);
            setCycle((c) => c + 1);
            // Re-measure once the entrance has settled, before any pill flies.
            at(1000, measure);
            at(TEMPLATE_MS, () => setPhase('backlog'));
            at(THINKING_AT, () => setPhase('thinking'));
            at(SELECTING_AT, () => setPhase('selecting'));
            at(SCHED_START, () => setPhase('scheduling'));
            TASKS.forEach((_, i) => at(SCHED_START + PLACE_LEAD_IN + i * PLACE_STAGGER, () => setPlaced(i + 1)));
            at(RESOLVED_AT, () => setPhase('resolved'));
            at(LOOP_MS, run);
        };
        run();
        return () => { cancelled = true; timers.forEach(clearTimeout); };
    }, [reducedMotion, active]);

    const settled = reducedMotion || phase === 'resolved';
    const placedCount = settled ? TASKS.length : placed;
    const pillsVisible = !reducedMotion && (phase === 'backlog' || phase === 'thinking' || phase === 'selecting' || phase === 'scheduling');
    // Once Starlight has picked, pills carry their kept/filed icon.
    const marked = reducedMotion || phase === 'selecting' || phase === 'scheduling' || phase === 'resolved';
    const thinking = phase === 'thinking';
    const activePhase = reducedMotion ? 'resolved' : phase;
    const copy = COPY[activePhase];
    const stepIndex = PHASE_ORDER.indexOf(activePhase);

    // One continuous value the whole stepper reads, so the pill flows between
    // steps. Snap back to the start on loop restart instead of rewinding.
    const prog = useSharedValue(0);
    useEffect(() => {
        prog.value = stepIndex <= 0 ? 0 : withTiming(stepIndex, { duration: 420, easing: EASE });
    }, [stepIndex]);

    return (
        <View style={styles.card} accessible accessibilityLabel="A preview of a planned day: your to-dos settling into focus blocks.">
            {/* warm glow behind the backlog, through the pick-and-schedule beats */}
            {pillsVisible && <View style={styles.glow} />}

            <View style={styles.statusBar}>
                <View style={styles.avatar}>
                    <Ionicons name={copy.icon} size={12} color="#fff" />
                </View>
                <Text style={styles.statusText}>{copy.caption}</Text>
                <View style={styles.flexSpacer} />
                <View style={styles.stepper}>
                    {PHASE_ORDER.map((p, i) => (
                        <Step key={p} index={i} prog={prog} />
                    ))}
                </View>
            </View>

            <View
                style={styles.stage}
                ref={stageRef}
                onLayout={(e) => {
                    const { width, height } = e.nativeEvent.layout;
                    setStageSize({ w: width, h: height });
                    measure();
                }}
            >
                <View key={cycle} onLayout={measure}>
                    {TIMELINE.map((row, i) => {
                        const rowTasks = TASKS.filter((t) => t.block === row.id);
                        return (
                            <Animated.View
                                key={row.id}
                                style={styles.timelineRow}
                                entering={reducedMotion ? undefined : FadeInDown.duration(380).delay(i * 70).easing(EASE.factory())}
                            >
                                <Text style={styles.gutter}>{row.gutter}</Text>
                                <View style={styles.flexSpacer}>
                                    {row.kind === 'anchor' ? (
                                        <AnchorCard row={row} kept={placedCount > 0 || settled} />
                                    ) : (
                                        <View style={styles.containerCard}>
                                            <View style={styles.containerHeader}>
                                                <Text style={styles.containerName}>{row.name}</Text>
                                                <Text style={styles.containerTime}>{row.time}</Text>
                                            </View>
                                            {rowTasks.length > 0 && (
                                                <View style={styles.taskList}>
                                                    {rowTasks.map((t) => {
                                                        const landed = settled || TASKS.indexOf(t) < placedCount;
                                                        return (
                                                            <View
                                                                key={t.id}
                                                                ref={(r) => { slotRefs.current[t.id] = r; }}
                                                                style={!landed && styles.hidden}
                                                            >
                                                                <TaskRowView title={t.title} dur={t.dur} />
                                                            </View>
                                                        );
                                                    })}
                                                </View>
                                            )}
                                        </View>
                                    )}
                                </View>
                            </Animated.View>
                        );
                    })}
                </View>

                {/* Flying pills live above the timeline so they can travel across blocks. */}
                <View style={[StyleSheet.absoluteFill, styles.noPointer]}>
                    {TASKS.map((t, i) => (
                        <FlyingPill
                            key={t.id}
                            title={t.title}
                            dur={t.dur}
                            marked={marked}
                            thinking={thinking}
                            cluster={CLUSTER[t.id]}
                            home={homes[t.id] ?? null}
                            visible={pillsVisible}
                            landed={!settled && placed > i}
                            index={i}
                            reducedMotion={reducedMotion}
                        />
                    ))}
                    {LATER.map((t, i) => (
                        <FlyingPill
                            key={t.id}
                            title={t.title}
                            later
                            marked={marked}
                            thinking={thinking}
                            cluster={CLUSTER[t.id]}
                            home={null}
                            visible={pillsVisible}
                            landed={false}
                            index={TASKS.length + i}
                            reducedMotion={reducedMotion}
                        />
                    ))}
                </View>

                {/* A one-off glint across the finished plan. */}
                {phase === 'resolved' && stageSize.w > 0 && (
                    <ShineSweep key={`shine-${cycle}`} width={stageSize.w} height={stageSize.h} />
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#fbf8f3',
        borderRadius: radius.xxl,
        borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.06)',
        paddingHorizontal: spacing.md,
        paddingTop: spacing.md,
        paddingBottom: spacing.sm,
        overflow: 'hidden',
        ...shadow.soft,
    },
    // A soft wash behind the whole backlog pile — wide enough to hold every
    // tossed-in to-do before they're allocated.
    glow: {
        position: 'absolute',
        top: -90,
        left: -60,
        right: -60,
        height: 320,
        borderRadius: 180,
        backgroundColor: 'rgba(224,138,43,0.10)',
        pointerEvents: 'none',
    },
    noPointer: {
        pointerEvents: 'none',
    },
    shine: {
        position: 'absolute',
        top: 0,
        left: 0,
    },
    statusBar: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        paddingHorizontal: 4,
        paddingBottom: 10,
        marginBottom: spacing.sm,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(42,38,33,0.05)',
    },
    statusText: {
        fontSize: 13,
        color: '#5c5248',
        fontWeight: '500',
        letterSpacing: -0.15,
    },
    stepper: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    step: {
        height: 5,
        borderRadius: 3,
    },
    stage: {
        position: 'relative',
    },
    timelineRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 8,
    },
    gutter: {
        width: 40,
        paddingTop: 13,
        paddingRight: 8,
        fontSize: 10,
        color: '#a69e92',
        letterSpacing: -0.1,
    },
    flexSpacer: {
        flex: 1,
    },
    hidden: {
        opacity: 0,
    },

    // Anchor
    anchorCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#efeae1',
        borderRadius: 12,
        paddingHorizontal: 13,
        paddingVertical: 12,
    },
    anchorName: {
        fontSize: 14,
        fontWeight: '600',
        color: '#2a2621',
        letterSpacing: -0.2,
        marginRight: 8,
    },
    anchorTime: {
        fontSize: 12,
        color: '#9a9389',
        letterSpacing: -0.1,
        fontVariant: ['tabular-nums'],
    },
    keptTag: {
        alignItems: 'center',
        justifyContent: 'center',
    },

    // Container
    containerCard: {
        borderWidth: 1.5,
        borderColor: colors.border.container,
        borderStyle: 'dashed',
        borderRadius: 12,
        paddingHorizontal: 13,
        paddingVertical: 12,
    },
    containerHeader: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    containerName: {
        fontSize: 14,
        fontWeight: '600',
        color: '#2a2621',
        letterSpacing: -0.2,
        marginRight: 8,
    },
    containerTime: {
        fontSize: 12,
        color: '#9a9389',
        fontVariant: ['tabular-nums'],
    },
    taskList: {
        gap: 6,
        marginTop: 10,
    },
    taskRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        backgroundColor: '#ffffff',
        borderRadius: 9,
        paddingHorizontal: 11,
        paddingVertical: 9,
        ...shadow.soft,
    },
    taskTitle: {
        flex: 1,
        fontSize: 13,
        color: '#2a2621',
        letterSpacing: -0.15,
    },
    taskDur: {
        fontSize: 12,
        color: '#8a8276',
        fontVariant: ['tabular-nums'],
    },

    // Flying pill
    flyingPill: {
        position: 'absolute',
        top: 0,
        left: 0,
    },
    // Corner badge marking a pill once picked (warm) or filed for later (muted).
    pillBadge: {
        position: 'absolute',
        top: -6,
        left: -6,
        width: 20,
        height: 20,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        ...shadow.soft,
    },
    pillBadgePicked: {
        backgroundColor: colors.accent.strong,
    },
    pillBadgeLater: {
        backgroundColor: '#e6ded1',
    },
    pill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#ffffff',
        borderRadius: 999,
        paddingHorizontal: 13,
        paddingVertical: 8,
        ...shadow.soft,
    },
    pillLater: {
        backgroundColor: 'rgba(245,242,236,0.95)',
    },
    pillTitle: {
        fontSize: 12.5,
        color: '#2a2621',
        letterSpacing: -0.15,
    },
    pillTitleLater: {
        color: '#7a736a',
    },
    pillDur: {
        fontSize: 11.5,
        color: '#8a8276',
        fontVariant: ['tabular-nums'],
    },

    avatar: {
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: '#2a2621',
        alignItems: 'center',
        justifyContent: 'center',
    },
});
