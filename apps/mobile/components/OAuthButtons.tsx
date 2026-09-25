import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSSO } from '@clerk/expo/experimental';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { runClerkOAuthFlow } from '../lib/clerkOAuth';
import { colors, radius, spacing } from '../lib/theme';

// Dismisses the OAuth web session once Clerk redirects back to the app; required
// for `openAuthSessionAsync` to resolve. Safe to call at module scope.
WebBrowser.maybeCompleteAuthSession();

// Where Clerk sends the browser after the provider authenticates. Passed
// explicitly (rather than leaning on useSSO's internal default) so the exact URL
// is visible here: it MUST be whitelisted in the Clerk Dashboard's allowed
// redirect URLs, or the callback drops the rotating_token_nonce and the flow
// fails. Resolves to `starlight://sso-callback` in a dev/standalone build (the
// app scheme is `starlight`); browser SSO does not run in Expo Go.
const redirectUrl = AuthSession.makeRedirectUri({ path: 'sso-callback' });

// The dev instance disables email verification, so a first-time social sign-in
// completes and JIT-provisions the local user just like password sign-up.
type OAuthStrategy = 'oauth_google' | 'oauth_apple';

const PROVIDERS: { strategy: OAuthStrategy; label: string; icon: 'logo-google' | 'logo-apple' }[] = [
    { strategy: 'oauth_google', label: 'Continue with Google', icon: 'logo-google' },
    { strategy: 'oauth_apple', label: 'Continue with Apple', icon: 'logo-apple' },
];

export function OAuthButtons({ onError }: { onError: (message: string | null) => void }) {
    const { startSSOFlow } = useSSO();
    const [pending, setPending] = useState<OAuthStrategy | null>(null);

    // Pre-warming the browser on Android removes the cold-start delay when the
    // OAuth session opens; a no-op elsewhere. Cool down on unmount to release it.
    useEffect(() => {
        if (Platform.OS !== 'android') return;
        void WebBrowser.warmUpAsync();
        return () => {
            void WebBrowser.coolDownAsync();
        };
    }, []);

    async function handlePress(strategy: OAuthStrategy) {
        onError(null);
        setPending(strategy);
        try {
            const message = await runClerkOAuthFlow(() => startSSOFlow({ strategy, redirectUrl }));
            if (message) onError(message);
        } finally {
            setPending(null);
        }
    }

    // Social-first: the provider buttons lead, and the divider sits below them to
    // separate social sign-in from the email form the screen renders next.
    return (
        <View style={styles.container}>
            {PROVIDERS.map(({ strategy, label, icon }) => (
                <TouchableOpacity
                    key={strategy}
                    style={[styles.button, pending !== null && styles.buttonDisabled]}
                    onPress={() => handlePress(strategy)}
                    disabled={pending !== null}
                >
                    <Ionicons name={icon} size={18} color={colors.text.primary} />
                    <Text style={styles.buttonText}>{label}</Text>
                </TouchableOpacity>
            ))}

            <View style={styles.dividerRow}>
                <View style={styles.divider} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.divider} />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        gap: spacing.md,
    },
    dividerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
    },
    divider: {
        flex: 1,
        height: 1,
        backgroundColor: colors.border.hairline,
    },
    dividerText: {
        fontSize: 13,
        color: colors.text.secondary,
    },
    button: {
        height: 48,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: spacing.sm,
        backgroundColor: colors.surface.raised,
        borderWidth: 1,
        borderColor: colors.border.hairline,
        borderRadius: radius.md,
    },
    buttonDisabled: {
        opacity: 0.6,
    },
    buttonText: {
        fontSize: 15,
        fontWeight: '600',
        color: colors.text.primary,
        letterSpacing: -0.1,
    },
});
