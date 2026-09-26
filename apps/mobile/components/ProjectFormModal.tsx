import { useEffect, useState } from "react";
import {
    Modal,
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    Platform,
    Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardProvider, KeyboardToolbar, KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import type { Project } from "../lib/api.types";
import { colors, radius, spacing } from "../lib/theme";

type Props = {
    visible: boolean;
    mode: 'create' | 'edit';
    project?: Project | null;
    onClose: () => void;
    onSaved: (project: Project) => void;
    onDeleted: (projectId: string) => void;
};

export default function ProjectFormModal({ visible, mode, project, onClose, onSaved, onDeleted }: Props) {
    const insets = useSafeAreaInsets();

    const [name, setName] = useState('');
    const [goal, setGoal] = useState('');
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [nameError, setNameError] = useState<string | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);

    // Seed the fields whenever the sheet opens, since the component stays mounted
    // and is reused across create and every edit target.
    useEffect(() => {
        if (!visible) return;
        setName(project?.name ?? '');
        setGoal(project?.goal ?? '');
        setNotes(project?.notes ?? '');
        setSubmitting(false);
        setDeleting(false);
        setNameError(null);
        setSubmitError(null);
    }, [visible, project]);

    const isEdit = mode === 'edit';
    const busy = submitting || deleting;

    async function handleSubmit() {
        if (busy) return;
        const trimmedName = name.trim();
        if (!trimmedName) {
            setNameError('Name is required');
            return;
        }
        setSubmitting(true);
        setSubmitError(null);
        setNameError(null);

        const trimmedGoal = goal.trim();
        const trimmedNotes = notes.trim();
        // On edit, send explicit null for empty fields so clearing persists; on
        // create, omit them so the payload stays minimal.
        const result = isEdit && project
            ? await api.updateProject(project.id, { name: trimmedName, goal: trimmedGoal || null, notes: trimmedNotes || null })
            : await api.createProject({
                name: trimmedName,
                ...(trimmedGoal && { goal: trimmedGoal }),
                ...(trimmedNotes && { notes: trimmedNotes }),
            });

        setSubmitting(false);
        if (result.ok) {
            onSaved(result.data);
            return;
        }
        // A duplicate name is a field-level problem, so point at the input rather
        // than the generic submit error.
        if (result.status === 409) setNameError('A project with that name already exists');
        else setSubmitError(result.error);
    }

    function handleDelete() {
        if (!project || busy) return;
        Alert.alert(
            'Delete project?',
            `"${project.name}" will be removed. Its tasks stay and become unassigned.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        setDeleting(true);
                        const result = await api.deleteProject(project.id);
                        setDeleting(false);
                        if (result.ok) onDeleted(project.id);
                        else Alert.alert("Couldn't delete project", result.error);
                    },
                },
            ],
        );
    }

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
            <KeyboardProvider>
                {/* iOS page sheet clears the status bar itself; the window-level top inset would double-pad it. */}
                <View style={[s.screen, { paddingTop: Platform.OS === 'ios' ? 0 : insets.top }]}>
                    <View style={s.header}>
                        <Text style={s.headerTitle}>{isEdit ? 'Edit Project' : 'New Project'}</Text>
                        <TouchableOpacity style={s.closeBtn} onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                            <Ionicons name="close" size={22} color={colors.text.primary} />
                        </TouchableOpacity>
                    </View>

                    <KeyboardAwareScrollView
                        style={s.scrollFlex}
                        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32 }]}
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                        bottomOffset={16}
                    >
                        <TextInput
                            style={[s.nameInput, nameError && s.nameInputError]}
                            placeholder="Project name"
                            placeholderTextColor={colors.text.muted}
                            value={name}
                            onChangeText={(t) => { setName(t); if (t.trim()) setNameError(null); }}
                            autoFocus={!isEdit}
                            returnKeyType="done"
                        />
                        {nameError && <Text style={s.inlineError}>{nameError}</Text>}

                        <View style={s.fieldCard}>
                            <Text style={s.fieldLabel}>Goal</Text>
                            <TextInput
                                style={s.fieldInput}
                                placeholder="What is this project working towards? (optional)"
                                placeholderTextColor={colors.text.muted}
                                value={goal}
                                onChangeText={setGoal}
                                multiline
                                textAlignVertical="top"
                            />
                        </View>

                        <View style={s.fieldCard}>
                            <Text style={s.fieldLabel}>Notes</Text>
                            <TextInput
                                style={s.fieldInput}
                                placeholder="What else should the planner keep in mind when scheduling tasks inside this project? (optional)"
                                placeholderTextColor={colors.text.muted}
                                value={notes}
                                onChangeText={setNotes}
                                multiline
                                textAlignVertical="top"
                            />
                        </View>

                        {submitError && <Text style={s.submitError}>{submitError}</Text>}

                        <TouchableOpacity
                            style={[s.saveBtn, busy && s.saveBtnDisabled]}
                            onPress={handleSubmit}
                            disabled={busy}
                            activeOpacity={0.8}
                        >
                            <Text style={s.saveBtnTxt}>
                                {submitting ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save changes' : 'Create project')}
                            </Text>
                        </TouchableOpacity>

                        {isEdit && (
                            <TouchableOpacity style={s.deleteBtn} onPress={handleDelete} disabled={busy} activeOpacity={0.7}>
                                <Ionicons name="trash-outline" size={16} color={colors.danger.default} />
                                <Text style={s.deleteBtnTxt}>{deleting ? 'Deleting...' : 'Delete project'}</Text>
                            </TouchableOpacity>
                        )}
                    </KeyboardAwareScrollView>
                </View>
                <KeyboardToolbar />
            </KeyboardProvider>
        </Modal>
    );
}

const s = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface.page },

    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: spacing.xl, paddingTop: spacing.xl, paddingBottom: spacing.lg,
        borderBottomWidth: 1, borderBottomColor: colors.border.hairline,
    },
    headerTitle: { fontSize: 16, fontWeight: '600', color: colors.text.primary, letterSpacing: -0.3 },
    closeBtn: { width: 30, height: 30, justifyContent: 'center', alignItems: 'center' },

    scrollFlex: { flex: 1 },
    scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl },

    nameInput: {
        fontSize: 22, fontWeight: '500', color: colors.text.primary,
        lineHeight: 30, letterSpacing: -0.4, marginBottom: spacing.xl, padding: 0,
    },
    nameInputError: { borderBottomWidth: 1, borderBottomColor: colors.danger.border },
    inlineError: { fontSize: 12, color: colors.danger.default, marginTop: -spacing.lg, marginBottom: spacing.md },

    fieldCard: {
        backgroundColor: colors.surface.raised, borderWidth: 1,
        borderColor: colors.border.hairline, borderRadius: radius.lg,
        paddingHorizontal: spacing.lg, paddingVertical: spacing.md, marginBottom: spacing.lg,
    },
    fieldLabel: { fontSize: 14, fontWeight: '500', color: colors.text.secondary, letterSpacing: -0.15, marginBottom: spacing.sm },
    fieldInput: { fontSize: 14, color: colors.text.primary, minHeight: 72, lineHeight: 20, padding: 0 },

    submitError: { fontSize: 12, color: colors.danger.default, textAlign: 'center', marginBottom: spacing.sm },

    saveBtn: {
        backgroundColor: colors.text.primary, borderRadius: radius.md,
        height: 48, justifyContent: 'center', alignItems: 'center',
    },
    saveBtnDisabled: { opacity: 0.35 },
    saveBtnTxt: { fontSize: 14, fontWeight: '500', color: colors.surface.page, letterSpacing: -0.1 },

    deleteBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
        height: 44, marginTop: spacing.md,
    },
    deleteBtnTxt: { fontSize: 14, fontWeight: '500', color: colors.danger.default, letterSpacing: -0.1 },
});
