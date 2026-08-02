import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import type { DayTemplate } from "../lib/api.types";
import { toMins, formatTime } from "../lib/time";
import { BlockListItem } from "../components/BlockListItem";

export default function DayTemplateScreen() {
    const router = useRouter();

    const [template, setTemplate] = useState<DayTemplate | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        const result = await api.getDayTemplate();
        if (result.ok) {
            setTemplate(result.data);
        } else {
            setError(result.error);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    // Sort blocks by start time for display; the server order is not guaranteed.
    const sortedBlocks = template
        ? [...template.blocks].sort((a, b) => toMins(a.startTime) - toMins(b.startTime))
        : [];

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.backRow}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()} activeOpacity={0.7}>
                    <Ionicons name="chevron-back" size={20} color="#7a736a" />
                    <Text style={styles.backLabel}>Settings</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.header}>
                <Text style={styles.headerTitle}>Day Template</Text>
            </View>

            {loading && (
                <View style={styles.centered}>
                    <ActivityIndicator color="#d4a574" />
                </View>
            )}

            {!loading && error && (
                <View style={styles.centered}>
                    <Text style={styles.errorText}>{error}</Text>
                    <TouchableOpacity style={styles.retryButton} onPress={load} activeOpacity={0.8}>
                        <Text style={styles.retryButtonText}>Try again</Text>
                    </TouchableOpacity>
                </View>
            )}

            {!loading && !error && template && (
                <ScrollView
                    style={styles.scroll}
                    contentContainerStyle={styles.content}
                    showsVerticalScrollIndicator={false}
                >
                    <View style={styles.wakeSleepRow}>
                        <Ionicons name="time-outline" size={16} color="#7a736a" />
                        <Text style={styles.wakeSleepText}>
                            Awake {formatTime(template.wakeTime)} – {formatTime(template.sleepTime)}
                        </Text>
                    </View>

                    {sortedBlocks.map(block => (
                        <BlockListItem key={block.id} block={block} />
                    ))}
                </ScrollView>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: '#fdfcfa' },

    backRow: { paddingHorizontal: 12, paddingTop: 20, paddingBottom: 2 },
    backButton: {
        flexDirection: 'row', alignItems: 'center', gap: 2,
        alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 4,
    },
    backLabel: { fontSize: 15, color: '#7a736a' },

    header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
    headerTitle: { fontSize: 24, fontWeight: '500', color: '#2a2621', letterSpacing: 0.07 },

    scroll: { flex: 1 },
    content: { paddingHorizontal: 16, paddingBottom: 40, gap: 12 },

    wakeSleepRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingBottom: 4 },
    wakeSleepText: { fontSize: 14, color: '#7a736a', letterSpacing: -0.15 },

    centered: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, gap: 16 },
    errorText: { fontSize: 14, color: '#7a736a', textAlign: 'center' },
    retryButton: {
        height: 44, paddingHorizontal: 24, backgroundColor: '#d4a574',
        borderRadius: 14, justifyContent: 'center', alignItems: 'center',
    },
    retryButtonText: { fontSize: 15, fontWeight: '500', color: '#2a2621', letterSpacing: -0.2 },
});
