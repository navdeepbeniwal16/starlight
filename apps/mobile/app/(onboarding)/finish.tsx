import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useOnboardingStore } from "../../stores/onboarding.store";
import { ProgressBar } from "../../components/ProgressBar";

export default function FinishScreen() {
    const router = useRouter();
    const reset = useOnboardingStore((s) => s.reset);

    const handleFinish = () => {
        reset();
        router.replace('/(main)');
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.container}>
                <ProgressBar currentStep={5} />

                {/* Centered content */}
                <View style={styles.content}>
                    <View style={styles.iconCircle}>
                        <Text style={styles.iconText}>✦</Text>
                    </View>
                    <View style={styles.textBlock}>
                        <Text style={styles.title}>You're all set.</Text>
                        <Text style={styles.subtitle}>
                            Starlight knows how your day looks. It will take things from here.
                        </Text>
                    </View>
                </View>

                <TouchableOpacity
                    style={styles.finishButton}
                    onPress={handleFinish}
                    activeOpacity={0.8}
                >
                    <Text style={styles.finishButtonText}>Finish</Text>
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
    content: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 32,
    },
    iconCircle: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: 'rgba(232,220,205,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    iconText: {
        fontSize: 32,
        color: '#d4a574',
    },
    textBlock: {
        alignItems: 'center',
        gap: 16,
        paddingHorizontal: 8,
    },
    title: {
        fontSize: 28,
        fontWeight: '500',
        color: '#2a2621',
        letterSpacing: 0.07,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 15,
        fontWeight: '400',
        color: '#7a736a',
        lineHeight: 24,
        letterSpacing: -0.23,
        textAlign: 'center',
    },
    finishButton: {
        height: 52,
        backgroundColor: '#d4a574',
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
    },
    finishButtonText: {
        fontSize: 16,
        fontWeight: '500',
        color: '#2a2621',
        letterSpacing: -0.31,
    },
});
