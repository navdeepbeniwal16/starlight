import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
    Easing,
    interpolate,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withDelay,
    withRepeat,
    withSequence,
    withTiming,
} from "react-native-reanimated";
import { colors, shadow } from "../lib/theme";

const EASE = Easing.bezier(0.2, 0, 0, 1);

const ROWS = 3;
const TITLE_WIDTHS = [0.56, 0.4, 0.48];

const SETTLE = 420;
const STAGGER = 260;
const SETTLED_HOLD = 680;
const FADE_OUT = 320;
const REST_GAP = 440;
const RISE = 7;

const LAST_LAND = (ROWS - 1) * STAGGER + SETTLE;
const FADE_START = LAST_LAND + SETTLED_HOLD;

const NODE_COL = 20;
const DOT = 8;
const CARD_H = 34;
const ROW_GAP = 14;
const RAIL_SPAN = (ROWS - 1) * (CARD_H + ROW_GAP);

/**
 * Loader for the plan-generation wait. It avoids any fill-in-a-track shape on
 * purpose — that reads as progress, and this wait has none to report. Nodes stay
 * lit throughout and only whole cards come and go, so nothing ever looks "almost
 * done".
 */
export function PlanSlottingLoader() {
    return (
        <View style={styles.stage} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={[styles.rail, { top: CARD_H / 2, height: RAIL_SPAN }]} />
            {TITLE_WIDTHS.map((w, i) => (
                <SlotRow key={i} index={i} titleWidth={w} last={i === ROWS - 1} />
            ))}
        </View>
    );
}

function SlotRow({ index, titleWidth, last }: { index: number; titleWidth: number; last: boolean }) {
    const reducedMotion = useReducedMotion();

    const opacity = useSharedValue(reducedMotion ? 1 : 0);
    const ty = useSharedValue(reducedMotion ? 0 : -RISE);

    useEffect(() => {
        if (reducedMotion) return;

        const appearStart = index * STAGGER;
        // All cards fade at the shared FADE_START, whatever their appearStart, so the set clears together.
        const hold = FADE_START - (appearStart + SETTLE);

        opacity.value = withRepeat(
            withSequence(
                withDelay(appearStart, withTiming(1, { duration: SETTLE, easing: EASE })),
                withDelay(hold, withTiming(0, { duration: FADE_OUT, easing: EASE })),
                // Hold at 0 through the blank beat so all rows stay on one clock.
                withTiming(0, { duration: REST_GAP }),
            ),
            -1,
        );
        ty.value = withRepeat(
            withSequence(
                withDelay(appearStart, withTiming(0, { duration: SETTLE, easing: EASE })),
                withTiming(0, { duration: hold + FADE_OUT }),
                // Snap back above the slot while invisible, ready for the next loop.
                withTiming(-RISE, { duration: REST_GAP }),
            ),
            -1,
        );
    }, [reducedMotion, index]);

    const cardStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [{ translateY: ty.value }, { scale: interpolate(opacity.value, [0, 1], [0.97, 1]) }],
    }));

    return (
        <View style={[styles.row, { height: CARD_H }, !last && { marginBottom: ROW_GAP }]}>
            <View style={styles.node}>
                <View style={styles.dot} />
            </View>
            <Animated.View style={[styles.card, cardStyle]}>
                <View style={styles.bullet} />
                <View style={[styles.title, { width: `${titleWidth * 100}%` }]} />
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    stage: {
        width: 196,
        position: 'relative',
    },
    rail: {
        position: 'absolute',
        left: NODE_COL / 2 - 1,
        width: 2,
        borderRadius: 1,
        backgroundColor: colors.border.hairline,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    node: {
        width: NODE_COL,
        alignItems: 'center',
    },
    // Left unanimated on purpose — lighting the nodes in sequence would read as a progress stepper.
    dot: {
        width: DOT,
        height: DOT,
        borderRadius: DOT / 2,
        backgroundColor: 'rgba(212,165,116,0.55)',
    },
    card: {
        flex: 1,
        height: CARD_H,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 11,
        borderRadius: 10,
        backgroundColor: colors.surface.raised,
        borderWidth: 1,
        borderColor: colors.border.hairline,
        ...shadow.soft,
    },
    bullet: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: colors.accent.default,
    },
    title: {
        height: 6,
        borderRadius: 3,
        backgroundColor: 'rgba(42,38,33,0.14)',
    },
});
