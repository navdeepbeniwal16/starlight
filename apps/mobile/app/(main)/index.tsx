import { View, Text, StyleSheet } from "react-native";

export default function MainScreen() {
    return (
        <View style={styles.container}>
            <Text style={styles.title}>Starlight</Text>
            <Text style={styles.subtitle}>Main app coming soon.</Text>
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
    title: {
        fontSize: 24,
        fontWeight: '600',
        color: '#2a2621',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 15,
        color: '#8a7f78',
    },
});
