import { useState, useEffect, useMemo, useRef } from "react";
import {
    View, Text, TouchableOpacity, StyleSheet,
    Modal, TextInput, Platform, TouchableWithoutFeedback, ScrollView, KeyboardAvoidingView,
    NativeSyntheticEvent, NativeScrollEvent,
} from "react-native";
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

type PickerTarget = 'start' | 'end' | null;

// Overflow (px) below this is just row padding / rounding, not a real arrow.
const CHIP_EDGE_SLOP = 6;

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

    // Memoized off the inputs below so any change to states which don't touch them — can't make the chip set flicker or recompute.
    const availableRanges = useMemo(() => {
        if (!wakeTime || !sleepTime) return [];
        return computeGaps({ wakeTime, sleepTime, blocks: existingBlocks }, MIN_GAP_MINUTES, editIndex);
    }, [wakeTime, sleepTime, existingBlocks, editIndex]);

    // The live scroll offset is kept in a ref, never React state, so a finger
    // drag doesn't re-render the modal every frame; only the two arrow-visibility
    // booleans are state, and they flip only when a scroll boundary is crossed.
    const chipScrollRef = useRef<ScrollView>(null);
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

    const leftEdgeStyle = useAnimatedStyle(() => ({ opacity: withTiming(canScrollChipsLeft ? 1 : 0, { duration: 160 }) }));
    const rightEdgeStyle = useAnimatedStyle(() => ({ opacity: withTiming(canScrollChipsRight ? 1 : 0, { duration: 160 }) }));

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
            <TouchableWithoutFeedback onPress={handleClose}>
                <View style={styles.modalOverlay}>
                    <TouchableWithoutFeedback>
                        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalSheet}>
                            <View style={styles.dragIndicator} />
                            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                                {/* Header */}
                                <View style={styles.modalHeader}>
                                    <Text style={styles.modalTitle}>{isEditMode ? 'Edit block' : 'Add a block'}</Text>
                                    <TouchableOpacity onPress={handleClose} hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }} style={styles.modalCloseButton}>
                                        <Text style={styles.modalClose}>×</Text>
                                    </TouchableOpacity>
                                </View>
                                <View style={styles.modalDivider} />

                                {/* Block type */}
                                <View style={styles.modalSection}>
                                    <Text style={styles.modalLabel}>Block type</Text>
                                    <View style={styles.pillRow}>
                                        {BLOCK_TYPES.map((t) => (
                                            <TouchableOpacity
                                                key={t}
                                                style={[styles.pill, type === t && styles.pillActive]}
                                                onPress={() => setType(t)}
                                            >
                                                <Text style={[styles.pillText, type === t && styles.pillTextActive]}>
                                                    {BLOCK_TYPE_LABELS[t]}
                                                </Text>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                    <Text style={styles.typeDescription}>{BLOCK_TYPE_DESCRIPTIONS[type]}</Text>

                                    {/* Type legend */}
                                    <View style={styles.typeLegend}>
                                        {BLOCK_TYPES.map((t) => (
                                            <View key={t} style={styles.legendItem}>
                                                <View style={[styles.legendIcon, t === 'CONTAINER' && styles.legendIconContainer, t === 'ANCHOR' && styles.legendIconAnchor, t === 'NO_TASK' && styles.legendIconNoTask]} />
                                                <View>
                                                    <Text style={styles.legendTitle}>{BLOCK_TYPE_LABELS[t]}</Text>
                                                    <Text style={styles.legendDesc}>{BLOCK_TYPE_DESCRIPTIONS[t]}</Text>
                                                </View>
                                            </View>
                                        ))}
                                    </View>
                                </View>

                                <View style={styles.modalDividerLight} />

                                {/* Block name */}
                                <View style={styles.modalSection}>
                                    <Text style={styles.modalLabel}>Block name</Text>
                                    <TextInput
                                        style={styles.textInput}
                                        value={name}
                                        onChangeText={setName}
                                        placeholder="e.g. Focus time, Deep work, Reading"
                                        placeholderTextColor="rgba(122,115,106,0.4)"
                                    />
                                </View>

                                {/* Start / End time */}
                                <View style={styles.modalSection}>
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

                                    {/* Available times */}
                                    {availableRanges.length > 0 && (
                                        <View style={styles.availableSection}>
                                            <Text style={styles.modalLabel}>Available times</Text>
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
                                                        <Feather name="chevron-left" size={20} color="#7a736a" />
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
                                                        <Feather name="chevron-right" size={20} color="#7a736a" />
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
                                        <View style={styles.pillRow}>
                                            {ENERGY_LEVELS.map((e) => (
                                                <TouchableOpacity
                                                    key={e}
                                                    style={[styles.pill, energyLevel === e && styles.pillActive]}
                                                    onPress={() => setEnergyLevel(e)}
                                                >
                                                    <Text style={[styles.pillText, energyLevel === e && styles.pillTextActive]}>
                                                        {ENERGY_LABELS[e]}
                                                    </Text>
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    </View>
                                )}

                                <TouchableOpacity style={styles.addButton} onPress={handleSubmit} activeOpacity={0.8}>
                                    <Text style={styles.addButtonText}>{isEditMode ? saveLabel : 'Add Block'}</Text>
                                </TouchableOpacity>

                                {error && <Text style={styles.errorText}>{error}</Text>}

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

                                <View style={{ height: 32 }} />
                            </ScrollView>

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
                        </KeyboardAvoidingView>
                    </TouchableWithoutFeedback>
                </View>
            </TouchableWithoutFeedback>
        </Modal>
    );
}

const styles = StyleSheet.create({
    errorText: { fontSize: 13, color: '#c0392b', textAlign: 'center', marginTop: 10, marginHorizontal: 24 },

    modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.3)' },
    modalSheet: { backgroundColor: '#fdfcfa', borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '94%' },
    dragIndicator: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(42,38,33,0.15)', alignSelf: 'center', marginTop: 10, marginBottom: 2 },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16 },
    modalTitle: { fontSize: 18, fontWeight: '500', color: '#2a2621' },
    modalCloseButton: { position: 'absolute', right: 24 },
    modalClose: { fontSize: 22, color: '#7a736a' },
    modalDivider: { height: 1, backgroundColor: 'rgba(42,38,33,0.10)' },
    modalDividerLight: { height: 1, backgroundColor: 'rgba(42,38,33,0.10)', marginHorizontal: 24 },
    modalSection: { paddingHorizontal: 24, paddingVertical: 20, gap: 12 },
    modalLabel: { fontSize: 14, fontWeight: '500', color: '#7a736a', letterSpacing: -0.15 },

    pillRow: { flexDirection: 'row', gap: 8 },
    pill: { flex: 1, height: 40, borderRadius: 12, backgroundColor: 'rgba(232,228,221,0.35)', justifyContent: 'center', alignItems: 'center' },
    pillActive: { backgroundColor: 'rgba(212,165,116,0.15)', borderWidth: 1.5, borderColor: '#d4a574' },
    pillText: { fontSize: 13, fontWeight: '500', color: '#7a736a' },
    pillTextActive: { color: '#d4a574' },

    typeDescription: { fontSize: 13, color: 'rgba(122,115,106,0.75)' },

    typeLegend: { gap: 16, marginTop: 4 },
    legendItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    legendIcon: { width: 12, height: 12, borderRadius: 3, marginTop: 2 },
    legendIconContainer: { borderWidth: 1, borderColor: 'rgba(42,38,33,0.15)', borderStyle: 'dashed' },
    legendIconAnchor: { backgroundColor: 'rgba(232,228,221,0.85)' },
    legendIconNoTask: { backgroundColor: 'rgba(232,228,221,0.4)', borderWidth: 1, borderColor: 'rgba(42,38,33,0.15)', borderStyle: 'dashed' },
    legendTitle: { fontSize: 13, fontWeight: '500', color: '#2a2621' },
    legendDesc: { fontSize: 11, color: 'rgba(122,115,106,0.8)', marginTop: 1 },

    textInput: { height: 52, backgroundColor: '#fffef9', borderWidth: 1, borderColor: 'rgba(42,38,33,0.10)', borderRadius: 14, paddingHorizontal: 16, fontSize: 15, color: '#2a2621' },

    timeRow: { flexDirection: 'row', gap: 12 },
    timeField: { flex: 1, gap: 12 },
    timeInput: { height: 52, backgroundColor: '#fffef9', borderWidth: 1, borderColor: 'rgba(42,38,33,0.10)', borderRadius: 14, justifyContent: 'center', paddingHorizontal: 16 },
    timeInputValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
    timeInputValue: { fontSize: 15, fontWeight: '500', color: '#2a2621', fontVariant: ['tabular-nums'] },
    timeInputPeriod: { fontSize: 11, fontWeight: '500', color: '#d4a574' },
    timeInputPlaceholder: { fontSize: 15, color: 'rgba(122,115,106,0.35)' },

    availableSection: { gap: 12, marginTop: 16 },
    chipStrip: { flexDirection: 'row', alignItems: 'center' },
    chipScroll: { flex: 1 },
    chipRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 2 },
    chipGutter: { width: 30, alignSelf: 'stretch' },
    chipChevron: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    chip: { height: 36, borderRadius: 12, backgroundColor: 'rgba(232,228,221,0.35)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14 },
    chipActive: { backgroundColor: 'rgba(212,165,116,0.15)', borderWidth: 1.5, borderColor: '#d4a574' },
    chipText: { fontSize: 13, fontWeight: '500', color: '#7a736a', fontVariant: ['tabular-nums'] },
    chipTextActive: { color: '#d4a574' },

    energySubtitle: { fontSize: 12, color: 'rgba(122,115,106,0.6)', marginTop: -4 },

    addButton: { marginHorizontal: 24, height: 52, backgroundColor: '#d4a574', borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
    addButtonText: { fontSize: 16, fontWeight: '500', color: '#2a2621', letterSpacing: -0.31 },
    deleteButton: { marginHorizontal: 24, height: 48, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
    deleteButtonText: { fontSize: 15, fontWeight: '500', color: '#c0392b', letterSpacing: -0.23 },

    pickerOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.3)' },
    pickerSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40 },
    pickerHeader: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 4 },
    pickerDoneText: { fontSize: 16, fontWeight: '600', color: '#d4a574' },
});
