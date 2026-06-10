import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform, Modal, TouchableWithoutFeedback } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useOnboardingStore } from "../../stores/onboarding.store";
import { toHHmm, hhMmToDate, parseDisplayTime } from "../../lib/time";
import { ProgressBar } from "../../components/ProgressBar";

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

export default function WakeSleepScreen() {
    const router = useRouter();
    const { wakeTime, sleepTime, setWakeSleepTimes } = useOnboardingStore();

    const [localWake, setLocalWake] = useState<string>(wakeTime ?? '07:00');
    const [localSleep, setLocalSleep] = useState<string>(sleepTime ?? '23:00');
    const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);
    const [pickerValue, setPickerValue] = useState(new Date());

    const openPicker = (target: PickerTarget) => {
        const current = target === 'wake' ? localWake : localSleep;
        setPickerValue(hhMmToDate(current));
        setPickerTarget(target);
    };

    const handlePickerChange = (_: any, date?: Date) => {
        if (Platform.OS === 'android') setPickerTarget(null);
        if (date) {
            const value = toHHmm(date);
            if (pickerTarget === 'wake') setLocalWake(value);
            else if (pickerTarget === 'sleep') setLocalSleep(value);
        }
    };

    const handleContinue = () => {
        setWakeSleepTimes(localWake, localSleep);
        router.push('/(onboarding)/blocks');
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.container}>
                <ProgressBar currentStep={2} />

                {/* Heading */}
                <View style={styles.headingBlock}>
                    <Text style={styles.title}>When does your day start and end?</Text>
                    <Text style={styles.subtitle}>
                        Set your typical wake and sleep times. This helps us understand the boundaries of your day.
                    </Text>
                </View>

                {/* Fields */}
                <View style={styles.fieldsBlock}>
                    <TimePickerRow label="Wake up time" value={localWake} onPress={() => openPicker('wake')} />
                    <TimePickerRow label="Sleep time" value={localSleep} onPress={() => openPicker('sleep')} />

                    <View style={styles.callout}>
                        <Text style={styles.calloutText}>
                            Don't worry, these aren't strict rules. You can adjust your template anytime from settings.
                        </Text>
                    </View>
                </View>

                {/* Continue */}
                <TouchableOpacity
                    style={styles.continueButton}
                    onPress={handleContinue}
                    activeOpacity={0.8}
                >
                    <Text style={styles.continueButtonText}>Continue</Text>
                </TouchableOpacity>
            </View>

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
        marginBottom: 40,
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
    fieldsBlock: {
        gap: 32,
    },
    fieldGroup: {
        gap: 12,
    },
    fieldLabel: {
        fontSize: 14,
        fontWeight: '500',
        color: '#7a736a',
        letterSpacing: -0.15,
    },
    timeRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#fffef9',
        borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.08)',
        borderRadius: 16,
        paddingHorizontal: 19,
        height: 62,
    },
    timeValueRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 5,
    },
    timeValue: {
        fontSize: 20,
        fontWeight: '500',
        color: '#2a2621',
    },
    timePeriod: {
        fontSize: 13,
        fontWeight: '500',
        color: '#d4a574',
    },
    chevron: {
        fontSize: 18,
        color: '#7a736a',
    },
    callout: {
        backgroundColor: 'rgba(232,228,221,0.3)',
        borderRadius: 16,
        padding: 20,
    },
    calloutText: {
        fontSize: 14,
        fontWeight: '400',
        color: '#7a736a',
        lineHeight: 22,
        letterSpacing: -0.15,
    },
    continueButton: {
        position: 'absolute',
        bottom: 32,
        left: 32,
        right: 32,
        height: 52,
        backgroundColor: '#d4a574',
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
    },
    continueButtonText: {
        fontSize: 16,
        fontWeight: '500',
        color: '#2a2621',
        letterSpacing: -0.31,
    },
    pickerOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.3)',
    },
    pickerSheet: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingBottom: 40,
    },
    pickerHeader: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        paddingHorizontal: 24,
        paddingTop: 20,
        paddingBottom: 4,
    },
    pickerDoneText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#d4a574',
    },
    picker: {
        width: '100%',
    },
});
