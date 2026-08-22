import { useId } from 'react';
import Svg, { Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';

import { colors } from '../lib/theme';

// The Starlight mark, translated from the Claude Design source. One mark, three forms:
//   full        — peak + beam + star; for the icon, splash, and marketing.
//   simplified  — beam + star (peak dropped); holds up below ~40px where the peak muddies.
//   glyph       — the bare sparkle; for buttons and inline use.
// `tone` flips the peak/star for the surface behind it: 'dark' on light UI, 'light' on dark.
type LogoVariant = 'full' | 'simplified' | 'glyph';
type LogoTone = 'dark' | 'light';

interface LogoProps {
    variant?: LogoVariant;
    size?: number;
    tone?: LogoTone;
}

export const STAR = 'M50 6C53.5 31 69 46.5 94 50C69 53.5 53.5 69 50 94C46.5 69 31 53.5 6 50C31 46.5 46.5 31 50 6Z';
const PEAK = 'M46.5 27L13 75Q50 46 87 75L53.5 27Z';
const BEAM = 'M10 78C10 78 25 58 50 58C75 58 90 78 90 78';

// Peak fills are mark-specific, not app tokens, so they live with the mark.
const PEAK_GRADIENT = {
    dark: ['#7A6444', '#332C24'],
    light: ['#DCBE93', '#F4E8D6'],
} as const;

export function Logo({ variant = 'full', size = 40, tone = 'dark' }: LogoProps) {
    const starFill = tone === 'dark' ? colors.surface.raised : colors.text.primary;

    if (variant === 'glyph') {
        const glyphFill = tone === 'dark' ? colors.text.primary : colors.surface.raised;
        return (
            <Svg width={size} height={size} viewBox="0 0 100 100">
                <Path d={STAR} fill={glyphFill} />
            </Svg>
        );
    }

    if (variant === 'simplified') {
        return (
            <Svg width={size} height={size} viewBox="0 0 100 100">
                <Path d={BEAM} fill="none" stroke={colors.accent.default} strokeWidth={11} strokeLinecap="round" />
                <G transform="translate(28,-4) scale(0.44)">
                    <Path d={STAR} fill={tone === 'dark' ? colors.text.primary : colors.surface.raised} />
                </G>
            </Svg>
        );
    }

    // Unique per instance so multiple full logos on one screen don't share a gradient def.
    const gradientId = `starlight-peak-${useId()}`;
    const [from, to] = PEAK_GRADIENT[tone];
    return (
        <Svg width={size} height={size} viewBox="0 0 100 100">
            <Defs>
                <LinearGradient id={gradientId} x1="50" y1="26" x2="50" y2="74" gradientUnits="userSpaceOnUse">
                    <Stop offset="0" stopColor={from} />
                    <Stop offset="1" stopColor={to} />
                </LinearGradient>
            </Defs>
            <Path d={PEAK} fill={`url(#${gradientId})`} stroke={`url(#${gradientId})`} strokeWidth={3} strokeLinejoin="round" />
            <Path d={BEAM} fill="none" stroke={colors.accent.default} strokeWidth={9} strokeLinecap="round" />
            <G transform="translate(29,-2) scale(0.42)">
                <Path d={STAR} fill={starFill} />
            </G>
        </Svg>
    );
}
