import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform, Modal, TouchableWithoutFeedback } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { toHHmm, hhMmToDate, parseDisplayTime } from "../lib/time";

type PickerTarget = 'wake' | 'sleep' | null;

function TimePickerRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
    const { time, period } = parseDisplayTime(value);

    return (
        <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <TouchableOpacity style={styles.timeRow} onPress={onPress} activeOpacity={0.7}>
                <View style={styles.timeValueRow}>
                    <Text style={styles.timeValue}>{time}</Text>
                    <Text style={styles.timePeriod}>{period}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
        </View>
    );
}

/**
 * Controlled wake/sleep time inputs. The parent owns the current values and
 * receives the full pair on every change, so the same component drives both
 * onboarding (local screen state) and the template editor (draft store).
 */
export function WakeSleepFields({
    wakeTime,
    sleepTime,
    onChange,
    wakeLabel = 'Wake up time',
    sleepLabel = 'Sleep time',
}: {
    wakeTime: string;
    sleepTime: string;
    onChange: (wakeTime: string, sleepTime: string) => void;
    wakeLabel?: string;
    sleepLabel?: string;
}) {
    const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);
    const [pickerValue, setPickerValue] = useState(new Date());

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
            <TimePickerRow label={wakeLabel} value={wakeTime} onPress={() => openPicker('wake')} />
            <TimePickerRow label={sleepLabel} value={sleepTime} onPress={() => openPicker('sleep')} />

            {/* iOS picker modal */}
            {Platform.OS === 'ios' && pickerTarget && (
                <Modal transparent animationType="slide">
                    <TouchableWithoutFeedback onPress={() => setPickerTarget(null)}>
                        <View style={styles.pickerOverlay}>
                            <TouchableWithoutFeedback>
                                <View style={styles.pickerSheet}>
                                    <View style={styles.pickerHeader}>
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

const styles = StyleSheet.create({
    fieldGroup: { gap: 12 },
    fieldLabel: { fontSize: 14, fontWeight: '500', color: '#7a736a', letterSpacing: -0.15 },
    timeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#fffef9',
        borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.10)',
        borderRadius: 16,
        paddingHorizontal: 19,
        height: 62,
    },
    timeValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
    timeValue: { fontSize: 20, fontWeight: '500', color: '#2a2621' },
    timePeriod: { fontSize: 13, fontWeight: '500', color: '#d4a574' },
    chevron: { fontSize: 18, color: '#7a736a' },
    pickerOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.3)' },
    pickerSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40 },
    pickerHeader: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 4 },
    pickerDoneText: { fontSize: 16, fontWeight: '600', color: '#d4a574' },
    picker: { width: '100%' },
});
