import { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { takeGeneratedPlan } from "../../../lib/planningSession";
import type { GeneratePlanResult } from "../../../lib/api.types";

// T-06 placeholder for the Review Plan screen. The real timeline-style review
// with drag-to-reschedule and confirm is built in T-07. For now this renders the
// agent's proposed schedule and the unschedulable list handed over from the
// Review Tasks screen, so the generation flow is end-to-end verifiable.
export default function ReviewPlanScreen() {
    const router = useRouter();
    const [result] = useState<GeneratePlanResult | null>(() => takeGeneratedPlan());

    const containers = result?.plan.blocks.filter(b => b.type === "CONTAINER") ?? [];

    return (
        <SafeAreaView style={s.container} edges={["top"]}>
            <View style={s.header}>
                <Text style={s.headerTitle}>Review plan</Text>
                <TouchableOpacity
                    onPress={() => router.dismissAll()}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    activeOpacity={0.6}
                >
                    <Ionicons name="close" size={22} color="#2a2621" />
                </TouchableOpacity>
            </View>

            {!result ? (
                <View style={s.centered}>
                    <Text style={s.muted}>No generated plan to show. Start a planning session again.</Text>
                </View>
            ) : (
                <ScrollView contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
                    {containers.map(block => (
                        <View key={block.id} style={s.block}>
                            <View style={s.blockHeader}>
                                <Text style={s.blockName}>{block.name}</Text>
                                <Text style={s.blockTime}>{block.startTime}–{block.endTime}</Text>
                            </View>
                            {block.tasks.length === 0 ? (
                                <Text style={s.muted}>No tasks scheduled.</Text>
                            ) : (
                                block.tasks.map(task => (
                                    <View key={task.id} style={s.taskRow}>
                                        <Text style={s.taskTitle} numberOfLines={1}>{task.title}</Text>
                                        <Text style={s.taskMins}>{task.estimatedMins}m</Text>
                                    </View>
                                ))
                            )}
                        </View>
                    ))}

                    {result.unschedulable.length > 0 && (
                        <View style={s.block}>
                            <Text style={s.sectionLabel}>COULDN'T SCHEDULE</Text>
                            {result.unschedulable.map(u => (
                                <Text key={u.taskId} style={s.muted}>• {u.reason}</Text>
                            ))}
                        </View>
                    )}
                </ScrollView>
            )}
        </SafeAreaView>
    );
}

const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#fdfcfa" },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 20,
        paddingTop: 24,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: "rgba(42,38,33,0.06)",
    },
    headerTitle: { fontSize: 16, fontWeight: "600", color: "#2a2621", letterSpacing: -0.3 },
    centered: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
    scrollContent: { padding: 16, gap: 16 },
    block: {
        backgroundColor: "#fffef9",
        borderWidth: 1,
        borderColor: "rgba(42,38,33,0.10)",
        borderRadius: 16,
        padding: 16,
        gap: 8,
    },
    blockHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    blockName: { fontSize: 15, fontWeight: "600", color: "#2a2621", letterSpacing: -0.23 },
    blockTime: { fontSize: 12, color: "#7a736a", fontVariant: ["tabular-nums"] },
    taskRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
    taskTitle: { flex: 1, fontSize: 14, color: "#2a2621" },
    taskMins: { fontSize: 12, color: "#7a736a", fontVariant: ["tabular-nums"] },
    sectionLabel: {
        fontSize: 11,
        color: "rgba(122,115,106,0.5)",
        letterSpacing: 0.5,
        textTransform: "uppercase",
    },
    muted: { fontSize: 13, color: "#7a736a", lineHeight: 18 },
});
