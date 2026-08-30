import { useCallback, useEffect, useRef, useState } from "react";
import { Text, StyleSheet } from "react-native";
import Animated, { FadeInUp, FadeOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, shadow, spacing } from "../lib/theme";
import type { TemplateDraft } from "../lib/templateDraft";
import { useTemplateStore } from "../stores/template.store";
import { PressableScale } from "./PressableScale";

const UNDO_WINDOW_MS = 5000;

// One-level undo for the grid's drag path: each new edit replaces the last snapshot, so only the
// most recent trim/move can be reverted.
export function useUndoableEdit() {
    const setDraft = useTemplateStore((s) => s.setDraft);
    const [offer, setOffer] = useState<{ snapshot: TemplateDraft; label: string } | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clear = useCallback(() => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
    }, []);

    const offerUndo = useCallback((snapshot: TemplateDraft, label: string) => {
        setOffer({ snapshot, label });
        clear();
        timer.current = setTimeout(() => setOffer(null), UNDO_WINDOW_MS);
    }, [clear]);

    const undo = useCallback(() => {
        setOffer((current) => {
            if (current) setDraft(current.snapshot);
            return null;
        });
        clear();
    }, [setDraft, clear]);

    useEffect(() => clear, [clear]);

    return { undoLabel: offer?.label ?? null, offerUndo, undo };
}

// `bottom` lets a screen with an action footer lift the bar clear of it, so Undo never sits over
// the Cancel/Save buttons where a late tap (after the window closes) could hit the wrong one.
export function UndoSnackbar({ label, onUndo, bottom }: { label: string; onUndo: () => void; bottom?: number }) {
    const insets = useSafeAreaInsets();
    return (
        <Animated.View
            style={[styles.bar, { bottom: bottom ?? insets.bottom + 20 }]}
            entering={FadeInUp.duration(180)}
            exiting={FadeOutDown.duration(160)}
        >
            <Text style={styles.label}>{label}</Text>
            <PressableScale onPress={onUndo} style={styles.action} hitSlop={8}>
                <Text style={styles.actionText}>Undo</Text>
            </PressableScale>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    bar: {
        position: 'absolute',
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingLeft: spacing.lg,
        paddingRight: spacing.sm,
        paddingVertical: spacing.sm,
        borderRadius: radius.pill,
        backgroundColor: colors.text.primary,
        ...shadow.soft,
    },
    label: { fontSize: 13, color: colors.surface.page, letterSpacing: -0.1 },
    action: { paddingHorizontal: spacing.md, paddingVertical: 4 },
    actionText: { fontSize: 13, fontWeight: '600', color: colors.accent.default, letterSpacing: -0.1 },
});
