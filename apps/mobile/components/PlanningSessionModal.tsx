import { Modal, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

type Props = {
    visible: boolean;
    planId: string | null;
    onClose: () => void;
};

export default function PlanningSessionModal({ visible, planId, onClose }: Props) {
    const insets = useSafeAreaInsets();

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onClose}
        >
            <View style={[styles.container, { paddingTop: insets.top }]}>
                <View style={styles.header}>
                    <Text style={styles.headerTitle}>Plan day</Text>
                    <TouchableOpacity
                        onPress={onClose}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        activeOpacity={0.6}
                    >
                        <Ionicons name="close" size={22} color="#2a2621" />
                    </TouchableOpacity>
                </View>

                <View style={styles.body}>
                    <View style={styles.iconCircle}>
                        <Text style={styles.icon}>✦</Text>
                    </View>
                    <Text style={styles.title}>Let's plan your day</Text>
                    <Text style={styles.subtitle}>Your time blocks are ready to be filled.</Text>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fdfcfa',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(42,38,33,0.06)',
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#2a2621',
        letterSpacing: -0.3,
    },
    body: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
        gap: 12,
    },
    iconCircle: {
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: 'rgba(212,165,116,0.12)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 4,
    },
    icon: {
        fontSize: 22,
        color: '#d4a574',
    },
    title: {
        fontSize: 20,
        fontWeight: '600',
        color: '#2a2621',
        letterSpacing: -0.5,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 14,
        color: '#7a736a',
        letterSpacing: -0.15,
        textAlign: 'center',
    },
});
