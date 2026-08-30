import { type ReactNode } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from "react-native-reanimated";

// A critically-damped spring (dampingRatio 1 → no bounce) so the press settles
// crisply without overshoot, matching the editor's other no-bounce motion.
const PRESS_SPRING = { duration: 220, dampingRatio: 1 };

/**
 * A pressable that dips to `scale(0.96)` on press for tactile feedback, then
 * springs back — bounce-free. Reusable tap primitive for primary controls.
 *
 * Pass `static` to opt out of the scale (still a normal pressable) where the
 * motion would distract; the visual styling and press handling are unchanged.
 */
export function PressableScale({
    children,
    onPress,
    disabled,
    style,
    containerStyle,
    hitSlop,
    activeScale = 0.96,
    static: isStatic = false,
}: {
    children: ReactNode;
    onPress?: () => void;
    disabled?: boolean;
    style?: StyleProp<ViewStyle>;
    // Applied to the outer Pressable — pass layout (e.g. flex) here, since `style` lands on
    // an inner view that can't stretch its content-sized parent on its own.
    containerStyle?: StyleProp<ViewStyle>;
    hitSlop?: PressableProps['hitSlop'];
    activeScale?: number;
    static?: boolean;
}) {
    const scale = useSharedValue(1);
    const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

    const animate = (to: number) => {
        scale.value = withSpring(to, PRESS_SPRING);
    };

    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            hitSlop={hitSlop}
            style={containerStyle}
            onPressIn={isStatic ? undefined : () => animate(activeScale)}
            onPressOut={isStatic ? undefined : () => animate(1)}
        >
            <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
        </Pressable>
    );
}
