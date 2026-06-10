import { View, StyleSheet } from "react-native";

type Props = {
    currentStep: number;
    totalSteps?: number;
};

export function ProgressBar({ currentStep, totalSteps = 5 }: Props) {
    return (
        <View style={styles.bar}>
            {Array.from({ length: totalSteps }, (_, i) => (
                <View key={i} style={[styles.segment, i < currentStep && styles.segmentActive]} />
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 40,
    },
    segment: {
        flex: 1,
        height: 4,
        borderRadius: 999,
        backgroundColor: 'rgba(42,38,33,0.08)',
    },
    segmentActive: {
        backgroundColor: '#d4a574',
    },
});
