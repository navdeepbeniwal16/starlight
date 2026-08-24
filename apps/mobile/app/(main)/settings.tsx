import { View, Text, StyleSheet, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useShallow } from "zustand/react/shallow";
import { useAuthStore } from "../../stores/auth.store";
import { PressableScale } from "../../components/PressableScale";
import { colors, radius, spacing, shadow } from "../../lib/theme";

export default function SettingsScreen() {
    const router = useRouter();
    const { user, clearAuth } = useAuthStore(
        useShallow(state => ({ user: state.user, clearAuth: state.clearAuth }))
    );

    const initials = user
        ? `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase()
        : '';

    const version = Constants.expoConfig?.version;

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
        <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <View style={styles.header}>
                <Text style={styles.headerTitle}>Settings</Text>
            </View>

            <View style={styles.body}>
                <View style={styles.profile}>
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

                <View style={styles.card}>
                    <SettingsRow
                        icon="calendar-outline"
                        label="Day Template"
                        onPress={() => router.push('/day-template')}
                    />
                </View>

                <View style={styles.card}>
                    <PressableScale style={styles.row} onPress={confirmLogout} activeScale={0.98}>
                        <Ionicons name="log-out-outline" size={18} color={colors.danger.default} />
                        <Text style={styles.logoutLabel}>Log out</Text>
                    </PressableScale>
                </View>

                {version && <Text style={styles.version}>Starlight v{version}</Text>}
            </View>
        </SafeAreaView>
    );
}

function SettingsRow({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
    return (
        <PressableScale style={styles.row} onPress={onPress} activeScale={0.98}>
            <Ionicons name={icon} size={18} color={colors.text.secondary} />
            <Text style={styles.rowLabel}>{label}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.text.muted} style={styles.rowChevron} />
        </PressableScale>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.surface.page },

    header: {
        paddingHorizontal: spacing.lg,
        paddingTop: spacing.lg,
        paddingBottom: 17,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(42,38,33,0.04)',
    },
    headerTitle: { fontSize: 18, fontWeight: '600', color: colors.text.primary, letterSpacing: -0.3 },

    body: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md },

    profile: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: spacing.lg,
        borderRadius: radius.lg,
        backgroundColor: colors.surface.block,
    },
    avatar: {
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: colors.text.primary,
        justifyContent: 'center',
        alignItems: 'center',
    },
    avatarText: { fontSize: 18, fontWeight: '600', color: colors.surface.page },
    profileInfo: { flex: 1 },
    profileName: { fontSize: 16, fontWeight: '500', color: colors.text.primary, letterSpacing: -0.23, marginBottom: 3 },
    profileEmail: { fontSize: 14, color: colors.text.secondary, letterSpacing: -0.15 },

    card: {
        backgroundColor: colors.surface.raised,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.04)',
        ...shadow.soft,
    },

    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingHorizontal: spacing.lg,
        paddingVertical: 14,
        minHeight: 52,
    },
    rowLabel: { fontSize: 15, fontWeight: '500', color: colors.text.primary, letterSpacing: -0.15 },
    rowChevron: { marginLeft: 'auto' },
    logoutLabel: { fontSize: 15, fontWeight: '500', color: colors.danger.default, letterSpacing: -0.15 },

    version: { marginTop: 'auto', paddingVertical: spacing.xl, textAlign: 'center', fontSize: 12, color: colors.text.muted, letterSpacing: -0.1 },
});
