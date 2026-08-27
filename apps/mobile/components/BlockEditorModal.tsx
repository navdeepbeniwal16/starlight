import { useState, useEffect, useMemo, useRef } from "react";
import {
    View, Text, TouchableOpacity, StyleSheet,
    Modal, TextInput, Platform, TouchableWithoutFeedback, ScrollView,
    NativeSyntheticEvent, NativeScrollEvent,
} from "react-native";
import { KeyboardProvider, KeyboardToolbar, KeyboardAwareScrollView, type KeyboardAwareScrollViewRef } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import Animated, { useAnimatedStyle, withTiming } from "react-native-reanimated";
import { Feather } from "@expo/vector-icons";
import { BlockInput, BlockType, EnergyLevel } from "../lib/api.types";
import { toHHmm, hhMmToDate, parseDisplayTime } from "../lib/time";
import {
    BLOCK_TYPES, ENERGY_LEVELS, BLOCK_TYPE_LABELS, BLOCK_TYPE_DESCRIPTIONS, ENERGY_LABELS,
    validateBlockDraft, blockDraftErrorMessage, toBlockInput,
} from "../lib/templateBlocks";
import { computeGaps, MIN_GAP_MINUTES } from "../lib/templateDraft";
import { colors, radius, spacing, shadow } from "../lib/theme";
import { tf, effortDotColor } from "./TaskFields";

type PickerTarget = 'start' | 'end' | null;

// Overflow (px) below this is just row padding / rounding, not a real arrow.
const CHIP_EDGE_SLOP = 6;

// Arrows stay on-screen even when that direction can't scroll, dimmed to read as disabled.
const DISABLED_ARROW_OPACITY = 0.3;

// Formats a free range like "9:00 – 10:30 AM", showing a shared period once.
function formatRangeLabel(startTime: string, endTime: string): string {
    const start = parseDisplayTime(startTime);
    const end = parseDisplayTime(endTime);
    return start.period === end.period
        ? `${start.time} – ${end.time} ${end.period}`
        : `${start.time} ${start.period} – ${end.time} ${end.period}`;
}

/**
 * Add/edit-a-block bottom sheet. Store-agnostic: the caller supplies the current
 * wake/sleep window, the existing blocks, and add/save/delete callbacks. Shared
 * by onboarding and the post-onboarding template editor.
 */
export function BlockEditorModal({
    visible,
    onClose,
    onAdd,
    existingBlocks,
    editIndex,
    initialValues,
    onSave,
    onDelete,
    wakeTime,
    sleepTime,
    saveLabel = 'Save',
}: {
    visible: boolean;
    onClose: () => void;
    onAdd?: (block: BlockInput) => void;
    existingBlocks: BlockInput[];
    editIndex?: number;
    initialValues?: Partial<BlockInput>;
    onSave?: (block: BlockInput) => void;
    onDelete?: () => void;
    wakeTime: string | null;
    sleepTime: string | null;
    saveLabel?: string;
}) {
    const isEditMode = editIndex !== undefined;
    const insets = useSafeAreaInsets();

    // Memoized off the inputs below so any change to states which don't touch them — can't make the chip set flicker or recompute.
    const availableRanges = useMemo(() => {
        if (!wakeTime || !sleepTime) return [];
        return computeGaps({ wakeTime, sleepTime, blocks: existingBlocks }, MIN_GAP_MINUTES, editIndex);
    }, [wakeTime, sleepTime, existingBlocks, editIndex]);

    // The live scroll offset is kept in a ref, never React state, so a finger
    // drag doesn't re-render the modal every frame; only the two arrow-visibility
    // booleans are state, and they flip only when a scroll boundary is crossed.
    const chipScrollRef = useRef<ScrollView>(null);
    const scrollRef = useRef<KeyboardAwareScrollViewRef>(null);

    const revealFocusedInput = () => {
        scrollRef.current?.assureFocusedInputVisible();
        setTimeout(() => scrollRef.current?.assureFocusedInputVisible(), 300);
    };
    const chipScrollX = useRef(0);
    const [chipContentWidth, setChipContentWidth] = useState(0);
    const [chipViewportWidth, setChipViewportWidth] = useState(0);
    const [canScrollChipsLeft, setCanScrollChipsLeft] = useState(false);
    const [canScrollChipsRight, setCanScrollChipsRight] = useState(false);

    const syncChipEdges = () => {
        const maxScroll = Math.max(0, chipContentWidth - chipViewportWidth);
        setCanScrollChipsLeft(chipScrollX.current > CHIP_EDGE_SLOP);
        setCanScrollChipsRight(chipScrollX.current < maxScroll - CHIP_EDGE_SLOP);
    };

    useEffect(syncChipEdges, [chipContentWidth, chipViewportWidth]);

    const handleChipScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        chipScrollX.current = e.nativeEvent.contentOffset.x;
        syncChipEdges();
    };

    const scrollChips = (direction: 'left' | 'right') => {
        const maxScroll = Math.max(0, chipContentWidth - chipViewportWidth);
        const delta = chipViewportWidth * 0.7;
        const next = direction === 'left'
            ? Math.max(0, chipScrollX.current - delta)
            : Math.min(maxScroll, chipScrollX.current + delta);
        chipScrollRef.current?.scrollTo({ x: next, animated: true });
    };

    const leftEdgeStyle = useAnimatedStyle(() => ({ opacity: withTiming(canScrollChipsLeft ? 1 : DISABLED_ARROW_OPACITY, { duration: 160 }) }));
    const rightEdgeStyle = useAnimatedStyle(() => ({ opacity: withTiming(canScrollChipsRight ? 1 : DISABLED_ARROW_OPACITY, { duration: 160 }) }));

    const [type, setType] = useState<BlockType>('CONTAINER');
    const [name, setName] = useState('');
    const [startTime, setStartTime] = useState<string | null>(null);
    const [endTime, setEndTime] = useState<string | null>(null);
    const [energyLevel, setEnergyLevel] = useState<EnergyLevel>('HIGH');
    const [error, setError] = useState<string | null>(null);
    const [pickerTarget, setPickerTarget] = useState<PickerTarget>(null);
    const [pickerValue, setPickerValue] = useState(new Date());

    useEffect(() => {
        if (visible) {
            setType(initialValues?.type ?? 'CONTAINER');
            setName(initialValues?.name ?? '');
            setStartTime(initialValues?.startTime ?? null);
            setEndTime(initialValues?.endTime ?? null);
            setEnergyLevel(initialValues?.energyLevel ?? 'HIGH');
            setError(null);
            setPickerTarget(null);

            // Sheet stays mounted between opens; rewind the strip's kept offset.
            chipScrollX.current = 0;
            chipScrollRef.current?.scrollTo({ x: 0, animated: false });
            syncChipEdges();
        }
    }, [visible]);

    const reset = () => {
        setType('CONTAINER');
        setName('');
        setStartTime(null);
        setEndTime(null);
        setEnergyLevel('HIGH');
        setError(null);
        setPickerTarget(null);
    };

    const handleClose = () => {
        reset();
        onClose();
    };

    const openPicker = (target: PickerTarget) => {
        const current = target === 'start' ? startTime : endTime;
        setPickerValue(current ? hhMmToDate(current) : new Date());
        setPickerTarget(target);
    };

    const handlePickerChange = (_: any, date?: Date) => {
        if (Platform.OS === 'android') setPickerTarget(null);
        if (date) {
            const value = toHHmm(date);
            if (pickerTarget === 'start') setStartTime(value);
            else if (pickerTarget === 'end') setEndTime(value);
        }
    };

    const handleSubmit = () => {
        const validationError = validateBlockDraft(
            { type, name, startTime, endTime, energyLevel },
            { wakeTime, sleepTime, existingBlocks, excludeIndex: isEditMode ? editIndex : undefined },
        );
        if (validationError) {
            setError(blockDraftErrorMessage(validationError));
            return;
        }
        setError(null);

        // Times are guaranteed present once validation passes.
        const block = toBlockInput({ type, name, startTime: startTime!, endTime: endTime!, energyLevel });

        if (isEditMode) {
            onSave?.(block);
        } else {
            onAdd?.(block);
        }
    };

    return (
        <Modal visible={visible} animationType="slide" transparent>
            <KeyboardProvider>
            <TouchableWithoutFeedback onPress={handleClose}>
                <View style={styles.modalOverlay}>
                    <TouchableWithoutFeedback>
                        <View style={styles.modalSheet}>
                            <View style={styles.dragIndicator} />
                            <KeyboardAwareScrollView ref={scrollRef} style={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" bottomOffset={16} mode="layout">
                                {/* Header */}
                                <View style={styles.modalHeader}>
                                    <Text style={styles.modalTitle}>{isEditMode ? 'Edit block' : 'Add a block'}</Text>
                                    <TouchableOpacity onPress={handleClose} hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }} style={styles.modalCloseButton}>
                                        <Feather name="x" size={20} color={colors.text.primary} />
                                    </TouchableOpacity>
                                </View>
                                <View style={styles.modalDivider} />

                                {/* Block type */}
                                <View style={styles.modalSection}>
                                    <Text style={styles.modalLabel}>Block type</Text>
                                    <View style={styles.pillWrap}>
                                        {BLOCK_TYPES.map((t) => (
                                            <TouchableOpacity
                                                key={t}
                                                style={[tf.pill, styles.blockTypePill, type === t && styles.blockTypePillOn]}
                                                onPress={() => setType(t)}
                                            >
                                                <View style={[styles.blockSwatch, t === 'CONTAINER' ? styles.blockSwatchContainer : styles.blockSwatchAnchor]} />
                                                <Text style={[tf.pillTxt, type === t && styles.blockTypePillTxtOn]}>
                                                    {BLOCK_TYPE_LABELS[t]}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                    <Text style={styles.typeDescription}>{BLOCK_TYPE_DESCRIPTIONS[type]}</Text>
                                </View>

                                <View style={styles.modalDividerLight} />

                                {/* Block name */}
                                <View style={styles.modalSection}>
                                    <Text style={styles.modalLabel}>Block name</Text>
                                    <TextInput
                                        style={styles.textInput}
                                        value={name}
                                        onChangeText={setName}
                                        onFocus={revealFocusedInput}
                                        placeholder="e.g. Focus time, Deep work, Reading"
                                        placeholderTextColor="rgba(122,115,106,0.4)"
                                    />
                                </View>

                                {/* Start / End time */}
                                <View style={[styles.modalSection, styles.timeSection]}>
                                    <View style={styles.timeRow}>
                                        <View style={styles.timeField}>
                                            <Text style={styles.modalLabel}>Start time</Text>
                                            <TouchableOpacity style={styles.timeInput} onPress={() => openPicker('start')}>
                                                {startTime ? (
                                                    <View style={styles.timeInputValueRow}>
                                                        <Text style={styles.timeInputValue}>{parseDisplayTime(startTime).time}</Text>
                                                        <Text style={styles.timeInputPeriod}>{parseDisplayTime(startTime).period}</Text>
                                                    </View>
                                                ) : (
                                                    <Text style={styles.timeInputPlaceholder}>--:--</Text>
                                                )}
                                            </TouchableOpacity>
                                        </View>
                                        <View style={styles.timeField}>
                                            <Text style={styles.modalLabel}>End time</Text>
                                            <TouchableOpacity style={styles.timeInput} onPress={() => openPicker('end')}>
                                                {endTime ? (
                                                    <View style={styles.timeInputValueRow}>
                                                        <Text style={styles.timeInputValue}>{parseDisplayTime(endTime).time}</Text>
                                                        <Text style={styles.timeInputPeriod}>{parseDisplayTime(endTime).period}</Text>
                                                    </View>
                                                ) : (
                                                    <Text style={styles.timeInputPlaceholder}>--:--</Text>
                                                )}
                                            </TouchableOpacity>
                                        </View>
                                    </View>

                                    {availableRanges.length > 0 && (
                                        <View style={styles.availableSection}>
                                            <Text style={styles.availableHint}>Tap a free slot to fill</Text>
                                            <View style={styles.chipStrip}>
                                                <Animated.View
                                                    style={[styles.chipGutter, leftEdgeStyle]}
                                                    pointerEvents={canScrollChipsLeft ? 'auto' : 'none'}
                                                >
                                                    <TouchableOpacity
                                                        onPress={() => scrollChips('left')}
                                                        activeOpacity={0.5}
                                                        hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                                                        style={styles.chipChevron}
                                                    >
                                                        <Feather name="chevron-left" size={20} color={colors.text.secondary} />
                                                    </TouchableOpacity>
                                                </Animated.View>

                                                <ScrollView
                                                    ref={chipScrollRef}
                                                    style={styles.chipScroll}
                                                    horizontal
                                                    showsHorizontalScrollIndicator={false}
                                                    keyboardShouldPersistTaps="handled"
                                                    scrollEventThrottle={16}
                                                    onScroll={handleChipScroll}
                                                    onLayout={(e) => setChipViewportWidth(e.nativeEvent.layout.width)}
                                                    onContentSizeChange={(w) => setChipContentWidth(w)}
                                                    contentContainerStyle={styles.chipRow}
                                                >
                                                    {availableRanges.map((range) => {
                                                        const active = startTime === range.startTime && endTime === range.endTime;
                                                        return (
                                                            <TouchableOpacity
                                                                key={`${range.startTime}-${range.endTime}`}
                                                                style={[styles.chip, active && styles.chipActive]}
                                                                onPress={() => {
                                                                    setStartTime(range.startTime);
                                                                    setEndTime(range.endTime);
                                                                }}
                                                                activeOpacity={0.8}
                                                            >
                                                                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                                                                    {formatRangeLabel(range.startTime, range.endTime)}
                                                                </Text>
                                                            </TouchableOpacity>
                                                        );
                                                    })}
                                                </ScrollView>

                                                <Animated.View
                                                    style={[styles.chipGutter, rightEdgeStyle]}
                                                    pointerEvents={canScrollChipsRight ? 'auto' : 'none'}
                                                >
                                                    <TouchableOpacity
                                                        onPress={() => scrollChips('right')}
                                                        activeOpacity={0.5}
                                                        hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                                                        style={styles.chipChevron}
                                                    >
                                                        <Feather name="chevron-right" size={20} color={colors.text.secondary} />
                                                    </TouchableOpacity>
                                                </Animated.View>
                                            </View>
                                        </View>
                                    )}
                                </View>

                                <View style={styles.modalDividerLight} />

                                {/* Energy level (Container only) */}
                                {type === 'CONTAINER' && (
                                    <View style={styles.modalSection}>
                                        <Text style={styles.modalLabel}>Energy level</Text>
                                        <Text style={styles.energySubtitle}>Starlight uses this to match tasks to your capacity.</Text>
                                        <View style={styles.pillWrap}>
                                            {ENERGY_LEVELS.map((e) => (
                                                <TouchableOpacity
                                                    key={e}
                                                    style={[tf.pill, energyLevel === e && tf.pillOn]}
                                                    onPress={() => setEnergyLevel(e)}
                                                >
                                                    <View style={[tf.dot, { backgroundColor: effortDotColor(e) }]} />
                                                    <Text style={[tf.pillTxt, energyLevel === e && tf.pillTxtOn]}>
                                                        {ENERGY_LABELS[e]}
                                                    </Text>
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    </View>
                                )}

                            </KeyboardAwareScrollView>

                            {/* Pinned footer: keeps the actions in a fixed spot instead of shifting with the Energy section, which only shows for containers. */}
                            <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
                                {error && <Text style={styles.errorText}>{error}</Text>}
                                <TouchableOpacity style={styles.addButton} onPress={handleSubmit} activeOpacity={0.8}>
                                    <Text style={styles.addButtonText}>{isEditMode ? saveLabel : 'Add Block'}</Text>
                                </TouchableOpacity>
                                {isEditMode && onDelete && (
                                    <TouchableOpacity
                                        style={styles.deleteButton}
                                        onPress={() => {
                                            onDelete();
                                            handleClose();
                                        }}
                                        activeOpacity={0.8}
                                    >
                                        <Text style={styles.deleteButtonText}>Delete block</Text>
                                    </TouchableOpacity>
                                )}
                            </View>

                            {/* Time picker — iOS nested modal */}
                            {Platform.OS === 'ios' && pickerTarget && (
                                <Modal transparent animationType="slide">
                                    <TouchableWithoutFeedback onPress={() => setPickerTarget(null)}>
                                        <View style={styles.pickerOverlay}>
                                            <TouchableWithoutFeedback>
                                                <View style={styles.pickerSheet}>
                                                    <View style={styles.pickerHeader}>
                                                        <TouchableOpacity onPress={() => setPickerTarget(null)} hitSlop={16}>
                                                            <Text style={styles.pickerDoneText}>Done</Text>
                                                        </TouchableOpacity>
                                                    </View>
                                                    <DateTimePicker
                                                        value={pickerValue}
                                                        mode="time"
                                                        display="spinner"
                                                        onChange={handlePickerChange}
                                                        style={{ width: '100%' }}
                                                    />
                                                </View>
                                            </TouchableWithoutFeedback>
                                        </View>
                                    </TouchableWithoutFeedback>
                                </Modal>
                            )}
                            {Platform.OS === 'android' && pickerTarget && (
                                <DateTimePicker
                                    value={pickerValue}
                                    mode="time"
                                    display="default"
                                    onChange={handlePickerChange}
                                />
                            )}
                        </View>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
            <KeyboardToolbar />
            </KeyboardProvider>
        </Modal>
    );
}

const styles = StyleSheet.create({
    errorText: { fontSize: 13, color: colors.danger.default, textAlign: 'center', marginBottom: spacing.sm },

    modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim },
    modalSheet: { backgroundColor: colors.surface.page, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, height: '94%' },
    scroll: { flex: 1 },
    dragIndicator: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border.strong, alignSelf: 'center', marginTop: 10, marginBottom: 2 },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16 },
    modalTitle: { fontSize: 18, fontWeight: '600', color: colors.text.primary, letterSpacing: -0.3 },
    modalCloseButton: { position: 'absolute', right: 24 },
    modalDivider: { height: 1, backgroundColor: colors.border.hairline },
    modalDividerLight: { height: 1, backgroundColor: colors.border.hairline, marginHorizontal: 24 },
    modalSection: { paddingHorizontal: 24, paddingVertical: 16, gap: spacing.md },
    timeSection: { paddingTop: spacing.xs },
    modalLabel: { fontSize: 14, fontWeight: '500', color: colors.text.secondary, letterSpacing: -0.15 },

    pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    // Transparent border on every block-type pill so selecting one doesn't shift the row by the active border's width.
    blockTypePill: { borderWidth: 1.5, borderColor: 'transparent' },
    blockTypePillOn: { backgroundColor: colors.accent.tint, borderColor: colors.accent.default },
    blockTypePillTxtOn: { color: colors.accent.strong },

    // Swatches mirror the day-template legend so the toggle previews how each block type reads on the timeline.
    blockSwatch: { width: 12, height: 12, borderRadius: 3, backgroundColor: colors.surface.block },
    blockSwatchContainer: { borderWidth: 1, borderColor: 'rgba(42,38,33,0.16)', borderStyle: 'dashed' },
    blockSwatchAnchor: { borderWidth: 1, borderColor: colors.border.hairline },

    typeDescription: { fontSize: 13, color: 'rgba(122,115,106,0.75)' },

    textInput: { height: 46, backgroundColor: colors.surface.raised, borderWidth: 1, borderColor: colors.border.hairline, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 15, color: colors.text.primary },

    timeRow: { flexDirection: 'row', gap: spacing.md },
    timeField: { flex: 1, gap: spacing.md },
    timeInput: { height: 46, backgroundColor: colors.surface.raised, borderWidth: 1, borderColor: colors.border.hairline, borderRadius: radius.md, justifyContent: 'center', paddingHorizontal: 14 },
    timeInputValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
    timeInputValue: { fontSize: 15, fontWeight: '500', color: colors.text.primary, fontVariant: ['tabular-nums'] },
    timeInputPeriod: { fontSize: 11, fontWeight: '500', color: colors.accent.default },
    timeInputPlaceholder: { fontSize: 15, color: 'rgba(122,115,106,0.35)' },

    availableSection: { gap: spacing.sm, marginTop: spacing.xs },
    availableHint: { fontSize: 12, color: colors.text.muted },
    chipStrip: { flexDirection: 'row', alignItems: 'center' },
    chipScroll: { flex: 1 },
    chipRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingHorizontal: 2 },
    chipGutter: { width: 30, alignSelf: 'stretch' },
    chipChevron: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    chip: { height: 30, borderRadius: radius.pill, backgroundColor: colors.surface.sunken, borderWidth: 1, borderColor: 'transparent', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12 },
    chipActive: { backgroundColor: colors.accent.tint, borderColor: colors.accent.default },
    chipText: { fontSize: 12, fontWeight: '500', color: colors.text.secondary, fontVariant: ['tabular-nums'] },
    chipTextActive: { color: colors.accent.strong },

    energySubtitle: { fontSize: 12, color: 'rgba(122,115,106,0.6)', marginTop: -4 },

    footer: { paddingHorizontal: 24, paddingTop: spacing.md, backgroundColor: colors.surface.page, ...shadow.footer },
    addButton: { height: 48, backgroundColor: colors.text.primary, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center' },
    addButtonText: { fontSize: 15, fontWeight: '500', color: colors.surface.page, letterSpacing: -0.1 },
    deleteButton: { height: 48, borderRadius: radius.lg, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
    deleteButtonText: { fontSize: 15, fontWeight: '500', color: colors.danger.default, letterSpacing: -0.23 },

    pickerOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim },
    pickerSheet: { backgroundColor: '#fff', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: 40 },
    pickerHeader: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 24, paddingTop: 20, paddingBottom: spacing.xs },
    pickerDoneText: { fontSize: 16, fontWeight: '600', color: colors.accent.default },
});
