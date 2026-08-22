import { StyleSheet, Text, View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';

import { colors } from '../lib/theme';
import { STAR } from './Logo';

// The horizontal lockup from the design: a dark star floating above a caramel smile,
// set against the "Starlight" wordmark in Caprasimo. The mark's beam sits lower and the
// star higher than the icon's `simplified` form, so the two read as separate at small sizes.
const LOCKUP_BEAM = 'M8 80C8 80 24 56 50 56C76 56 92 80 92 80';

interface WordmarkProps {
    // Height of the mark in px; the wordmark scales from it to hold the design's ratio.
    size?: number;
}

export function Wordmark({ size = 36 }: WordmarkProps) {
    return (
        <View style={styles.row}>
            <Svg width={size} height={size} viewBox="0 0 100 100">
                <Path d={LOCKUP_BEAM} fill="none" stroke={colors.accent.default} strokeWidth={9} strokeLinecap="round" />
                <G transform="translate(29,5) scale(0.42)">
                    <Path d={STAR} fill={colors.text.primary} />
                </G>
            </Svg>
            <Text style={[styles.word, { fontSize: size * 0.75 }]}>Starlight</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
    },
    word: {
        fontFamily: 'Caprasimo_400Regular',
        color: colors.text.primary,
        letterSpacing: -0.5,
    },
});
