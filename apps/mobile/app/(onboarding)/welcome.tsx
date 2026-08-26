import { View, Text, StyleSheet, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, radius, spacing } from "../../lib/theme";
import { PressableScale } from "../../components/PressableScale";

// No progress eyebrow — the onboarding cover reads as a cover, not a working step.
export default function WelcomeScreen() {
    const router = useRouter();

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.container}>
                <View style={styles.content}>
                    <View style={styles.logoRow}>
                        <Image source={require('../../assets/splash-icon.png')} style={styles.logo} resizeMode="contain" />
                        <Text style={styles.logoText}>Starlight</Text>
                    </View>

                    <View style={styles.promiseBlock}>
                        <Text style={styles.heading}>Tell us how your days go, and Starlight will plan one for you.</Text>
                        <Text style={styles.body}>
                            Sketch a typical day, add a task or two, and watch Starlight fit it in. Takes about a minute.
                        </Text>
                    </View>
                </View>

                <PressableScale style={styles.button} onPress={() => router.push('/(onboarding)/build')}>
                    <Text style={styles.buttonText}>Get started</Text>
                </PressableScale>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: colors.surface.page,
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
        gap: 40,
    },
    logoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
    },
    logo: {
        width: 44,
        height: 44,
    },
    logoText: {
        fontFamily: 'Caprasimo_400Regular',
        fontSize: 30,
        color: colors.text.primary,
        letterSpacing: -0.5,
    },
    promiseBlock: {
        gap: 16,
    },
    heading: {
        fontSize: 26,
        fontWeight: '600',
        color: colors.text.primary,
        letterSpacing: -0.3,
        lineHeight: 34,
    },
    body: {
        fontSize: 15,
        color: colors.text.secondary,
        lineHeight: 24,
        letterSpacing: -0.23,
    },
    button: {
        height: 52,
        backgroundColor: colors.text.primary,
        borderRadius: radius.md,
        justifyContent: 'center',
        alignItems: 'center',
    },
    buttonText: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.surface.page,
        letterSpacing: -0.1,
    },
});
