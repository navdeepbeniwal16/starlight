import { useRouter } from 'expo-router';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { useAuthStore } from '../../stores/auth.store';
import { useRef, useState } from 'react';
import { api } from '../../lib/api';
import { clearFurthestOnboardingStep } from '../../lib/onboardingProgress';
import { KeyboardScreen } from '../../components/KeyboardScreen';
import { colors, radius, spacing } from '../../lib/theme';

export default function SignupScreen() {
    const router = useRouter();
    const setAuth = useAuthStore((state) => state.setAuth);

    const emailRef = useRef<TextInput>(null);
    const passwordRef = useRef<TextInput>(null);
    const confirmRef = useRef<TextInput>(null);

    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    async function handleSignup() {
        setError(null);

        const trimmedName = fullName.trim();
        const trimmedEmail = email.trim();
        if(!trimmedName || !trimmedEmail || !password || !confirmPassword) {
            setError('All fields are required');
            return;
        }

        if(password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        const nameParts = trimmedName.split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ');

        if(!lastName) {
            setError('Please enter your full name.');
            return;
        }

        setIsLoading(true);
        const result = await api.signup({email: trimmedEmail, password, firstName, lastName});
        setIsLoading(false);

        if(!result.ok) {
            setError(result.error);
            return;
        }

        await setAuth(result.data.user, result.data.token);
        // A fresh account must not inherit a prior session's resume hint from this device.
        await clearFurthestOnboardingStep();
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
                    <Text style={styles.label}>Full Name</Text>
                    <TextInput
                        value={fullName}
                        onChangeText={setFullName}
                        style={styles.input}
                        placeholder="John Doe"
                        placeholderTextColor={colors.text.muted}
                        returnKeyType="next"
                        onSubmitEditing={() => emailRef.current?.focus()}
                        blurOnSubmit={false}
                    />
                </View>

                <View style={styles.fieldContainer}>
                    <Text style={styles.label}>Email</Text>
                    <TextInput
                        ref={emailRef}
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
                        returnKeyType="next"
                        onSubmitEditing={() => confirmRef.current?.focus()}
                        blurOnSubmit={false}
                    />
                </View>

                <View style={styles.fieldContainer}>
                    <Text style={styles.label}>Confirm Password</Text>
                    <TextInput
                        ref={confirmRef}
                        value={confirmPassword}
                        onChangeText={setConfirmPassword}
                        style={styles.input}
                        placeholder="Re-enter your password"
                        placeholderTextColor={colors.text.muted}
                        secureTextEntry
                        returnKeyType="done"
                        onSubmitEditing={handleSignup}
                    />
                </View>

                {error && <Text style={styles.errorText}>{error}</Text>}

                <TouchableOpacity
                    style={[styles.button, isLoading && styles.buttonDisabled]}
                    onPress={handleSignup}
                    disabled={isLoading}
                >
                    <Text style={styles.buttonText}>{isLoading ? 'Creating account…' : 'Create Account'}</Text>
                </TouchableOpacity>

                <View style={styles.loginRow}>
                    <Text style={styles.loginText}>Already have an account? </Text>
                    <TouchableOpacity onPress={() => router.replace('/(auth)/login')}>
                        <Text style={styles.loginLink}>Log in</Text>
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
    loginRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: spacing.xs,
    },
    loginText: {
        fontSize: 14,
        color: colors.text.secondary,
    },
    loginLink: {
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
