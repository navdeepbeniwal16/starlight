import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Animated, {
    Easing,
    runOnJS,
    useAnimatedProps,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withDelay,
    withSpring,
    withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop } from "react-native-svg";
import { colors, radius, spacing } from "../../lib/theme";
import { STAR } from "../../components/Logo";
import { formatDuration, formatTime } from "../../lib/time";
import { PressableScale } from "../../components/PressableScale";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// These redraw the Starlight logo at screen scale: ARC_PATH is the logo's beam, STAR (from
// Logo) its star. The star's scale and offset are tuned to seat it on the arc's apex so the
// two read as one mark, not chosen freely.
const ARC_PATH = "M8 80C8 80 24 56 50 56C76 56 92 80 92 80";
const STAR_TRANSFORM = "translate(37,29.5) scale(0.26)";
const VIEW_W = 100;
const VIEW_MIN_Y = 28;
const VIEW_H = 54;
const VIEW_BOX = `0 ${VIEW_MIN_Y} ${VIEW_W} ${VIEW_H}`;
// Measured length of ARC_PATH; the stroke draws by animating one full-length dash off it.
const ARC_LEN = 101;
const END_Y = 80;

const ARC_DRAW_MS = 900;
// The star drops as the arc lands (STAR_DELAY mirrors ARC_DRAW), and the text follows once
// the mark is whole.
const STAR_DELAY_MS = 900;
const TEXT_DELAY_MS = 1450;

export default function AllSetScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { width: screenW } = useWindowDimensions();
    const reduceMotion = useReducedMotion();
    const params = useLocalSearchParams<{
        wakeTime: string;
        sleepTime: string;
        taskTimeMins: string;
        tasksPlanned: string;
        eventsMins: string;
    }>();

    const wakeTime = params.wakeTime ?? "";
    const sleepTime = params.sleepTime ?? "";
    const taskTimeMins = Number(params.taskTimeMins) || 0;
    const tasksPlanned = Number(params.tasksPlanned) || 0;
    const eventsMins = Number(params.eventsMins) || 0;

    const taskWord = tasksPlanned === 1 ? "task" : "tasks";
    const stats: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
        { icon: "list-outline", text: `${tasksPlanned} ${taskWord} planned` },
        { icon: "hourglass-outline", text: `${formatDuration(taskTimeMins)} of Task Time scheduled` },
    ];
    if (eventsMins > 0) {
        stats.push({ icon: "calendar-outline", text: `${formatDuration(eventsMins)} of Events scheduled` });
    }

    const arcW = Math.round(screenW * 0.72);
    const arcH = Math.round((arcW * VIEW_H) / VIEW_W);
    // Divide by the viewBox scale so the stroke and dots keep a fixed on-screen weight
    // instead of scaling up with the arc.
    const scale = arcW / VIEW_W;
    const strokeW = 6 / scale;
    const dotR = 4 / scale;

    const progress = useSharedValue(reduceMotion ? 1 : 0);
    const starDrop = useSharedValue(reduceMotion ? 0 : 1); // 0 settled, 1 lifted above the apex
    const textOpacity = useSharedValue(reduceMotion ? 1 : 0);

    const celebrate = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const tick = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const played = useRef(false);
    useEffect(() => {
        if (played.current) return;
        played.current = true;

        if (reduceMotion) {
            // Final frame is already on screen; only the arrival haptic plays.
            celebrate();
            return;
        }

        progress.value = withTiming(
            1,
            { duration: ARC_DRAW_MS, easing: Easing.out(Easing.cubic) },
            (finished) => {
                if (finished) runOnJS(tick)();
            },
        );
        starDrop.value = withDelay(
            STAR_DELAY_MS,
            withSpring(0, { damping: 12, stiffness: 140, mass: 1 }, (finished) => {
                if (finished) runOnJS(celebrate)();
            }),
        );
        textOpacity.value = withDelay(TEXT_DELAY_MS, withTiming(1, { duration: 300 }));
    }, []);

    const arcProps = useAnimatedProps(() => ({ strokeDashoffset: ARC_LEN * (1 - progress.value) }));
    // The far dot belongs to the stroke's end, so it fades in only as the sweep arrives.
    const endDotProps = useAnimatedProps(() => ({
        opacity: Math.max(0, Math.min(1, (progress.value - 0.85) / 0.15)),
    }));
    const starStyle = useAnimatedStyle(() => ({
        opacity: 1 - starDrop.value,
        transform: [{ translateY: -starDrop.value * arcH * 0.3 }],
    }));
    const textStyle = useAnimatedStyle(() => ({ opacity: textOpacity.value }));

    const graphicLabel = `Your day runs from ${formatTime(wakeTime)} to ${formatTime(sleepTime)}.`;

    return (
        <SafeAreaView style={styles.safeArea} edges={["top"]}>
            <View style={styles.content}>
                <View style={styles.group}>
                    <View accessible accessibilityRole="image" accessibilityLabel={graphicLabel}>
                        <View style={{ width: arcW, height: arcH }}>
                            <Svg width={arcW} height={arcH} viewBox={VIEW_BOX}>
                                <AnimatedPath
                                    d={ARC_PATH}
                                    stroke={colors.accent.default}
                                    strokeWidth={strokeW}
                                    strokeLinecap="round"
                                    fill="none"
                                    strokeDasharray={ARC_LEN}
                                    animatedProps={arcProps}
                                />
                                <Circle cx={8} cy={END_Y} r={dotR} fill={colors.accent.default} />
                                <AnimatedCircle cx={92} cy={END_Y} r={dotR} fill={colors.accent.default} animatedProps={endDotProps} />
                            </Svg>
                            <Animated.View style={[StyleSheet.absoluteFill, starStyle]} pointerEvents="none">
                                <Svg width={arcW} height={arcH} viewBox={VIEW_BOX}>
                                    <Defs>
                                        <LinearGradient id="starFill" x1="0" y1="0" x2="0" y2="1">
                                            <Stop offset="0" stopColor="#3a332a" />
                                            <Stop offset="1" stopColor={colors.text.primary} />
                                        </LinearGradient>
                                    </Defs>
                                    <G transform={STAR_TRANSFORM}>
                                        <Path d={STAR} fill="url(#starFill)" />
                                    </G>
                                </Svg>
                            </Animated.View>
                        </View>

                        <View style={[styles.endLabels, { width: arcW }]}>
                            <View style={styles.endLabel}>
                                <Ionicons name="sunny-outline" size={14} color={colors.accent.strong} />
                                <Text style={styles.endLabelText}>{formatTime(wakeTime)}</Text>
                            </View>
                            <View style={styles.endLabel}>
                                <Ionicons name="moon-outline" size={13} color={colors.accent.strong} />
                                <Text style={styles.endLabelText}>{formatTime(sleepTime)}</Text>
                            </View>
                        </View>
                    </View>

                    <Animated.View style={[styles.textBlock, textStyle]}>
                        <Text style={styles.headline}>You're all set.</Text>
                        <View style={styles.stats}>
                            {stats.map((stat) => (
                                <View key={stat.text} style={styles.statRow}>
                                    <Ionicons name={stat.icon} size={16} color={colors.accent.strong} />
                                    <Text style={styles.statText}>{stat.text}</Text>
                                </View>
                            ))}
                        </View>
                    </Animated.View>
                </View>
            </View>

            <Animated.View style={[styles.footer, { paddingBottom: insets.bottom + 12 }, textStyle]}>
                <PressableScale
                    style={styles.button}
                    onPress={() => router.replace("/(main)")}
                    accessibilityLabel="Start my day"
                >
                    <Text style={styles.buttonText}>Start my day</Text>
                    <Ionicons name="arrow-forward" size={18} color={colors.surface.page} />
                </PressableScale>
            </Animated.View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: colors.surface.page,
    },
    content: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 24,
    },
    group: {
        alignItems: "center",
    },
    endLabels: {
        flexDirection: "row",
        justifyContent: "space-between",
        marginTop: spacing.sm,
    },
    endLabel: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
    },
    endLabelText: {
        fontSize: 13,
        color: colors.text.secondary,
        letterSpacing: -0.1,
    },
    textBlock: {
        marginTop: spacing.xxl,
        alignItems: "center",
    },
    headline: {
        fontSize: 26,
        fontWeight: "600",
        color: colors.text.primary,
        letterSpacing: -0.3,
        textAlign: "center",
    },
    stats: {
        marginTop: spacing.md,
        gap: spacing.sm,
        alignItems: "center",
    },
    statRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
    },
    statText: {
        fontSize: 15,
        color: colors.text.secondary,
        letterSpacing: -0.1,
    },
    footer: {
        paddingHorizontal: spacing.xl,
        paddingTop: spacing.lg,
    },
    button: {
        height: 52,
        flexDirection: "row",
        gap: spacing.sm,
        backgroundColor: colors.text.primary,
        borderRadius: radius.md,
        justifyContent: "center",
        alignItems: "center",
    },
    buttonText: {
        fontSize: 15,
        fontWeight: "600",
        color: colors.surface.page,
        letterSpacing: -0.1,
    },
});
