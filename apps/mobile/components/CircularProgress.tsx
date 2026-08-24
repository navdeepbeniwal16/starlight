import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

const RING_SIZE = 32;
const RING_STROKE = 2.5;
const RING_R = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_R;

export default function CircularProgress({ progress }: { progress: number }) {
    const isDone = progress === 100;
    const fillColor = isDone ? '#5c5248' : 'rgba(212,165,116,0.85)';
    const offset = RING_CIRC * (1 - progress / 100);
    return (
        <View style={styles.ringWrap}>
            <Svg width={RING_SIZE} height={RING_SIZE}>
                <Circle
                    cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_R}
                    stroke="rgba(232,228,221,0.7)" strokeWidth={RING_STROKE} fill="none"
                />
                {progress > 0 && (
                    <Circle
                        cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_R}
                        stroke={fillColor} strokeWidth={RING_STROKE} fill="none"
                        strokeDasharray={RING_CIRC} strokeDashoffset={offset}
                        strokeLinecap="round"
                        transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
                    />
                )}
            </Svg>
            <Text style={[styles.ringLabel, isDone && styles.ringLabelDone]}>
                {progress}%
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    ringWrap: {
        width: RING_SIZE, height: RING_SIZE,
        justifyContent: 'center', alignItems: 'center',
    },
    ringLabel: {
        position: 'absolute',
        fontSize: 7, fontWeight: '600',
        color: 'rgba(122,115,106,0.5)',
        fontVariant: ['tabular-nums'],
    },
    ringLabelDone: { color: '#5c5248' },
});
