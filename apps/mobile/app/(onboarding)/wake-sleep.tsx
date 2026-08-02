import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useOnboardingStore } from "../../stores/onboarding.store";
import { toMins } from "../../lib/time";
import { ProgressBar } from "../../components/ProgressBar";
import { WakeSleepFields } from "../../components/WakeSleepFields";

export default function WakeSleepScreen() {
    const router = useRouter();
    const { wakeTime, sleepTime, setWakeSleepTimes } = useOnboardingStore();

    const [localWake, setLocalWake] = useState<string>(wakeTime ?? '07:00');
    const [localSleep, setLocalSleep] = useState<string>(sleepTime ?? '23:00');
    const [error, setError] = useState<string | null>(null);

    const handleContinue = () => {
        setError(null);
        if (toMins(localWake) >= toMins(localSleep)) {
            setError('Your wake time must be before your sleep time');
            return;
        }
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
                    <WakeSleepFields
                        wakeTime={localWake}
                        sleepTime={localSleep}
                        onChange={(wake, sleep) => {
                            setLocalWake(wake);
                            setLocalSleep(sleep);
                        }}
                    />

                    <View style={styles.callout}>
                        <Text style={styles.calloutText}>
                            Don't worry, these aren't strict rules. You can adjust your template anytime from settings.
                        </Text>
                    </View>
                </View>

                {error && <Text style={styles.errorText}>{error}</Text>}

                {/* Continue */}
                <TouchableOpacity
                    style={styles.continueButton}
                    onPress={handleContinue}
                    activeOpacity={0.8}
                >
                    <Text style={styles.continueButtonText}>Continue</Text>
                </TouchableOpacity>
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
    errorText: {
        position: 'absolute',
        bottom: 96,
        left: 32,
        right: 32,
        fontSize: 13,
        color: '#c0392b',
        textAlign: 'center',
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
});
