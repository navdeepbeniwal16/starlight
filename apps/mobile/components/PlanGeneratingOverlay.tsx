import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { PlanSlottingLoader } from "./PlanSlottingLoader";
import { GENERATION_TIMEOUT } from "../lib/api";

// Delayed so a fast generation never offers Cancel at all.
const CANCEL_REVEAL_MS = 3000;

const SLOW_COPY_MS = 8000;

// Server signals that today's whole day window has already elapsed, so no amount
// of retrying will help — the fix is to widen the template, not regenerate.
export const NO_CONTAINER_BLOCKS = 'NO_CONTAINER_BLOCKS';

// Full-screen cover for the agent-generation step: a spinner while the plan is
// building, or a retryable error. Shared by the planning-review screen and the
// onboarding first-task step. Renders nothing when idle. The Cancel affordance
// only appears when a caller opts in with `onCancel`. When the day window has
// elapsed and a caller provides `onAdjust`, the error offers to edit the day
// instead of a futile retry.
export function PlanGeneratingOverlay({
    generating,
    error,
    errorCode,
    onRetry,
    onDismiss,
    onCancel,
    onAdjust,
}: {
    generating: boolean;
    error: string | null;
    errorCode?: string | null;
    onRetry: () => void;
    onDismiss: () => void;
    onCancel?: () => void;
    onAdjust?: () => void;
}) {
    const insets = useSafeAreaInsets();
    const [revealCancel, setRevealCancel] = useState(false);
    const [slow, setSlow] = useState(false);

    // Reset when generation ends, or a later run would start with Cancel and the
    // slow copy already showing.
    useEffect(() => {
        if (!generating) { setRevealCancel(false); setSlow(false); return; }
        const cancelT = setTimeout(() => setRevealCancel(true), CANCEL_REVEAL_MS);
        const slowT = setTimeout(() => setSlow(true), SLOW_COPY_MS);
        return () => { clearTimeout(cancelT); clearTimeout(slowT); };
    }, [generating]);

    if (!generating && !error) return null;

    const unschedulable = errorCode === NO_CONTAINER_BLOCKS && !!onAdjust;
    const timedOut = errorCode === GENERATION_TIMEOUT;

    return (
        <View style={s.overlay}>
            {generating ? (
                <>
                    <PlanSlottingLoader />
                    <Text style={[s.subtitle, s.loaderCaption]}>
                        {slow ? 'Still working on it…' : 'Starlight is scheduling your tasks into your day.'}
                    </Text>
                    {onCancel && revealCancel && (
                        <Animated.View entering={FadeIn.duration(220)} style={[s.cancelButton, { bottom: insets.bottom + 12 }]}>
                            <Pressable onPress={onCancel} hitSlop={{ top: 10, bottom: 10, left: 16, right: 16 }}>
                                <Text style={s.cancelButtonLabel}>Cancel</Text>
                            </Pressable>
                        </Animated.View>
                    )}
                </>
            ) : unschedulable ? (
                <>
                    <View style={s.errorIcon}>
                        <Ionicons name="time-outline" size={24} color="#d4a574" />
                    </View>
                    <Text style={s.title}>No time left in your day</Text>
                    <Text style={s.subtitle}>{error}</Text>
                    <Pressable style={s.retryButton} onPress={onAdjust}>
                        <Text style={s.retryButtonLabel}>Adjust my day</Text>
                    </Pressable>
                    <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <Text style={s.retryDismiss}>Back to tasks</Text>
                    </TouchableOpacity>
                </>
            ) : (
                <>
                    <View style={s.errorIcon}>
                        <Ionicons name={timedOut ? 'hourglass-outline' : 'alert-circle-outline'} size={24} color="#d4a574" />
                    </View>
                    <Text style={s.title}>{timedOut ? 'That took too long' : "Couldn't build your plan"}</Text>
                    <Text style={s.subtitle}>{error}</Text>
                    <Pressable style={s.retryButton} onPress={onRetry}>
                        <Text style={s.retryButtonLabel}>Try again</Text>
                    </Pressable>
                    <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <Text style={s.retryDismiss}>Back to tasks</Text>
                    </TouchableOpacity>
                </>
            )}
        </View>
    );
}

const s = StyleSheet.create({
    overlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#fdfcfa',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 40,
        gap: 12,
    },
    errorIcon: {
        width: 48,
        height: 48,
        borderRadius: 24,
        backgroundColor: 'rgba(212,165,116,0.12)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    title: {
        fontSize: 17,
        fontWeight: '600',
        color: '#2a2621',
        letterSpacing: -0.3,
        marginTop: 4,
    },
    subtitle: {
        fontSize: 13,
        color: '#7a736a',
        textAlign: 'center',
        lineHeight: 18,
        maxWidth: 260,
    },
    loaderCaption: {
        marginTop: 8,
    },
    retryButton: {
        backgroundColor: '#2a2621',
        borderRadius: 14,
        paddingVertical: 14,
        paddingHorizontal: 32,
        alignItems: 'center',
        marginTop: 12,
    },
    retryButtonLabel: {
        fontSize: 15,
        fontWeight: '600',
        color: '#fdfcfa',
        letterSpacing: -0.2,
    },
    retryDismiss: {
        fontSize: 14,
        color: '#7a736a',
        marginTop: 4,
    },
    cancelButton: {
        position: 'absolute',
        left: 0,
        right: 0,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelButtonLabel: {
        fontSize: 15,
        fontWeight: '500',
        color: '#7a736a',
        letterSpacing: -0.1,
    },
});
