import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import type { DayTemplate } from "../lib/api.types";
import { colors, radius, spacing } from "../lib/theme";
import { formatRelative } from "../lib/time";
import { buildBlankTemplate } from "../lib/starterTemplate";
import { buildDuplicateDraft } from "../lib/duplicateTemplate";
import { useTemplateStore } from "../stores/template.store";
import { PressableScale } from "../components/PressableScale";
import { TemplateCard } from "../components/TemplateCard";

type ScreenState =
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; templates: DayTemplate[] };

export default function DayTemplatesScreen() {
    const router = useRouter();
    const seed = useTemplateStore((s) => s.seed);
    const [state, setState] = useState<ScreenState>({ status: 'loading' });

    const load = useCallback(async () => {
        const result = await api.listDayTemplates();
        setState(result.ok
            ? { status: 'ready', templates: result.data }
            : { status: 'error', message: result.error });
    }, []);

    // Refetch on focus so an edit made in the editor is reflected when we pop back.
    useFocusEffect(useCallback(() => { load(); }, [load]));

    function handleCreate() {
        seed(buildBlankTemplate(), '');
        router.push('/day-template/new');
    }

    function handleDuplicate(template: DayTemplate) {
        const { name, draft } = buildDuplicateDraft(template);
        seed(draft, name);
        router.push('/day-template/new');
    }

    return (
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <View style={styles.backRow}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.7}>
                    <Ionicons name="chevron-back" size={20} color={colors.text.secondary} />
                    <Text style={styles.backLabel}>Settings</Text>
                </TouchableOpacity>
            </View>
            <View style={styles.titleRow}>
                <View style={styles.titleColumn}>
                    <Text style={styles.headerTitle}>Day Templates</Text>
                    <Text style={styles.headerSubtitle}>Tap a template to edit its shape.</Text>
                </View>
                <PressableScale style={styles.newButton} onPress={handleCreate} activeScale={0.92} hitSlop={10}>
                    <Ionicons name="add" size={20} color={colors.accent.default} />
                    <Text style={styles.newButtonText}>New</Text>
                </PressableScale>
            </View>

            {state.status === 'loading' && (
                <View style={styles.centered}>
                    <ActivityIndicator color={colors.accent.default} />
                </View>
            )}

            {state.status === 'error' && (
                <View style={styles.centered}>
                    <Text style={styles.errorText}>{state.message}</Text>
                    <PressableScale style={styles.retryButton} onPress={load}>
                        <Text style={styles.retryButtonText}>Try again</Text>
                    </PressableScale>
                </View>
            )}

            {state.status === 'ready' && (
                <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                    {state.templates.map((template) => (
                        <TemplateCard
                            key={template.id}
                            template={template}
                            onPress={() => router.push(`/day-template/${template.id}`)}
                            recency={`Updated ${formatRelative(template.updatedAt)}`}
                            trailing={
                                <>
                                    <PressableScale style={styles.cardAction} onPress={() => handleDuplicate(template)} activeScale={0.9} hitSlop={8}>
                                        <Ionicons name="copy-outline" size={18} color={colors.text.secondary} />
                                    </PressableScale>
                                    <Ionicons name="create-outline" size={18} color={colors.text.secondary} />
                                </>
                            }
                        />
                    ))}
                </ScrollView>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.surface.page },

    backRow: { paddingHorizontal: 12, paddingTop: 20, paddingBottom: 2 },
    backButton: {
        flexDirection: 'row', alignItems: 'center', gap: 2,
        alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 4,
    },
    backLabel: { fontSize: 15, color: colors.text.secondary },
    titleRow: {
        flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md,
        paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12,
    },
    titleColumn: { flex: 1 },
    headerTitle: { fontSize: 18, fontWeight: '600', color: colors.text.primary, letterSpacing: -0.3 },
    headerSubtitle: { fontSize: 13, color: colors.text.secondary, lineHeight: 18, marginTop: 6, maxWidth: 320 },

    newButton: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4, paddingLeft: 4 },
    newButtonText: { fontSize: 15, fontWeight: '600', color: colors.accent.default, letterSpacing: -0.1 },

    scroll: { flex: 1 },
    content: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg, gap: spacing.md },

    cardAction: { padding: 2 },

    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, gap: spacing.lg },
    errorText: { fontSize: 14, color: colors.text.secondary, textAlign: 'center' },
    retryButton: {
        height: 44, paddingHorizontal: spacing.xxl, backgroundColor: colors.accent.default,
        borderRadius: radius.md, justifyContent: 'center', alignItems: 'center',
    },
    retryButtonText: { fontSize: 15, fontWeight: '500', color: colors.text.onAccent, letterSpacing: -0.2 },
});
