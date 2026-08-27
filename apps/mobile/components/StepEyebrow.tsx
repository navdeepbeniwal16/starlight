import { View, Text, StyleSheet } from "react-native";
import { colors } from "../lib/theme";

type Props = {
    step: number;
    total: number;
};

export function StepEyebrow({ step, total }: Props) {
    return (
        <View style={styles.eyebrow}>
            {Array.from({ length: total }, (_, i) => (
                <View
                    key={i}
                    style={[
                        styles.pip,
                        i < step - 1 && styles.pipDone,
                        i === step - 1 && styles.pipActive,
                    ]}
                />
            ))}
            <Text style={styles.label}>Step {step} of {total}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    eyebrow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 10,
    },
    pip: {
        width: 5,
        height: 5,
        borderRadius: 2.5,
        backgroundColor: 'rgba(42,38,33,0.14)',
    },
    pipDone: {
        backgroundColor: colors.accent.default,
    },
    pipActive: {
        width: 14,
        backgroundColor: colors.accent.default,
    },
    label: {
        fontSize: 11,
        fontWeight: '600',
        color: 'rgba(122,115,106,0.5)',
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        marginLeft: 2,
        fontVariant: ['tabular-nums'],
    },
});
