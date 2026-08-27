import { useEffect, useRef, type ReactNode } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
    FadeIn,
    FadeInDown,
    FadeOut,
    LinearTransition,
    useSharedValue,
    useAnimatedStyle,
    withSequence,
    withTiming,
    type EntryOrExitLayoutType,
} from "react-native-reanimated";
import { radius } from "../lib/theme";
import type { TimelineRow } from "../lib/templateDraft";
import { BlockListItem } from "./BlockListItem";
import { GapAffordance } from "./GapAffordance";
import { BoundaryTimeControl } from "./BoundaryTimeControl";
import { TimelineThread } from "./timeline";

const ROW_LAYOUT = LinearTransition.springify().dampingRatio(1);

// The wake/sleep-bounded template timeline, shared by the settings editor and the
// onboarding Build step. `flashFor`'s nonce lets re-touching the same row retrigger its
// confirmation flash; `entering` toggles the staggered first-render reveal.
export function TemplateTimeline({
    rows,
    wakeTime,
    sleepTime,
    blockKeys,
    entering,
    flashFor,
    outOfBoundsIndexes,
    onWakeChange,
    onSleepChange,
    onEditBlock,
    onAddInGap,
}: {
    rows: TimelineRow[];
    wakeTime: string;
    sleepTime: string;
    blockKeys: string[];
    entering: boolean;
    flashFor: { key: string; nonce: number };
    outOfBoundsIndexes: Set<number>;
    onWakeChange: (time: string) => void;
    onSleepChange: (time: string) => void;
    onEditBlock: (index: number) => void;
    onAddInGap: (startTime: string, endTime: string) => void;
}) {
    const children: ReactNode[] = [
        <Animated.View key="wake" entering={entering ? FadeInDown.duration(300) : undefined}>
            <BoundaryTimeControl label="Wake" time={wakeTime} onChange={onWakeChange} />
        </Animated.View>,
    ];

    rows.forEach((row, i) => {
        const delay = (i + 1) * 40;
        const key = row.kind === 'block' ? blockKeys[row.index] : `gap-${row.startTime}`;
        children.push(<TimelineThread key={`thread-${key}`} />);

        if (row.kind === 'block') {
            children.push(
                <BlockRow
                    key={key}
                    signal={flashFor.key === `block-${row.startTime}` ? flashFor.nonce : 0}
                    entering={entering ? FadeInDown.duration(300).delay(delay) : undefined}
                >
                    <BlockListItem
                        block={row.block}
                        onPress={() => onEditBlock(row.index)}
                        invalid={outOfBoundsIndexes.has(row.index)}
                    />
                </BlockRow>
            );
        } else {
            children.push(
                <Animated.View
                    key={key}
                    layout={ROW_LAYOUT}
                    entering={entering ? FadeInDown.duration(300).delay(delay) : FadeIn.duration(160)}
                    exiting={FadeOut.duration(160)}
                >
                    <GapAffordance gap={row.gap} onPress={() => onAddInGap(row.gap.startTime, row.gap.endTime)} />
                </Animated.View>
            );
        }
    });

    children.push(<TimelineThread key="thread-sleep" />);
    children.push(
        <Animated.View key="sleep" entering={entering ? FadeInDown.duration(300).delay((rows.length + 1) * 40) : undefined}>
            <BoundaryTimeControl label="Sleep" time={sleepTime} onChange={onSleepChange} />
        </Animated.View>
    );

    return <View>{children}</View>;
}

// A new positive `signal` flashes an accent overlay to confirm an add or edit landed;
// `layout` reflows neighboring rows when a block is added or removed.
function BlockRow({ signal, entering, children }: { signal: number; entering?: EntryOrExitLayoutType; children: ReactNode }) {
    const opacity = useSharedValue(0);
    const prev = useRef(0);

    useEffect(() => {
        if (signal > 0 && signal !== prev.current) {
            opacity.value = withSequence(withTiming(1, { duration: 140 }), withTiming(0, { duration: 620 }));
        }
        prev.current = signal;
    }, [signal, opacity]);

    const overlayStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

    return (
        <Animated.View layout={ROW_LAYOUT} entering={entering} exiting={FadeOut.duration(200)}>
            {children}
            <Animated.View pointerEvents="none" style={[styles.flashOverlay, overlayStyle]} />
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    flashOverlay: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: radius.lg,
        backgroundColor: 'rgba(212,165,116,0.35)',
    },
});
