import { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useOnboardingStore } from "../../stores/onboarding.store";
import { BlockInput } from "../../lib/api.types";
import { toMins } from "../../lib/time";
import { ProgressBar } from "../../components/ProgressBar";
import { BlockListItem } from "../../components/BlockListItem";
import { BlockEditorModal } from "../../components/BlockEditorModal";

const DEFAULT_BLOCKS: BlockInput[] = [
    { type: 'CONTAINER', name: 'Deep Work', startTime: '09:00', endTime: '12:00', energyLevel: 'HIGH' },
    { type: 'ANCHOR', name: 'Lunch', startTime: '12:00', endTime: '13:00' },
    { type: 'NO_TASK', name: 'Evening Wind Down', startTime: '20:00', endTime: '22:00' },
];

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
                            <BlockListItem
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

            <BlockEditorModal
                visible={showAddModal}
                onClose={() => setShowAddModal(false)}
                onAdd={handleAdd}
                existingBlocks={blocks}
                wakeTime={wakeTime}
                sleepTime={sleepTime}
            />

            <BlockEditorModal
                visible={editingIndex !== null}
                onClose={() => setEditingIndex(null)}
                existingBlocks={blocks}
                editIndex={editingIndex ?? undefined}
                initialValues={editingIndex !== null ? blocks[editingIndex] : undefined}
                onSave={handleSave}
                onDelete={handleDelete}
                wakeTime={wakeTime}
                sleepTime={sleepTime}
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

    addRow: { borderWidth: 1, borderColor: 'rgba(42,38,33,0.10)', borderStyle: 'dashed', borderRadius: 16, height: 50, justifyContent: 'center', alignItems: 'center' },
    addRowText: { fontSize: 14, fontWeight: '500', color: '#7a736a', letterSpacing: -0.15 },

    errorText: { fontSize: 13, color: '#c0392b', textAlign: 'center', marginTop: 10, marginHorizontal: 24 },

    continueButton: { marginTop: 16, height: 52, backgroundColor: '#d4a574', borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
    continueButtonText: { fontSize: 16, fontWeight: '500', color: '#2a2621', letterSpacing: -0.31 },
});
