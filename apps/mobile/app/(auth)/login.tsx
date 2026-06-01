import { useRouter } from 'expo-router';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuthStore } from '../../stores/auth.store';
import { useState } from 'react';
import { api } from '../../lib/api';

export default function LoginScreen() {
    const router = useRouter();
    const setAuth = useAuthStore((state) => state.setAuth);

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
        <View style={styles.container}>
        {/* Logo */}
        <View style={styles.logoContainer}>
        <Text style={styles.appName}>Starlight</Text>
        <Text style={styles.tagline}>Your day, handled.</Text>
        </View>
        
        {/* Form */}
        <View style={styles.form}>
        <View style={styles.fieldContainer}>
        <Text style={styles.label}>Email</Text>
        <TextInput value={email} onChangeText={setEmail} style={styles.input} placeholder="you@example.com" placeholderTextColor="rgba(122,115,106,0.5)" keyboardType="email-address" autoCapitalize="none" />
        </View>
        
        <View style={styles.fieldContainer}>
        <Text style={styles.label}>Password</Text>
        <TextInput value={password} onChangeText={setPassword} style={styles.input} placeholder="••••••••" placeholderTextColor="rgba(122,115,106,0.5)" secureTextEntry />
        </View>
        
        <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={isLoading}>
        <Text style={styles.buttonText}>{isLoading ? 'Logging...' : 'Login'}</Text>
        </TouchableOpacity>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <View style={styles.signupRow}>
        <Text style={styles.signupText}>Don't have an account? </Text>
        <TouchableOpacity onPress={() => router.replace('/(auth)/signup')}>
        <Text style={styles.signupLink}>Sign up</Text>
        </TouchableOpacity>
        </View>
        </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fdfcfa',
        justifyContent: 'center',
        paddingHorizontal: 24,
        gap: 48,
    },
    logoContainer: {
        alignItems: 'center',
        gap: 12,
    },
    appName: {
        fontSize: 24,
        fontWeight: '500',
        color: '#2a2621',
        letterSpacing: 0.07,
    },
    tagline: {
        fontSize: 14,
        color: '#7a736a',
        letterSpacing: -0.15,
    },
    form: {
        gap: 24,
    },
    fieldContainer: {
        gap: 8,
    },
    label: {
        fontSize: 14,
        fontWeight: '500',
        color: '#7a736a',
        letterSpacing: -0.15,
    },
    input: {
        height: 50,
        backgroundColor: '#fffef9',
        borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.08)',
        borderRadius: 16,
        paddingHorizontal: 16,
        fontSize: 16,
        color: '#2a2621',
        letterSpacing: -0.31,
    },
    button: {
        height: 48,
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
    signupRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
    signupText: {
        fontSize: 14,
        color: '#7a736a',
    },
    signupLink: {
        fontSize: 16,
        fontWeight: '500',
        color: '#2a2621',
    },
    errorText: {
        color: 'red',
        fontSize: 14,
        textAlign: 'center',
    },
});