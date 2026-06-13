import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useShallow } from "zustand/react/shallow";
import { useAuthStore } from "../../stores/auth.store";

export default function SettingsScreen() {
    const router = useRouter();
    const { user, clearAuth } = useAuthStore(
        useShallow(state => ({ user: state.user, clearAuth: state.clearAuth }))
    );

    const initials = user
        ? `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase()
        : '';

    async function handleLogout() {
        await clearAuth();
        router.replace('/(auth)/login');
    }

    function confirmLogout() {
        Alert.alert(
            'Log out',
            'Are you sure you want to log out?',
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Log out', style: 'destructive', onPress: handleLogout },
            ]
        );
    }

    return (
        <SafeAreaView style={styles.safeArea}>

            <View style={styles.header}>
                <Text style={styles.headerTitle}>Settings</Text>
            </View>

            <View style={styles.content}>

                <View style={styles.card}>
                    <View style={styles.profileRow}>
                        <View style={styles.avatar}>
                            <Text style={styles.avatarText}>{initials}</Text>
                        </View>
                        <View style={styles.profileInfo}>
                            <Text style={styles.profileName}>
                                {user?.firstName} {user?.lastName}
                            </Text>
                            <Text style={styles.profileEmail}>{user?.email}</Text>
                        </View>
                    </View>
                </View>

                <View style={styles.card}>
                    <TouchableOpacity style={styles.actionRow} onPress={confirmLogout} activeOpacity={0.7}>
                        <Ionicons name="log-out-outline" size={18} color="rgba(200,80,80,0.85)" />
                        <Text style={styles.actionLabel}>Log out</Text>
                    </TouchableOpacity>
                </View>

            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: '#fdfcfa' },

    header: {
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(42,38,33,0.04)',
    },
    headerTitle: { fontSize: 18, fontWeight: '500', color: '#2a2621' },

    content: { padding: 16, gap: 12 },

    card: {
        backgroundColor: '#fffef9',
        borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.06)',
        borderRadius: 16,
        overflow: 'hidden',
    },

    profileRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        gap: 14,
    },
    avatar: {
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: '#2a2621',
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarText: { fontSize: 18, fontWeight: '600', color: '#fdfcfa' },
    profileInfo: { flex: 1 },
    profileName: { fontSize: 16, fontWeight: '500', color: '#2a2621', marginBottom: 3 },
    profileEmail: { fontSize: 14, color: '#7a736a' },

    actionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    actionLabel: { fontSize: 14, fontWeight: '500', color: 'rgba(200,80,80,0.85)' },
});
