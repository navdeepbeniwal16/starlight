// Single source for the app's visual primitives. This palette already existed inline
// across ~20 files; centralizing it removes the duplicated literals and lets screens
// stay consistent against one shared reference. Most values are the prior literals
// verbatim; the few introduced for the Day Template styling pass are marked below.

export const colors = {
    text: {
        primary: '#2a2621',
        secondary: '#7a736a',
        muted: 'rgba(122,115,106,0.55)',
        // Dark text sits on the accent fill (buttons), not white — the accent is too light for white.
        onAccent: '#2a2621',
    },
    accent: {
        default: '#d4a574',
        tint: 'rgba(212,165,116,0.15)',
        // Legible accent for text on light tints, where `default` washes out (energy badge, labels).
        strong: '#b07841',
    },
    surface: {
        page: '#fdfcfa',
        raised: '#fffef9',
        sunken: 'rgba(232,228,221,0.30)',
        panel: 'rgba(42,38,33,0.025)',
        // Beige fill shared by every timeline block on Today and the template, so
        // the two screens read as one timeline.
        block: 'rgba(232,228,221,0.45)',
    },
    border: {
        hairline: 'rgba(42,38,33,0.10)',
        // Dashed vs solid block borders only read at this weight; the hairline is too faint to tell apart.
        strong: 'rgba(42,38,33,0.22)',
        // Warm, softer edge for the flat beige blocks (anchor / no-task) — the cool `strong`
        // border looks harsh against their warm fill.
        warm: 'rgba(122,115,106,0.22)',
    },
    danger: {
        default: '#c0392b',
        tint: 'rgba(192,57,43,0.06)',
        border: 'rgba(192,57,43,0.55)',
    },
    success: {
        default: '#5e8c6a',
        tint: 'rgba(94,140,106,0.14)',
        strong: '#4a7458',
    },
    scrim: 'rgba(0,0,0,0.3)',
} as const;

export const radius = {
    sm: 12,
    md: 14,
    lg: 16,
    xl: 20,
    xxl: 24,
    pill: 999,
} as const;

export const spacing = {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
} as const;

export const shadow = {
    soft: {
        shadowColor: '#2a2621',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.05,
        shadowRadius: 14,
        elevation: 2,
    },
    // A soft top-lift for the footer — a divider without a hard line.
    footer: {
        shadowColor: '#2a2621',
        shadowOffset: { width: 0, height: -3 },
        shadowOpacity: 0.06,
        shadowRadius: 10,
        elevation: 12,
    },
} as const;

export const typography = {
    title: { fontSize: 24, fontWeight: '600' },
    body: { fontSize: 15 },
    label: { fontSize: 13 },
    caption: { fontSize: 11 },
} as const;
