import { useState, useEffect } from "react";
import {
    View, Text, TouchableOpacity, StyleSheet,
    Modal, TextInput, Platform, TouchableWithoutFeedback, ScrollView, KeyboardAvoidingView
} from "react-native";
import { useRouter } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { useOnboardingStore } from "../../stores/onboarding.store";
import { BlockInput, BlockType, EnergyLevel } from "../../lib/api.types";
import { toMins, toHHmm, hhMmToDate, parseDisplayTime } from "../../lib/time";
import { ProgressBar } from "../../components/ProgressBar";

const DEFAULT_BLOCKS: BlockInput[] = [
    { type: 'CONTAINER', name: 'Deep Work', startTime: '09:00', endTime: '12:00', energyLevel: 'HIGH' },
    { type: 'ANCHOR', name: 'Lunch', startTime: '12:00', endTime: '13:00' },
    { type: 'NO_TASK', name: 'Evening Wind Down', startTime: '20:00', endTime: '22:00' },
];

const BLOCK_TYPE_DESCRIPTIONS: Record<BlockType, string> = {
    CONTAINER: 'Time for tasks you want Starlight to schedule',
    ANCHOR: 'Fixed activities like meals or gym',
    NO_TASK: "Free time — the agent won't plan anything here",
};

const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
    CONTAINER: 'Container',
    ANCHOR: 'Anchor',
    NO_TASK: 'No-Task',
};

const ENERGY_LABELS: Record<EnergyLevel, string> = {
    HIGH: 'High',
    MEDIUM: 'Medium',
    LOW: 'Low',
};

function hasOverlapWith(newBlock: { startTime: string; endTime: string }, existing: BlockInput[], excludeIndex?: number): boolean {
    return existing.some((b, i) => {
        if (i === excludeIndex) return false;
        return toMins(newBlock.startTime) < toMins(b.endTime) && toMins(newBlock.endTime) > toMins(b.startTime);
    });
}

function BlockItem({ block, onPress }: { block: BlockInput; onPress: () => void }) {
    const isContainer = block.type === 'CONTAINER';
    const isAnchor = block.type === 'ANCHOR';

    return (
        <TouchableOpacity
            activeOpacity={0.75}
            onPress={onPress}
            style={[
                styles.blockItem,
                isContainer && styles.blockItemContainer,
                isAnchor && styles.blockItemAnchor,
                !isContainer && !isAnchor && styles.blockItemNoTask,
            ]}
        >
            <View style={styles.blockItemInner}>
                <View style={styles.blockItemContent}>
                    <View style={styles.blockItemHeader}>
                        <Text style={styles.blockItemName}>{block.name}</Text>
                        {isContainer && block.energyLevel && (
                            <View style={styles.energyBadge}>
                                <Text style={styles.energyBadgeText}>
                                    {ENERGY_LABELS[block.energyLevel]} energy
                                </Text>
                            </View>
                        )}
                    </View>
                    <Text style={styles.blockItemTime}>
                        {parseDisplayTime(block.startTime).time} {parseDisplayTime(block.startTime).period} – {parseDisplayTime(block.endTime).time} {parseDisplayTime(block.endTime).period}
                    </Text>
                </View>
                <Text style={styles.blockItemChevron}>›</Text>
            </View>
        </TouchableOpacity>
    );
}

type PickerTarget = 'start' | 'end' | null;

function AddBlockModal({
    visible,
    onClose,
    onAdd,
    existingBlocks,
    editIndex,
    initialValues,
    onSave,
    onDelete,
}: {
    visible: boolean;
    onClose: () => void;
    onAdd?: (block: BlockInput) => void;
    existingBlocks: BlockInput[];
    editIndex?: number;
    initialValues?: BlockInput;
    onSave?: (block: BlockInput) => void;
    onDelete?: () => void;
}) {
    const isEditMode = editIndex !== undefined;
    const { wakeTime, sleepTime } = useOnboardingStore();

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
        setError(null);

        if (!name.trim()) {
            setError('Block name is required');
            return;
        }
        if (!startTime || !endTime) {
            setError('Start and end time are required');
            return;
        }
        if (toMins(startTime) >= toMins(endTime)) {
            setError('End time must be after start time');
            return;
        }
        if (wakeTime && toMins(startTime) < toMins(wakeTime)) {
            setError(`Block must start at or after your wake time (${parseDisplayTime(wakeTime).time} ${parseDisplayTime(wakeTime).period})`);
            return;
        }
        if (sleepTime && toMins(endTime) > toMins(sleepTime)) {
            setError(`Block must end by your sleep time (${parseDisplayTime(sleepTime).time} ${parseDisplayTime(sleepTime).period})`);
            return;
        }
        if (type === 'CONTAINER' && !energyLevel) {
            setError('Energy level is required for container blocks');
            return;
        }

        const block: BlockInput = {
            type,
            name: name.trim(),
            startTime,
            endTime,
            ...(type === 'CONTAINER' ? { energyLevel } : {}),
        };

        if (hasOverlapWith(block, existingBlocks, isEditMode ? editIndex : undefined)) {
            setError('This block overlaps with an existing one');
            return;
        }

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
                    <TouchableOpacity onPress={handleClose} hitSlop={12} style={styles.modalCloseButton}>
                        <Text style={styles.modalClose}>×</Text>
                    </TouchableOpacity>
                </View>
                <View style={styles.modalDivider} />

                {/* Block type */}
                <View style={styles.modalSection}>
                    <Text style={styles.modalLabel}>Block type</Text>
                    <View style={styles.pillRow}>
                        {(['CONTAINER', 'ANCHOR', 'NO_TASK'] as BlockType[]).map((t) => (
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
                        {(['CONTAINER', 'ANCHOR', 'NO_TASK'] as BlockType[]).map((t) => (
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
                </View>

                <View style={styles.modalDividerLight} />

                {/* Energy level (Container only) */}
                {type === 'CONTAINER' && (
                    <View style={styles.modalSection}>
                        <Text style={styles.modalLabel}>Energy level</Text>
                        <Text style={styles.energySubtitle}>Starlight uses this to match tasks to your capacity.</Text>
                        <View style={styles.pillRow}>
                            {(['HIGH', 'MEDIUM', 'LOW'] as EnergyLevel[]).map((e) => (
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
                    <Text style={styles.addButtonText}>{isEditMode ? 'Save Changes' : 'Add Block'}</Text>
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

export default function BlocksScreen() {
    const router = useRouter();
    const { wakeTime, sleepTime, blocks, setBlocks, addBlock, removeBlock, updateBlock } = useOnboardingStore();
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (blocks.length === 0) {
            setBlocks([...DEFAULT_BLOCKS]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleAdd = (block: BlockInput) => {
        addBlock(block);
        setShowAddModal(false);
    };

    const handleSave = (block: BlockInput) => {
        if (editingIndex === null) return;
        updateBlock(editingIndex, block);
        setEditingIndex(null);
    };

    const handleDelete = () => {
        if (editingIndex === null) return;
        removeBlock(editingIndex);
        setEditingIndex(null);
    };

    const handleContinue = () => {
        setError(null);
        if (!wakeTime || !sleepTime) {
            setError('Something went wrong. Please go back and set your wake and sleep times.');
            return;
        }
        if (!blocks.some(b => b.type === 'CONTAINER')) {
            setError('Add at least one Container block to continue');
            return;
        }
        router.push('/(onboarding)/review');
    };

    // Sort for display but track original store index for edit/remove
    const sorted = blocks
        .map((block, index) => ({ block, index }))
        .sort((a, b) => toMins(a.block.startTime) - toMins(b.block.startTime));

    return (
        <>
            <SafeAreaView style={styles.safeArea}>
                <View style={styles.container}>
                    <ProgressBar currentStep={3} />

                    {/* Heading */}
                    <View style={styles.headingBlock}>
                        <Text style={styles.title}>Build your day template</Text>
                        <Text style={styles.subtitle}>A few blocks suggested to get you started. Edit or add your own.</Text>
                    </View>

                    {/* Block list */}
                    <ScrollView style={styles.list} showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContent}>
                        {sorted.map(({ block, index }) => (
                            <BlockItem
                                key={index}
                                block={block}
                                onPress={() => setEditingIndex(index)}
                            />
                        ))}

                        {/* Add block row */}
                        <TouchableOpacity style={styles.addRow} onPress={() => setShowAddModal(true)} activeOpacity={0.7}>
                            <Text style={styles.addRowText}>+ Add Block</Text>
                        </TouchableOpacity>
                    </ScrollView>

                    {error && <Text style={styles.errorText}>{error}</Text>}

                    {/* Continue */}
                    <TouchableOpacity style={styles.continueButton} onPress={handleContinue} activeOpacity={0.8}>
                        <Text style={styles.continueButtonText}>Continue</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>

            <AddBlockModal
                visible={showAddModal}
                onClose={() => setShowAddModal(false)}
                onAdd={handleAdd}
                existingBlocks={blocks}
            />

            <AddBlockModal
                visible={editingIndex !== null}
                onClose={() => setEditingIndex(null)}
                existingBlocks={blocks}
                editIndex={editingIndex ?? undefined}
                initialValues={editingIndex !== null ? blocks[editingIndex] : undefined}
                onSave={handleSave}
                onDelete={handleDelete}
            />
        </>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: '#fdfcfa' },
    container: { flex: 1, paddingHorizontal: 32, paddingTop: 20, paddingBottom: 32 },

    headingBlock: { gap: 12, marginBottom: 24 },
    title: { fontSize: 24, fontWeight: '500', color: '#2a2621', letterSpacing: 0.07, lineHeight: 30 },
    subtitle: { fontSize: 15, color: '#7a736a', lineHeight: 24, letterSpacing: -0.23 },

    list: { flex: 1 },
    listContent: { gap: 12, paddingBottom: 16 },

    blockItem: { borderRadius: 16, overflow: 'hidden' },
    blockItemContainer: { borderWidth: 1, borderColor: 'rgba(42,38,33,0.08)', borderStyle: 'dashed' },
    blockItemAnchor: { backgroundColor: 'rgba(232,228,221,0.3)' },
    blockItemNoTask: { borderWidth: 1, borderColor: 'rgba(42,38,33,0.08)', borderStyle: 'dashed', backgroundColor: 'rgba(232,228,221,0.18)' },
    blockItemInner: { flexDirection: 'row', alignItems: 'center', padding: 17 },
    blockItemContent: { flex: 1, gap: 4 },
    blockItemHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    blockItemName: { fontSize: 15, fontWeight: '500', color: '#2a2621', letterSpacing: -0.23 },
    blockItemTime: { fontSize: 14, color: '#7a736a', letterSpacing: -0.15 },
    energyBadge: { backgroundColor: 'rgba(232,223,209,0.5)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
    energyBadgeText: { fontSize: 12, color: '#d4a574' },
    blockItemChevron: { fontSize: 18, color: '#c0b8b0', paddingLeft: 12 },

    addRow: { borderWidth: 1, borderColor: 'rgba(42,38,33,0.08)', borderStyle: 'dashed', borderRadius: 16, height: 50, justifyContent: 'center', alignItems: 'center' },
    addRowText: { fontSize: 14, fontWeight: '500', color: '#7a736a', letterSpacing: -0.15 },

    errorText: { fontSize: 13, color: '#c0392b', textAlign: 'center', marginTop: 10, marginHorizontal: 24 },

    continueButton: { marginTop: 16, height: 52, backgroundColor: '#d4a574', borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
    continueButtonText: { fontSize: 16, fontWeight: '500', color: '#2a2621', letterSpacing: -0.31 },

    // Modal
    modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.3)' },
    modalSheet: { backgroundColor: '#fdfcfa', borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '94%' },
    dragIndicator: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(42,38,33,0.15)', alignSelf: 'center', marginTop: 10, marginBottom: 2 },
    modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16 },
    modalTitle: { fontSize: 18, fontWeight: '500', color: '#2a2621' },
    modalCloseButton: { position: 'absolute', right: 24 },
    modalClose: { fontSize: 22, color: '#7a736a' },
    modalDivider: { height: 1, backgroundColor: 'rgba(42,38,33,0.06)' },
    modalDividerLight: { height: 1, backgroundColor: 'rgba(42,38,33,0.06)', marginHorizontal: 24 },
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

    textInput: { height: 52, backgroundColor: '#fffef9', borderWidth: 1, borderColor: 'rgba(42,38,33,0.08)', borderRadius: 14, paddingHorizontal: 16, fontSize: 15, color: '#2a2621' },

    timeRow: { flexDirection: 'row', gap: 12 },
    timeField: { flex: 1, gap: 12 },
    timeInput: { height: 52, backgroundColor: '#fffef9', borderWidth: 1, borderColor: 'rgba(42,38,33,0.08)', borderRadius: 14, justifyContent: 'center', paddingHorizontal: 16 },
    timeInputValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
    timeInputValue: { fontSize: 15, fontWeight: '500', color: '#2a2621' },
    timeInputPeriod: { fontSize: 11, fontWeight: '500', color: '#d4a574' },
    timeInputPlaceholder: { fontSize: 15, color: 'rgba(122,115,106,0.35)' },

    energySubtitle: { fontSize: 12, color: 'rgba(122,115,106,0.6)', marginTop: -4 },

    addButton: { marginHorizontal: 24, height: 52, backgroundColor: '#d4a574', borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
    addButtonText: { fontSize: 16, fontWeight: '500', color: '#2a2621', letterSpacing: -0.31 },
    deleteButton: { marginHorizontal: 24, height: 48, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
    deleteButtonText: { fontSize: 15, fontWeight: '500', color: '#c0392b', letterSpacing: -0.23 },

    // Picker
    pickerOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.3)' },
    pickerSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40 },
    pickerHeader: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 4 },
    pickerDoneText: { fontSize: 16, fontWeight: '600', color: '#d4a574' },
});
