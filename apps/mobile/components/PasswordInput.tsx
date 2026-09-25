import { forwardRef, useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../lib/theme';

// A password field with a show/hide toggle, shared by login and signup so the two
// stay identical. Takes the caller's input `style` (the screens' shared field
// look) and only adds the room + control for the eye, so there's no second copy
// of the input styling to drift.
export const PasswordInput = forwardRef<TextInput, TextInputProps>(({ style, ...props }, ref) => {
    const [visible, setVisible] = useState(false);

    return (
        <View style={styles.wrap}>
            <TextInput
                ref={ref}
                {...props}
                style={[style, styles.roomForToggle]}
                secureTextEntry={!visible}
                placeholderTextColor={colors.text.muted}
            />
            <TouchableOpacity
                style={styles.toggle}
                onPress={() => setVisible((v) => !v)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={visible ? 'Hide password' : 'Show password'}
            >
                <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.text.secondary} />
            </TouchableOpacity>
        </View>
    );
});

PasswordInput.displayName = 'PasswordInput';

const styles = StyleSheet.create({
    wrap: {
        justifyContent: 'center',
    },
    roomForToggle: {
        paddingRight: 48,
    },
    toggle: {
        position: 'absolute',
        right: 10,
        padding: 6,
    },
});
