import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform, Modal, TouchableWithoutFeedback } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { toHHmm, hhMmToDate, parseDisplayTime, toMins, formatDuration } from "../lib/time";
import { colors, radius, spacing } from "../lib/theme";

type PickerTarget = 'wake' | 'sleep' | null;

// The awake-window length as a duration label, or null when sleep isn't after wake.
function windowDuration(wakeTime: string, sleepTime: string): string | null {
    const mins = toMins(sleepTime) - toMins(wakeTime);
    return mins > 0 ? formatDuration(mins) : null;
}

// Compact "day window" control: two tappable time chips (wake and sleep)
// with a duration pill between them.
// Each chip opens its own picker, so the two read as separately editable.
// Controlled: the parent owns the values and receives the full pair on every change.
export function WakeSleepBar({
    wakeTime,
    sleepTime,
    onChange,
}: {
    wakeTime: string;
    sleepTime: string;
    onChange: (wakeTime: string, sleepTime: string) => void;
}) {
    const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);
    const [pickerValue, setPickerValue] = useState(new Date());

    const wake = parseDisplayTime(wakeTime);
    const sleep = parseDisplayTime(sleepTime);
    const duration = windowDuration(wakeTime, sleepTime);

    const openPicker = (target: PickerTarget) => {
        const current = target === 'wake' ? wakeTime : sleepTime;
        setPickerValue(hhMmToDate(current));
        setPickerTarget(target);
    };

    const handlePickerChange = (_: any, date?: Date) => {
        if (Platform.OS === 'android') setPickerTarget(null);
        if (date) {
            const value = toHHmm(date);
            if (pickerTarget === 'wake') onChange(value, sleepTime);
            else if (pickerTarget === 'sleep') onChange(wakeTime, value);
        }
    };

    return (
        <>
            <View>
                <View style={styles.captionRow}>
                    <View style={styles.caption}>
                        <Ionicons name="sunny-outline" size={13} color={colors.accent.default} />
                        <Text style={styles.label}>WAKE</Text>
                        <View style={styles.connectorLine} />
                    </View>

                    {duration && (
                        <View style={styles.durationPill}>
                            <Text style={styles.durationText}>{duration}</Text>
                        </View>
                    )}

                    <View style={[styles.caption, styles.captionRight]}>
                        <View style={styles.connectorLine} />
                        <Text style={styles.label}>SLEEP</Text>
                        <Ionicons name="moon-outline" size={13} color={colors.text.secondary} />
                    </View>
                </View>

                <View style={styles.chipRow}>
                    <TimeChip time={wake.time} period={wake.period} onPress={() => openPicker('wake')} />
                    <TimeChip time={sleep.time} period={sleep.period} onPress={() => openPicker('sleep')} />
                </View>
            </View>

            {/* iOS picker modal */}
            {Platform.OS === 'ios' && pickerTarget && (
                <Modal transparent animationType="slide">
                    <TouchableWithoutFeedback onPress={() => setPickerTarget(null)}>
                        <View style={styles.pickerOverlay}>
                            <TouchableWithoutFeedback>
                                <View style={styles.pickerSheet}>
                                    <View style={styles.pickerHeader}>
                                        <Text style={styles.pickerTitle}>
                                            {pickerTarget === 'wake' ? 'Wake up time' : 'Sleep time'}
                                        </Text>
                                        <TouchableOpacity onPress={() => setPickerTarget(null)} hitSlop={16}>
                                            <Text style={styles.pickerDoneText}>Done</Text>
                                        </TouchableOpacity>
                                    </View>
                                    <DateTimePicker
                                        value={pickerValue}
                                        mode="time"
                                        display="spinner"
                                        onChange={handlePickerChange}
                                        style={styles.picker}
                                    />
                                </View>
                            </TouchableWithoutFeedback>
                        </View>
                    </TouchableWithoutFeedback>
                </Modal>
            )}

            {Platform.OS === 'android' && pickerTarget && (
                <DateTimePicker
                    value={pickerValue}
                    mode="time"
                    display="default"
                    onChange={handlePickerChange}
                />
            )}
        </>
    );
}

function TimeChip({ time, period, onPress }: { time: string; period: string; onPress: () => void }) {
    return (
        <TouchableOpacity style={styles.chip} onPress={onPress} activeOpacity={0.6}>
            <View style={styles.timeRow}>
                <Text style={styles.time}>{time}</Text>
                <Text style={styles.period}>{period}</Text>
            </View>
            <Ionicons name="chevron-down" size={15} color={colors.text.secondary} />
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    captionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.xs, marginBottom: 7 },
    caption: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
    captionRight: { justifyContent: 'flex-end' },
    label: { fontSize: 10, fontWeight: '600', color: colors.text.secondary, letterSpacing: 0.8 },
    connectorLine: { flex: 1, height: 1, backgroundColor: colors.border.hairline },

    durationPill: { backgroundColor: colors.surface.sunken, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3, marginHorizontal: 6 },
    durationText: { fontSize: 11, fontWeight: '500', color: colors.text.secondary, fontVariant: ['tabular-nums'] },

    chipRow: { flexDirection: 'row', gap: spacing.sm },
    chip: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: colors.surface.raised,
        borderWidth: 1,
        borderColor: colors.border.hairline,
        borderRadius: radius.md,
        paddingHorizontal: 14,
        paddingVertical: 12,
        // Soft lift so each chip reads as a raised, tappable control.
        shadowColor: '#2a2621',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 4,
        elevation: 1,
    },
    timeRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
    time: { fontSize: 17, fontWeight: '500', color: colors.text.primary, letterSpacing: -0.2, fontVariant: ['tabular-nums'] },
    period: { fontSize: 11, fontWeight: '600', color: colors.accent.default },

    pickerOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim },
    pickerSheet: { backgroundColor: '#fff', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: 40 },
    pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingTop: 20, paddingBottom: spacing.xs },
    pickerTitle: { fontSize: 15, fontWeight: '500', color: colors.text.primary },
    pickerDoneText: { fontSize: 16, fontWeight: '600', color: colors.accent.default },
    picker: { width: '100%' },
});
