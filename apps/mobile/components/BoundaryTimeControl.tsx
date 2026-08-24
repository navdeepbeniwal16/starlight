import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform, Modal, TouchableWithoutFeedback } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { toHHmm, hhMmToDate } from "../lib/time";
import { colors, radius, spacing } from "../lib/theme";
import { DayBoundaryMarker } from "./timeline";

export function BoundaryTimeControl({ label, time, onChange }: { label: 'Wake' | 'Sleep'; time: string; onChange: (time: string) => void }) {
    const [open, setOpen] = useState(false);
    const [pickerValue, setPickerValue] = useState(() => hhMmToDate(time));

    const openPicker = () => {
        setPickerValue(hhMmToDate(time));
        setOpen(true);
    };

    const handleChange = (_: unknown, date?: Date) => {
        if (Platform.OS === 'android') setOpen(false);
        if (date) onChange(toHHmm(date));
    };

    return (
        <>
            <DayBoundaryMarker label={label} time={time} onPress={openPicker} />

            {Platform.OS === 'ios' && open && (
                <Modal transparent animationType="slide">
                    <TouchableWithoutFeedback onPress={() => setOpen(false)}>
                        <View style={styles.overlay}>
                            <TouchableWithoutFeedback>
                                <View style={styles.sheet}>
                                    <View style={styles.header}>
                                        <Text style={styles.title}>{label === 'Wake' ? 'Wake up time' : 'Sleep time'}</Text>
                                        <TouchableOpacity onPress={() => setOpen(false)} hitSlop={16}>
                                            <Text style={styles.done}>Done</Text>
                                        </TouchableOpacity>
                                    </View>
                                    <DateTimePicker value={pickerValue} mode="time" display="spinner" onChange={handleChange} style={styles.picker} />
                                </View>
                            </TouchableWithoutFeedback>
                        </View>
                    </TouchableWithoutFeedback>
                </Modal>
            )}

            {Platform.OS === 'android' && open && (
                <DateTimePicker value={pickerValue} mode="time" display="default" onChange={handleChange} />
            )}
        </>
    );
}

const styles = StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim },
    sheet: { backgroundColor: '#fff', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: 40 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingTop: 20, paddingBottom: spacing.xs },
    title: { fontSize: 15, fontWeight: '500', color: colors.text.primary },
    done: { fontSize: 16, fontWeight: '600', color: colors.accent.default },
    picker: { width: '100%' },
});
