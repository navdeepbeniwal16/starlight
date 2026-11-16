import { Modal, Pressable, View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { radius, spacing } from "../lib/theme";
import { PressableScale } from "./PressableScale";

type Chip = { label: string; icon: keyof typeof Ionicons.glyphMap };

// The one authoritative explainer for the two block types. Shown once per user on the
// first build screen (as a gate) and re-openable from the legend's info button. Monotone
// white-on-dark so it reads as a layer over the dimmed day behind it.
export function BlockTypesIntroOverlay({
    visible,
    dismissible,
    onClose,
}: {
    visible: boolean;
    // First-run gate (false) allows dismissal only via "Got it"; a reopen (true) also
    // lets a backdrop tap close it, since it's a lookup and not a gate.
    dismissible: boolean;
    onClose: () => void;
}) {
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={dismissible ? onClose : undefined} statusBarTranslucent>
            <Pressable style={s.backdrop} onPress={dismissible ? onClose : undefined}>
                {/* Content sits on its own solid panel so no canvas text bleeds through the copy. */}
                <Animated.View entering={FadeInDown.duration(250)} style={s.card} onStartShouldSetResponder={() => true}>
                    <View style={s.noteHeader}>
                        <Ionicons name="create-outline" size={16} color={WHITE} />
                        <Text style={s.noteLabel}>Quick note</Text>
                    </View>
                    <Text style={s.framing}>Your day template is built from two kinds of time.</Text>

                    <BlockType
                        dashed
                        label="Task Time"
                        description="Time you reserve for getting stuff done. You or Starlight drop your tasks in here, so work only happens when you've made room for it."
                        chips={[
                            { label: "Morning Focus", icon: "sunny-outline" },
                            { label: "Admin", icon: "document-text-outline" },
                            { label: "Deep Work", icon: "headset-outline" },
                        ]}
                    />

                    <BlockType
                        label="Events"
                        description="The fixed bits of your day that don't need to be a task on your list, like lunch or the gym. They stay put, and no tasks go in them."
                        chips={[
                            { label: "Lunch", icon: "restaurant-outline" },
                            { label: "Workout", icon: "barbell-outline" },
                            { label: "Call with Mum", icon: "call-outline" },
                        ]}
                    />

                    <PressableScale style={s.button} onPress={onClose} accessibilityRole="button">
                        <Text style={s.buttonText}>Got it</Text>
                    </PressableScale>
                </Animated.View>
            </Pressable>
        </Modal>
    );
}

function BlockType({
    label,
    description,
    chips,
    dashed = false,
}: {
    label: string;
    description: string;
    chips: Chip[];
    // Dashed outline block = Task Time (open); solid block = Events (fixed). Mirrors the legend.
    dashed?: boolean;
}) {
    return (
        <View style={s.type}>
            <View style={s.typeHeader}>
                <View style={[s.blockIcon, dashed ? s.blockIconDashed : s.blockIconSolid]} />
                <Text style={s.typeLabel}>{label}</Text>
            </View>
            <Text style={s.typeDescription}>{description}</Text>
            <View style={s.chips}>
                {chips.map((chip) => (
                    <View key={chip.label} style={s.chip}>
                        <Ionicons name={chip.icon} size={13} color={WHITE_DIM} />
                        <Text style={s.chipText}>{chip.label}</Text>
                    </View>
                ))}
            </View>
        </View>
    );
}

const WHITE = '#fdfcfa';
const WHITE_DIM = 'rgba(253,252,250,0.72)';

const s = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(20,17,14,0.92)',
        justifyContent: 'center',
        paddingHorizontal: spacing.xl,
    },
    card: {
        gap: spacing.lg,
        backgroundColor: '#1a1712',
        borderRadius: radius.xl,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: 'rgba(253,252,250,0.14)',
        padding: spacing.xl,
    },

    noteHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    noteLabel: { fontSize: 12, fontWeight: '600', color: WHITE_DIM, letterSpacing: 0.3, textTransform: 'uppercase' },
    framing: { fontSize: 19, fontWeight: '600', color: WHITE, letterSpacing: -0.3, lineHeight: 25, marginBottom: spacing.xs },

    type: { gap: spacing.sm },
    typeHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    blockIcon: { width: 22, height: 15, borderRadius: 4 },
    blockIconDashed: { borderWidth: 1.5, borderColor: WHITE, borderStyle: 'dashed' },
    blockIconSolid: { backgroundColor: WHITE },
    typeLabel: { fontSize: 16, fontWeight: '600', color: WHITE, letterSpacing: -0.2 },
    typeDescription: { fontSize: 14, color: WHITE_DIM, lineHeight: 21, letterSpacing: -0.1 },

    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: 2 },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        backgroundColor: 'rgba(253,252,250,0.12)',
        borderRadius: radius.pill,
        paddingVertical: 5,
        paddingLeft: 9,
        paddingRight: 12,
    },
    chipText: { fontSize: 12.5, color: WHITE, letterSpacing: -0.1 },

    button: {
        height: 52,
        backgroundColor: WHITE,
        borderRadius: radius.md,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: spacing.sm,
    },
    buttonText: { fontSize: 15, fontWeight: '600', color: '#2a2621', letterSpacing: -0.1 },
});
