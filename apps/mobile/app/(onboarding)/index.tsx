import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ActivityIndicator, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { api } from "../../lib/api";
import { getToken } from "../../lib/auth-token";

export default function OnboardingRouter() {
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);

    const checkTemplate = async () => {
        setError(null);

        const token = await getToken();
        if (!token) {
            router.replace('/(auth)/login');
            return;
        }

        const result = await api.getDayTemplate();

        if (result.ok) {
            router.replace('/(main)');
        } else if (result.status === 404) {
            router.replace('/(onboarding)/welcome');
        } else {
            setError(result.error);
        }
    };

    useEffect(() => {
        checkTemplate();
    }, []);

    if (error) {
        return (
            <View style={styles.container}>
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity style={styles.retryButton} onPress={checkTemplate}>
                    <Text style={styles.retryButtonText}>Try Again</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <ActivityIndicator />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#fdfcfa',
    },
    errorText: {
        color: '#2a2621',
        marginBottom: 16,
        textAlign: 'center',
        paddingHorizontal: 32,
    },
    retryButton: {
        backgroundColor: '#d4a574',
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
    },
    retryButtonText: {
        color: '#fff',
        fontWeight: '600',
    },
});
