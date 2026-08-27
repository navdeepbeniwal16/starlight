import { ActivityIndicator, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

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
    if (!generating && !error) return null;

    const unschedulable = errorCode === NO_CONTAINER_BLOCKS && !!onAdjust;

    return (
        <View style={s.overlay}>
            {generating ? (
                <>
                    <ActivityIndicator color="#d4a574" size="large" />
                    <Text style={s.subtitle}>Starlight is scheduling your tasks into your day.</Text>
                    {onCancel && (
                        <Pressable style={s.cancelButton} onPress={onCancel}>
                            <Text style={s.cancelButtonLabel}>Cancel</Text>
                        </Pressable>
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
                        <Ionicons name="alert-circle-outline" size={24} color="#d4a574" />
                    </View>
                    <Text style={s.title}>Couldn't build your plan</Text>
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
        marginTop: 8,
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 12,
        backgroundColor: '#f5f3ef',
    },
    cancelButtonLabel: {
        fontSize: 14,
        fontWeight: '500',
        color: '#7a736a',
    },
});
