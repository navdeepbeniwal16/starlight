import { useCallback, useEffect, useState } from "react";
import {
    View,
    Text,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    ScrollView,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../lib/api";
import { colors, radius, spacing, shadow, typography } from "../../lib/theme";
import { canPlanFirstTask, canPlanTasks, type FirstTaskDraft } from "../../lib/firstTaskDraft";
import { usePlanGeneration } from "../../lib/usePlanGeneration";
import { ESTIMATE_OPTIONS, getEstimateLabel } from "../../components/TaskFields";
import { StepEyebrow } from "../../components/StepEyebrow";
import { PressableScale } from "../../components/PressableScale";
import { PlanGeneratingOverlay } from "../../components/PlanGeneratingOverlay";
import { useOnboardingTasksStore, type OnboardingTask } from "../../stores/onboardingTasks.store";

const SUGGESTIONS: (FirstTaskDraft & { id: string })[] = [
    { id: 'emails', title: 'Reply to important emails', estimatedMins: 30 },
    { id: 'presentation', title: 'Prepare for the presentation', estimatedMins: 45 },
    { id: 'weekly-update', title: 'Write the weekly update', estimatedMins: 30 },
];

const EMPTY_DRAFT: FirstTaskDraft = { title: '', estimatedMins: null };

export default function FirstTaskScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();

    const pool = useOnboardingTasksStore(s => s.pool);
    const hydratePool = useOnboardingTasksStore(s => s.hydrate);
    const addTask = useOnboardingTasksStore(s => s.addTask);
    const removeTask = useOnboardingTasksStore(s => s.removeTask);
    const markCreated = useOnboardingTasksStore(s => s.markCreated);

    const [draft, setDraft] = useState<FirstTaskDraft>(EMPTY_DRAFT);
    const [usedSuggestions, setUsedSuggestions] = useState<string[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);

    const { generating, generateError, generateErrorCode, generate, dismissError } = usePlanGeneration();

    // Seed the pool from the backlog so it reflects tasks a prior "Plan my day"
    // already persisted (the review schedules the backlog, not this local pool).
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const res = await api.getBacklog();
            if (cancelled || !res.ok) return;
            hydratePool([...res.data.carriedOver, ...res.data.remaining].map(t => ({
                title: t.title, estimatedMins: t.estimatedMins, serverId: t.id,
            })));
        })();
        return () => { cancelled = true; };
    }, [hydratePool]);

    const draftReady = canPlanFirstTask(draft);
    const canPlan = canPlanTasks(pool);
    const visibleSuggestions = SUGGESTIONS.filter(
        s => !usedSuggestions.includes(s.id) && !pool.some(t => t.title === s.title),
    );

    const setDraftTitle = useCallback((title: string) => {
        setDraft(d => ({ ...d, title }));
        setCreateError(null);
    }, []);

    const setDraftEstimate = useCallback((estimatedMins: number) => {
        setDraft(d => ({ ...d, estimatedMins }));
    }, []);

    const applySuggestion = useCallback((s: (typeof SUGGESTIONS)[number]) => {
        setDraft({ title: s.title, estimatedMins: s.estimatedMins });
        setUsedSuggestions(prev => [...prev, s.id]);
        setCreateError(null);
    }, []);

    const addToPool = useCallback(() => {
        if (!draftReady) return;
        addTask({ title: draft.title, estimatedMins: draft.estimatedMins! });
        setDraft(EMPTY_DRAFT);
    }, [draftReady, draft, addTask]);

    // A persisted task must also leave the backlog, or generation would keep
    // scheduling it after it's been removed from the pool. Blocked while submitting
    // so a removal can't race the create loop, which works from a pool snapshot.
    const handleRemove = useCallback(async (task: OnboardingTask) => {
        if (submitting) return;
        if (task.serverId) {
            const res = await api.deleteTask(task.serverId);
            if (!res.ok) { setCreateError(res.error); return; }
        }
        removeTask(task.id);
    }, [submitting, removeTask]);

    // Doubles as the "Adjust my day" recovery when generation fails: stepping back
    // to build lets the user reshape the template that left no room to schedule.
    const handleBack = useCallback(() => {
        router.back();
    }, [router]);

    const goToPayoff = useCallback(() => router.push('/(onboarding)/review'), [router]);
    // Retry re-runs generation only — the tasks are already created by this point.
    const retryGenerate = useCallback(() => generate(goToPayoff), [generate, goToPayoff]);

    const handlePlanMyDay = useCallback(async () => {
        if (!canPlan || submitting || generating) return;
        setSubmitting(true);
        setCreateError(null);

        // Skip tasks already persisted on an earlier attempt so a re-plan after
        // adjusting the day doesn't duplicate them in the backlog.
        for (const task of pool) {
            if (task.serverId) continue;
            const created = await api.createTask({ title: task.title.trim(), estimatedMins: task.estimatedMins });
            if (!created.ok) {
                setSubmitting(false);
                setCreateError(created.error);
                return;
            }
            markCreated(task.id, created.data.id);
        }

        setSubmitting(false);
        generate(goToPayoff);
    }, [canPlan, submitting, generating, pool, markCreated, generate, goToPayoff]);

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <KeyboardAvoidingView
                style={styles.flex}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <View style={styles.header}>
                    <StepEyebrow step={2} total={3} />
                    <Text style={styles.title}>Add a few tasks</Text>
                    <Text style={styles.subtitle}>
                        Jot down what's on your mind, and Starlight will fit them into your day.
                    </Text>
                </View>

                <ScrollView
                    style={styles.scroll}
                    contentContainerStyle={styles.content}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.composer}>
                        <TextInput
                            style={styles.titleInput}
                            value={draft.title}
                            onChangeText={setDraftTitle}
                            placeholder="What needs to be done?"
                            placeholderTextColor="rgba(122,115,106,0.3)"
                            autoFocus
                            returnKeyType="done"
                        />

                        <View style={styles.estimateGroup}>
                            <Text style={styles.estimateHint}>
                                How long will it take?<Text style={styles.estimateRequired}> *</Text>
                            </Text>
                            <View style={styles.estimatePills}>
                                {ESTIMATE_OPTIONS.map((option) => {
                                    const selected = draft.estimatedMins === option.value;
                                    return (
                                        <TouchableOpacity
                                            key={option.value}
                                            style={[styles.estimatePill, selected && styles.estimatePillOn]}
                                            onPress={() => setDraftEstimate(option.value)}
                                            activeOpacity={0.7}
                                        >
                                            <Text style={[styles.estimatePillText, selected && styles.estimatePillTextOn]}>{option.label}</Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        </View>
                    </View>

                    <TouchableOpacity
                        style={[styles.addButton, !draftReady && styles.addButtonDisabled]}
                        onPress={addToPool}
                        disabled={!draftReady}
                        activeOpacity={0.7}
                    >
                        <Ionicons name="add" size={17} color={colors.text.secondary} />
                        <Text style={styles.addButtonText}>Add</Text>
                    </TouchableOpacity>

                    {pool.length > 0 && (
                        <View style={styles.poolList}>
                            {pool.map((task) => (
                                <View key={task.id} style={styles.poolCard}>
                                    <Text style={styles.poolTitle} numberOfLines={1}>{task.title.trim()}</Text>
                                    <View style={styles.poolRight}>
                                        <Text style={styles.poolEstimate}>{getEstimateLabel(task.estimatedMins)}</Text>
                                        <TouchableOpacity
                                            onPress={() => handleRemove(task)}
                                            disabled={submitting}
                                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                        >
                                            <Ionicons name="close" size={16} color={colors.text.muted} />
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            ))}
                        </View>
                    )}

                    {visibleSuggestions.length > 0 && (
                        <View style={styles.suggestionBlock}>
                            <Text style={styles.suggestionLabel}>Need a nudge? Tap to add</Text>
                            <View style={styles.suggestionChips}>
                                {visibleSuggestions.map((s) => (
                                    <TouchableOpacity
                                        key={s.id}
                                        style={styles.suggestionChip}
                                        onPress={() => applySuggestion(s)}
                                        activeOpacity={0.7}
                                    >
                                        <Text style={styles.suggestionChipText}>{s.title}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </View>
                    )}
                </ScrollView>

                <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
                    {createError && <Text style={styles.errorText}>{createError}</Text>}
                    <PressableScale
                        style={[styles.planButton, !canPlan && styles.planButtonDisabled]}
                        onPress={handlePlanMyDay}
                        disabled={!canPlan || submitting}
                    >
                        {submitting
                            ? <ActivityIndicator color={colors.surface.page} />
                            : <Text style={styles.planButtonText}>Plan my day</Text>}
                    </PressableScale>
                    <TouchableOpacity
                        style={styles.backButton}
                        onPress={handleBack}
                        disabled={submitting || generating}
                        activeOpacity={0.8}
                    >
                        <Text style={styles.backLabel}>Back</Text>
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>

            <PlanGeneratingOverlay
                generating={generating}
                error={generateError}
                errorCode={generateErrorCode}
                onRetry={retryGenerate}
                onDismiss={dismissError}
                onAdjust={handleBack}
            />
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.surface.page },
    flex: { flex: 1 },

    header: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.md },
    title: { ...typography.title, color: colors.text.primary, letterSpacing: 0.07, marginTop: 4 },
    subtitle: { fontSize: 15, color: colors.text.secondary, lineHeight: 22, letterSpacing: -0.2, marginTop: spacing.sm },

    scroll: { flex: 1 },
    content: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.xxl, gap: spacing.lg },

    composer: {
        backgroundColor: colors.surface.raised,
        borderWidth: 1, borderColor: colors.border.hairline,
        borderRadius: radius.lg,
        paddingHorizontal: 16, paddingVertical: 14,
        gap: spacing.md,
    },
    titleInput: {
        fontSize: 18, fontWeight: '500', color: colors.text.primary,
        letterSpacing: -0.3, padding: 0,
    },
    estimateGroup: { gap: 8 },
    estimateHint: { fontSize: 12.5, color: colors.text.muted, letterSpacing: -0.1 },
    estimateRequired: { color: colors.accent.default, fontWeight: '600' },
    estimatePills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    estimatePill: {
        backgroundColor: 'rgba(42,38,33,0.05)',
        borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5,
    },
    estimatePillOn: { backgroundColor: colors.text.primary },
    estimatePillText: { fontSize: 13, color: colors.text.primary, letterSpacing: -0.1 },
    estimatePillTextOn: { color: colors.surface.page },

    addButton: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        alignSelf: 'flex-start', paddingVertical: 4,
    },
    addButtonDisabled: { opacity: 0.35 },
    addButtonText: { fontSize: 14, fontWeight: '500', color: colors.text.secondary, letterSpacing: -0.2 },

    poolList: { gap: spacing.sm },
    poolCard: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        backgroundColor: colors.surface.raised,
        borderWidth: 1, borderColor: colors.border.hairline,
        borderRadius: radius.md,
        paddingLeft: 14, paddingRight: 12, paddingVertical: 11,
    },
    poolTitle: { flex: 1, fontSize: 15, color: colors.text.primary, letterSpacing: -0.2, marginRight: spacing.sm },
    poolRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    poolEstimate: { fontSize: 12, color: colors.text.muted },

    suggestionBlock: { gap: spacing.sm },
    suggestionLabel: { fontSize: 13, color: colors.text.muted, letterSpacing: -0.1 },
    suggestionChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    suggestionChip: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: 'rgba(42,38,33,0.06)',
        borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9,
    },
    suggestionChipText: { fontSize: 14, color: colors.text.primary, letterSpacing: -0.1 },

    footer: {
        paddingHorizontal: spacing.xl, paddingTop: spacing.lg,
        gap: spacing.xs,
        backgroundColor: colors.surface.page,
        ...shadow.footer,
    },
    errorText: { fontSize: 13, color: colors.danger.default, textAlign: 'center' },
    planButton: { height: 52, backgroundColor: colors.text.primary, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center' },
    planButtonDisabled: { opacity: 0.4 },
    planButtonText: { fontSize: 15, fontWeight: '600', color: colors.surface.page, letterSpacing: -0.1 },
    backButton: { height: 44, justifyContent: 'center', alignItems: 'center' },
    backLabel: { fontSize: 15, fontWeight: '500', color: colors.text.secondary, letterSpacing: -0.1 },
});
