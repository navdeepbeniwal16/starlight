import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useOnboardingStore } from "../../stores/onboarding.store";
import { api } from "../../lib/api";
import { BlockInput } from "../../lib/api.types";
import { toMins, formatTime } from "../../lib/time";
import { ProgressBar } from "../../components/ProgressBar";

function formatDuration(startTime: string, endTime: string): string {
    const mins = toMins(endTime) - toMins(startTime);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
}

function sampleTaskCount(block: BlockInput): number {
    const duration = toMins(block.endTime) - toMins(block.startTime);
    return duration > 120 ? 2 : 1;
}

function GapIndicator({ startTime, endTime }: { startTime: string; endTime: string }) {
    return (
        <View style={styles.gapRow}>
            <View style={styles.gapPill}>
                <Text style={styles.gapText}>{formatTime(startTime)} – {formatTime(endTime)}  ·  {formatDuration(startTime, endTime)}  ·  unplanned</Text>
            </View>
        </View>
    );
}

function BlockCard({ block }: { block: BlockInput }) {
    const isContainer = block.type === 'CONTAINER';
    const isAnchor = block.type === 'ANCHOR';
    const tasks = isContainer
        ? Array.from({ length: sampleTaskCount(block) }, (_, i) => `Sample Task ${i + 1}`)
        : [];

    return (
        <View style={[
            styles.blockCard,
            isContainer && styles.blockCardContainer,
            isAnchor && styles.blockCardAnchor,
            !isContainer && !isAnchor && styles.blockCardNoTask,
        ]}>
            <View style={styles.blockCardHeader}>
                <View style={styles.blockCardHeaderLeft}>
                    <Text style={styles.blockName}>{block.name}</Text>
                    <Text style={styles.blockTime}>{formatTime(block.startTime)} – {formatTime(block.endTime)}</Text>
                </View>
                {isContainer && block.energyLevel && (
                    <View style={styles.energyBadge}>
                        <Text style={styles.energyBadgeText}>
                            {block.energyLevel.charAt(0) + block.energyLevel.slice(1).toLowerCase()} energy
                        </Text>
                    </View>
                )}
            </View>
            {tasks.map((task, i) => (
                <View key={i}>
                    <View style={styles.sampleTaskDivider} />
                    <Text style={styles.sampleTaskText}>{task}</Text>
                </View>
            ))}
        </View>
    );
}

function DayBoundaryMarker({ label, time }: { label: 'Wake' | 'Sleep'; time: string }) {
    const isWake = label === 'Wake';
    return (
        <View style={styles.boundaryRow}>
            <Text style={styles.boundaryIcon}>{isWake ? '☀️' : '🌙'}</Text>
            <Text style={[styles.boundaryLabel, !isWake && styles.boundaryLabelSleep]}>
                {label.toLowerCase()}
            </Text>
            <Text style={[styles.boundaryTime, !isWake && styles.boundaryTimeSleep]}>
                {formatTime(time)}
            </Text>
        </View>
    );
}

type ListItem =
    | { kind: 'block'; block: BlockInput }
    | { kind: 'gap'; start: string; end: string }
    | { kind: 'boundary'; label: 'Wake' | 'Sleep'; time: string };

export default function ReviewScreen() {
    const router = useRouter();
    const { wakeTime, sleepTime, blocks } = useOnboardingStore();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const sortedBlocks = [...blocks].sort((a, b) => toMins(a.startTime) - toMins(b.startTime));

    const listItems: ListItem[] = [];

    if (wakeTime) {
        listItems.push({ kind: 'boundary', label: 'Wake', time: wakeTime });
        if (sortedBlocks.length > 0 && toMins(sortedBlocks[0].startTime) > toMins(wakeTime)) {
            listItems.push({ kind: 'gap', start: wakeTime, end: sortedBlocks[0].startTime });
        }
    }

    sortedBlocks.forEach((block, i) => {
        listItems.push({ kind: 'block', block });
        if (i < sortedBlocks.length - 1) {
            const next = sortedBlocks[i + 1];
            if (toMins(block.endTime) < toMins(next.startTime)) {
                listItems.push({ kind: 'gap', start: block.endTime, end: next.startTime });
            }
        }
    });

    if (sleepTime) {
        const lastBlock = sortedBlocks[sortedBlocks.length - 1];
        if (lastBlock && toMins(lastBlock.endTime) < toMins(sleepTime)) {
            listItems.push({ kind: 'gap', start: lastBlock.endTime, end: sleepTime });
        }
        listItems.push({ kind: 'boundary', label: 'Sleep', time: sleepTime });
    }

    const timelineElements: React.ReactNode[] = [];
    listItems.forEach((item, i) => {
        if (i > 0) {
            timelineElements.push(
                <View key={`t-${i}`} style={styles.threadSegment}>
                    <View style={styles.threadLine} />
                </View>
            );
        }
        if (item.kind === 'block') {
            timelineElements.push(<BlockCard key={`i-${i}`} block={item.block} />);
        } else if (item.kind === 'gap') {
            timelineElements.push(<GapIndicator key={`i-${i}`} startTime={item.start} endTime={item.end} />);
        } else {
            timelineElements.push(<DayBoundaryMarker key={`i-${i}`} label={item.label} time={item.time} />);
        }
    });

    const handleConfirm = async () => {
        if (!wakeTime || !sleepTime) return;
        setIsSubmitting(true);
        setError(null);
        const result = await api.createDayTemplate({ wakeTime, sleepTime, blocks });
        if (result.ok) {
            router.replace('/(onboarding)/finish');
        } else {
            setError(result.error ?? 'Something went wrong. Please try again.');
            setIsSubmitting(false);
        }
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.container}>
                <ProgressBar currentStep={4} />

                {/* Heading */}
                <View style={styles.headingBlock}>
                    <Text style={styles.title}>Review your template</Text>
                    <Text style={styles.subtitle}>
                        This is a preview of how your day template will look. Sample tasks are shown for illustration.
                    </Text>
                </View>

                {/* Block list */}
                <ScrollView
                    style={styles.scrollView}
                    showsVerticalScrollIndicator={false}
                >
                    <View>
                        {timelineElements}
                    </View>
                    <View style={styles.scrollBottomPad} />
                </ScrollView>

                {/* Footer */}
                <View style={styles.footer}>
                    {error && (
                        <View style={styles.errorBanner}>
                            <Text style={styles.errorBannerText}>{error}</Text>
                        </View>
                    )}
                    <TouchableOpacity
                        style={[styles.confirmButton, isSubmitting && styles.confirmButtonDisabled]}
                        onPress={handleConfirm}
                        activeOpacity={0.8}
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? (
                            <ActivityIndicator color="#2a2621" />
                        ) : (
                            <Text style={styles.confirmButtonText}>Confirm</Text>
                        )}
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={styles.editLink}
                        onPress={() => router.back()}
                        activeOpacity={0.6}
                        disabled={isSubmitting}
                    >
                        <Text style={styles.editLinkText}>Edit Template</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#fdfcfa',
    },
    container: {
        flex: 1,
        paddingHorizontal: 32,
        paddingTop: 20,
        paddingBottom: 32,
    },
    headingBlock: {
        gap: 12,
        marginBottom: 28,
    },
    title: {
        fontSize: 24,
        fontWeight: '500',
        color: '#2a2621',
        letterSpacing: 0.07,
        lineHeight: 30,
    },
    subtitle: {
        fontSize: 15,
        fontWeight: '400',
        color: '#7a736a',
        lineHeight: 24,
        letterSpacing: -0.23,
    },
    scrollView: {
        flex: 1,
    },
    scrollBottomPad: {
        height: 8,
    },
    threadSegment: {
        height: 12,
        paddingLeft: 10,
        justifyContent: 'center',
    },
    threadLine: {
        width: 1,
        flex: 1,
        backgroundColor: 'rgba(42,38,33,0.12)',
    },
    // Block cards
    blockCard: {
        borderRadius: 16,
    },
    blockCardContainer: {
        backgroundColor: '#fdfcfa',
        borderWidth: 1.5,
        borderColor: 'rgba(42,38,33,0.15)',
        borderStyle: 'dashed',
    },
    blockCardAnchor: {
        backgroundColor: 'rgba(232,228,221,0.45)',
    },
    blockCardNoTask: {
        backgroundColor: 'rgba(232,228,221,0.2)',
        borderWidth: 1.5,
        borderColor: 'rgba(42,38,33,0.12)',
        borderStyle: 'dashed',
    },
    blockCardHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        paddingHorizontal: 15,
        paddingTop: 13,
        paddingBottom: 13,
    },
    blockCardHeaderLeft: {
        flex: 1,
        gap: 4,
        marginRight: 8,
    },
    blockName: {
        fontSize: 15,
        fontWeight: '500',
        color: '#2a2621',
        letterSpacing: -0.2,
    },
    blockTime: {
        fontSize: 12,
        fontWeight: '400',
        color: '#7a736a',
        letterSpacing: -0.1,
    },
    energyBadge: {
        backgroundColor: 'rgba(212,165,116,0.14)',
        borderWidth: 1,
        borderColor: 'rgba(212,165,116,0.3)',
        borderRadius: 100,
        paddingHorizontal: 9,
        paddingVertical: 3,
        alignSelf: 'flex-start',
        marginTop: 1,
    },
    energyBadgeText: {
        fontSize: 11,
        fontWeight: '500',
        color: '#b07841',
    },
    sampleTaskDivider: {
        height: 0.5,
        backgroundColor: 'rgba(42,38,33,0.08)',
        marginHorizontal: 13,
    },
    sampleTaskText: {
        fontSize: 13,
        fontWeight: '400',
        color: 'rgba(42,38,33,0.5)',
        paddingHorizontal: 15,
        paddingVertical: 10,
    },
    // Day boundary markers (wake / sleep)
    boundaryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingVertical: 2,
    },
    boundaryIcon: {
        fontSize: 14,
        lineHeight: 18,
        width: 22,
        textAlign: 'center',
    },
    boundaryLabel: {
        fontSize: 10,
        fontWeight: '400',
        color: '#d4a574',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
    },
    boundaryLabelSleep: {
        color: '#9b8c7f',
    },
    boundaryTime: {
        fontSize: 13,
        fontWeight: '500',
        color: '#2a2621',
        letterSpacing: -0.15,
    },
    boundaryTimeSleep: {
        color: 'rgba(42,38,33,0.6)',
    },
    // Gap indicator
    gapRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    gapPill: {
        backgroundColor: 'rgba(42,38,33,0.05)',
        borderWidth: 0.5,
        borderColor: 'rgba(42,38,33,0.14)',
        borderRadius: 100,
        paddingHorizontal: 10,
        paddingVertical: 4,
        marginHorizontal: 8,
    },
    gapText: {
        fontSize: 10,
        fontWeight: '400',
        color: 'rgba(122,115,106,0.8)',
    },
    // Footer
    footer: {
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: 'rgba(42,38,33,0.04)',
        gap: 4,
    },
    errorBanner: {
        backgroundColor: 'rgba(220,53,53,0.08)',
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        marginBottom: 8,
    },
    errorBannerText: {
        fontSize: 14,
        color: '#c0392b',
        lineHeight: 20,
        letterSpacing: -0.15,
    },
    confirmButton: {
        height: 52,
        backgroundColor: '#d4a574',
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
    },
    confirmButtonDisabled: {
        opacity: 0.5,
    },
    confirmButtonText: {
        fontSize: 16,
        fontWeight: '500',
        color: '#2a2621',
        letterSpacing: -0.31,
    },
    editLink: {
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
    editLinkText: {
        fontSize: 16,
        fontWeight: '500',
        color: '#7a736a',
        letterSpacing: -0.31,
    },
});
