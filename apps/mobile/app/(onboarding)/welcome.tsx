import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ProgressBar } from "../../components/ProgressBar";

export default function WelcomeScreen() {
    const router = useRouter();

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.container}>
                <ProgressBar currentStep={1} />
                <View style={styles.content}>
                    {/* Logo */}
                    <View style={styles.logoRow}>
                        <Text style={styles.logoIcon}>✦</Text>
                        <Text style={styles.logoText}>Starlight</Text>
                    </View>
                    <Text style={styles.tagline}>Your day, handled.</Text>

                    {/* Intro */}
                    <View style={styles.introBlock}>
                        <Text style={styles.heading}>Your own planning assistant</Text>
                        <Text style={styles.body}>
                            Set up how your days usually look, and let Starlight slot your tasks in. It works around your life, not the other way around.
                        </Text>
                    </View>
                </View>

                <TouchableOpacity style={styles.button} onPress={() => router.push('/(onboarding)/wake-sleep')} activeOpacity={0.8}>
                    <Text style={styles.buttonText}>Get Started</Text>
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
        justifyContent: 'space-between',
    },
    content: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 48,
    },
    logoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    logoIcon: {
        fontSize: 28,
        color: '#d4a574',
    },
    logoText: {
        fontSize: 28,
        fontWeight: '500',
        color: '#2a2621',
        letterSpacing: 0.4,
    },
    tagline: {
        fontSize: 15,
        color: '#7a736a',
        letterSpacing: -0.23,
        marginTop: -36,
    },
    introBlock: {
        alignItems: 'center',
        gap: 20,
        paddingHorizontal: 8,
    },
    heading: {
        fontSize: 20,
        fontWeight: '600',
        color: '#2a2621',
        textAlign: 'center',
        letterSpacing: -0.3,
    },
    body: {
        fontSize: 15,
        color: '#7a736a',
        textAlign: 'center',
        lineHeight: 24,
        letterSpacing: -0.23,
    },
    button: {
        height: 52,
        backgroundColor: '#d4a574',
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
    },
    buttonText: {
        fontSize: 16,
        fontWeight: '500',
        color: '#2a2621',
        letterSpacing: -0.31,
    },
});
