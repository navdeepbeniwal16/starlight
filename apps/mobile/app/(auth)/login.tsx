import { useRouter } from 'expo-router';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { useAuthStore } from '../../stores/auth.store';
import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { KeyboardScreen } from '../../components/KeyboardScreen';
import { colors, radius, spacing } from '../../lib/theme';

export default function LoginScreen() {
    const router = useRouter();
    const setAuth = useAuthStore((state) => state.setAuth);

    const passwordRef = useRef<TextInput>(null);

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    async function handleLogin() {
        setError(null);

        const trimmedEmail = email.trim();
        if(!trimmedEmail || !password) {
            setError('All fields are required');
            return;
        }

        setIsLoading(true);
        const result = await api.login({email: trimmedEmail, password});
        setIsLoading(false);

        if(!result.ok) {
            setError(result.error);
            return;
        }

        await setAuth(result.data.user, result.data.token);
        router.replace('/(onboarding)');
    }

    return (
        <KeyboardScreen style={styles.screen} contentContainerStyle={styles.container}>
            <View style={styles.header}>
                <Image source={require('../../assets/splash-icon.png')} style={styles.logo} resizeMode="contain" />
                <View style={styles.wordmark}>
                    <Text style={styles.appName}>Starlight</Text>
                    <Text style={styles.tagline}>Live each day with intention</Text>
                </View>
            </View>

            <View style={styles.form}>
                <View style={styles.fieldContainer}>
                    <Text style={styles.label}>Email</Text>
                    <TextInput
                        value={email}
                        onChangeText={setEmail}
                        style={styles.input}
                        placeholder="you@example.com"
                        placeholderTextColor={colors.text.muted}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        returnKeyType="next"
                        onSubmitEditing={() => passwordRef.current?.focus()}
                        blurOnSubmit={false}
                    />
                </View>

                <View style={styles.fieldContainer}>
                    <Text style={styles.label}>Password</Text>
                    <TextInput
                        ref={passwordRef}
                        value={password}
                        onChangeText={setPassword}
                        style={styles.input}
                        placeholder="Enter your password"
                        placeholderTextColor={colors.text.muted}
                        secureTextEntry
                        returnKeyType="done"
                        onSubmitEditing={handleLogin}
                    />
                </View>

                {error && <Text style={styles.errorText}>{error}</Text>}

                <TouchableOpacity
                    style={[styles.button, isLoading && styles.buttonDisabled]}
                    onPress={handleLogin}
                    disabled={isLoading}
                >
                    <Text style={styles.buttonText}>{isLoading ? 'Logging in…' : 'Login'}</Text>
                </TouchableOpacity>

                <View style={styles.signupRow}>
                    <Text style={styles.signupText}>Don't have an account? </Text>
                    <TouchableOpacity onPress={() => router.replace('/(auth)/signup')}>
                        <Text style={styles.signupLink}>Sign up</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </KeyboardScreen>
    );
}

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: colors.surface.page,
    },
    container: {
        flexGrow: 1,
        justifyContent: 'center',
        paddingHorizontal: 24,
        gap: 44,
    },
    header: {
        alignItems: 'center',
        gap: spacing.xs,
    },
    logo: {
        width: 96,
        height: 96,
    },
    wordmark: {
        alignItems: 'center',
        gap: spacing.xs,
    },
    appName: {
        fontFamily: 'Caprasimo_400Regular',
        fontSize: 30,
        color: colors.text.primary,
        letterSpacing: -0.5,
    },
    tagline: {
        fontSize: 14,
        color: colors.text.secondary,
        letterSpacing: -0.15,
        textAlign: 'center',
        lineHeight: 20,
        paddingHorizontal: 24,
    },
    form: {
        gap: spacing.xl,
    },
    fieldContainer: {
        gap: spacing.sm,
    },
    label: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.text.secondary,
        letterSpacing: -0.15,
    },
    input: {
        // Padding-based height (not a fixed `height`) so plain and secureTextEntry
        // fields center their text identically — iOS baselines them differently otherwise.
        paddingVertical: 14,
        backgroundColor: colors.surface.raised,
        borderWidth: 1,
        borderColor: colors.border.hairline,
        borderRadius: radius.md,
        paddingHorizontal: 14,
        fontSize: 15,
        color: colors.text.primary,
        letterSpacing: -0.15,
    },
    button: {
        height: 48,
        backgroundColor: colors.text.primary,
        borderRadius: radius.md,
        justifyContent: 'center',
        alignItems: 'center',
    },
    buttonDisabled: {
        opacity: 0.6,
    },
    buttonText: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.surface.page,
        letterSpacing: -0.1,
    },
    signupRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: spacing.xs,
    },
    signupText: {
        fontSize: 14,
        color: colors.text.secondary,
    },
    signupLink: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.text.primary,
    },
    errorText: {
        color: colors.danger.default,
        fontSize: 13,
        textAlign: 'center',
    },
});
