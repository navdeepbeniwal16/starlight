import { type ReactNode } from "react";
import { type StyleProp, type ViewStyle } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";

/**
 * Standard scroll container for screens with text inputs: keeps the focused field
 * and the submit button above the keyboard, and dismisses on drag. Pairs with the
 * app-level KeyboardToolbar (in app/_layout.tsx) for an explicit Done affordance.
 */
export function KeyboardScreen({
    children,
    style,
    contentContainerStyle,
}: {
    children: ReactNode;
    style?: StyleProp<ViewStyle>;
    contentContainerStyle?: StyleProp<ViewStyle>;
}) {
    return (
        <KeyboardAwareScrollView
            style={style}
            contentContainerStyle={contentContainerStyle}
            bottomOffset={76}
            mode="insets"
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
        >
            {children}
        </KeyboardAwareScrollView>
    );
}
