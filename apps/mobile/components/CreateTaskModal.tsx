import { useState } from "react";
import {
    Modal,
    View,
    Text,
    TextInput,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../lib/api";
import type { BacklogTask, Priority, EnergyLevel } from "../lib/api.types";
import {
    ESTIMATE_OPTIONS, PROGRESS_PRESETS,
    FieldRow, ProgressSlider, DeadlineExpanded,
    getEstimateLabel, formatDeadlineValue, priorityDotColor,
    defaultTime,
    tf,
} from "./TaskFields";

type FieldKey = 'estimate' | 'priority' | 'effort' | 'deadline' | 'progress';

type Props = { visible: boolean; onClose: () => void; onCreated: (task: BacklogTask) => void; };

export default function CreateTaskModal({ visible, onClose, onCreated }: Props) {
    const insets = useSafeAreaInsets();

    const [activeField, setActiveField] = useState<FieldKey | null>(null);
    const [title, setTitle]             = useState('');
    const [notes, setNotes]             = useState('');
    const [estimatedMins, setEstimatedMins] = useState<number | null>(null);
    const [priority, setPriority]       = useState<Priority | null>(null);
    const [effort, setEffort]           = useState<EnergyLevel | null>(null);
    const [deadlineDay, setDeadlineDay] = useState<Date | null>(null);
    const [deadlineTime, setDeadlineTime] = useState<Date>(defaultTime);
    const [tempDay, setTempDay]         = useState<Date>(() => new Date());
    const [showTimePicker, setShowTimePicker] = useState(false);
    const [progress, setProgress]       = useState(0);
    const [submitting, setSubmitting]   = useState(false);
    const [titleError, setTitleError]   = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    function resetForm() {
        setActiveField(null); setTitle(''); setNotes('');
        setEstimatedMins(null); setPriority(null); setEffort(null);
        setDeadlineDay(null); setDeadlineTime(defaultTime()); setTempDay(new Date()); setShowTimePicker(false);
        setProgress(0);
        setSubmitting(false); setTitleError(false); setSubmitError(null);
    }

    function handleClose() { resetForm(); onClose(); }

    function toggleField(key: FieldKey) {
        if (activeField === key) { setActiveField(null); return; }
        if (key === 'deadline') setTempDay(deadlineDay ?? new Date());
        setActiveField(key);
    }

    async function handleSubmit() {
        if (!title.trim()) { setTitleError(true); return; }
        if (!estimatedMins) return;
        setSubmitting(true); setSubmitError(null);

        let deadline: string | undefined;
        if (deadlineDay) {
            const c = new Date(
                deadlineDay.getFullYear(), deadlineDay.getMonth(), deadlineDay.getDate(),
                deadlineTime.getHours(), deadlineTime.getMinutes(), 0
            );
            deadline = c.toISOString();
        }

        const result = await api.createTask({
            title: title.trim(), estimatedMins,
            ...(priority && { priority }),
            ...(effort   && { effort }),
            ...(deadline && { deadline }),
            progress,
            ...(notes.trim() && { notes: notes.trim() }),
        });

        setSubmitting(false);
        if (result.ok) { onCreated(result.data); resetForm(); }
        else setSubmitError(result.error);
    }

    const canSubmit = title.trim().length > 0 && estimatedMins !== null && !submitting;

    return (
        <Modal visible={visible} animationType="slide" onRequestClose={handleClose}>
            <View style={[s.screen, { paddingTop: insets.top }]}>

                <View style={s.header}>
                    <Text style={s.headerTitle}>New Task</Text>
                    <TouchableOpacity style={s.closeBtn} onPress={handleClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="close" size={17} color="#2a2621" />
                    </TouchableOpacity>
                </View>

                <ScrollView
                    contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32 }]}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                >
                    <TextInput
                        style={[s.titleInput, titleError && s.titleInputError]}
                        placeholder="What needs to be done?"
                        placeholderTextColor="rgba(122,115,106,0.3)"
                        value={title}
                        onChangeText={(t) => { setTitle(t); if (t.trim()) setTitleError(false); }}
                        autoFocus multiline blurOnSubmit returnKeyType="done"
                    />
                    {titleError && <Text style={s.inlineError}>Title is required</Text>}

                    <View style={s.card}>

                        <FieldRow
                            label="Estimate" subLabel="Required for scheduling"
                            value={estimatedMins !== null ? getEstimateLabel(estimatedMins) : 'Not set'}
                            isOpen={activeField === 'estimate'}
                            onPress={() => toggleField('estimate')}
                        />
                        {activeField === 'estimate' && (
                            <View style={tf.pills}>
                                {ESTIMATE_OPTIONS.map(o => (
                                    <TouchableOpacity
                                        key={o.value}
                                        style={[tf.pill, estimatedMins === o.value && tf.pillOn]}
                                        onPress={() => { setEstimatedMins(o.value); setActiveField(null); }}
                                    >
                                        <Text style={[tf.pillTxt, estimatedMins === o.value && tf.pillTxtOn]}>{o.label}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        )}

                        <View style={s.sep} />

                        <FieldRow
                            label="Priority"
                            value={priority ? priority.charAt(0) + priority.slice(1).toLowerCase() : 'Not set'}
                            isOpen={activeField === 'priority'}
                            onPress={() => toggleField('priority')}
                        />
                        {activeField === 'priority' && (
                            <View style={tf.pills}>
                                {(['HIGH','MEDIUM','LOW'] as Priority[]).map(p => (
                                    <TouchableOpacity
                                        key={p}
                                        style={[tf.pill, priority === p && tf.pillOn]}
                                        onPress={() => { setPriority(p); setActiveField(null); }}
                                    >
                                        <View style={[tf.dot, { backgroundColor: priorityDotColor(p) }]} />
                                        <Text style={[tf.pillTxt, priority === p && tf.pillTxtOn]}>
                                            {p.charAt(0) + p.slice(1).toLowerCase()}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                                {priority !== null && (
                                    <TouchableOpacity style={tf.pill} onPress={() => { setPriority(null); setActiveField(null); }}>
                                        <Text style={tf.pillTxt}>Clear</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        )}

                        <View style={s.sep} />

                        <FieldRow
                            label="Effort" subLabel="Est. energy required"
                            value={effort ? effort.charAt(0) + effort.slice(1).toLowerCase() : 'Not set'}
                            isOpen={activeField === 'effort'}
                            onPress={() => toggleField('effort')}
                        />
                        {activeField === 'effort' && (
                            <View style={tf.pills}>
                                {(['HIGH','MEDIUM','LOW'] as EnergyLevel[]).map(e => (
                                    <TouchableOpacity
                                        key={e}
                                        style={[tf.pill, effort === e && tf.pillOn]}
                                        onPress={() => { setEffort(e); setActiveField(null); }}
                                    >
                                        <Text style={[tf.pillTxt, effort === e && tf.pillTxtOn]}>
                                            {e.charAt(0) + e.slice(1).toLowerCase()}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                                {effort !== null && (
                                    <TouchableOpacity style={tf.pill} onPress={() => { setEffort(null); setActiveField(null); }}>
                                        <Text style={tf.pillTxt}>Clear</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        )}

                        <View style={s.sep} />

                        <FieldRow
                            label="Deadline"
                            value={deadlineDay ? formatDeadlineValue(deadlineDay, deadlineTime) : 'Not set'}
                            isOpen={activeField === 'deadline'}
                            onPress={() => toggleField('deadline')}
                        />
                        {activeField === 'deadline' && (
                            <DeadlineExpanded
                                tempDay={tempDay}
                                onDayChange={setTempDay}
                                deadlineTime={deadlineTime}
                                onTimeChange={setDeadlineTime}
                                showTimePicker={showTimePicker}
                                onToggleTimePicker={() => setShowTimePicker(v => !v)}
                                onConfirm={() => { setDeadlineDay(tempDay); setActiveField(null); }}
                                onClear={() => { setDeadlineDay(null); setActiveField(null); }}
                                hasDeadline={deadlineDay !== null}
                            />
                        )}

                        <View style={s.sep} />

                        <FieldRow
                            label="Progress" value={`${progress}%`}
                            isOpen={activeField === 'progress'}
                            onPress={() => toggleField('progress')}
                        />
                        {activeField === 'progress' && (
                            <View style={tf.progressSection}>
                                <ProgressSlider value={progress} onChange={setProgress} />
                                <View style={tf.progressPresets}>
                                    {PROGRESS_PRESETS.map(val => (
                                        <TouchableOpacity
                                            key={val}
                                            style={[tf.pill, progress === val && tf.pillOn]}
                                            onPress={() => setProgress(val)}
                                        >
                                            <Text style={[tf.pillTxt, progress === val && tf.pillTxtOn]}>{val}%</Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </View>
                        )}

                    </View>

                    <View style={s.notesCard}>
                        <Text style={s.notesLabel}>NOTES</Text>
                        <TextInput
                            style={s.notesInput}
                            placeholder="Add context, links, or anything relevant..."
                            placeholderTextColor="rgba(122,115,106,0.3)"
                            value={notes}
                            onChangeText={setNotes}
                            multiline textAlignVertical="top"
                        />
                    </View>

                    {submitError && <Text style={s.submitError}>{submitError}</Text>}

                    <TouchableOpacity
                        style={[s.createBtn, !canSubmit && s.createBtnOff]}
                        onPress={handleSubmit}
                        activeOpacity={0.8}
                    >
                        <Text style={s.createBtnTxt}>{submitting ? 'Creating...' : 'Create task'}</Text>
                    </TouchableOpacity>

                </ScrollView>
            </View>
        </Modal>
    );
}

const BASE_TXT: { fontSize: number; color: string } = { fontSize: 14, color: '#2a2621' };

const s = StyleSheet.create({
    screen: { flex: 1, backgroundColor: '#fdfcfa' },

    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 14,
        borderBottomWidth: 1, borderBottomColor: 'rgba(42,38,33,0.05)',
    },
    headerTitle: { ...BASE_TXT, fontSize: 16, fontWeight: '500', letterSpacing: -0.2 },
    closeBtn: {
        width: 30, height: 30, borderRadius: 15,
        backgroundColor: 'rgba(42,38,33,0.06)',
        justifyContent: 'center', alignItems: 'center',
    },

    scroll: { paddingHorizontal: 16, paddingTop: 20 },

    titleInput: {
        ...BASE_TXT, fontSize: 22, fontWeight: '500',
        lineHeight: 30, letterSpacing: -0.4, marginBottom: 20, padding: 0,
    },
    titleInputError: { borderBottomWidth: 1, borderBottomColor: 'rgba(200,80,80,0.4)' },
    inlineError: { fontSize: 12, color: 'rgba(200,80,80,0.8)', marginTop: -14, marginBottom: 10 },

    card: {
        backgroundColor: '#fffef9', borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.06)', borderRadius: 16,
        overflow: 'hidden', marginBottom: 12,
    },
    sep: { height: 1, backgroundColor: 'rgba(42,38,33,0.04)' },

    notesCard: {
        backgroundColor: '#fffef9', borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.06)', borderRadius: 16,
        paddingHorizontal: 16, paddingVertical: 14, marginBottom: 14,
    },
    notesLabel: { fontSize: 10, color: 'rgba(122,115,106,0.4)', letterSpacing: 1.1, marginBottom: 8 },
    notesInput: { ...BASE_TXT, minHeight: 72, lineHeight: 20, padding: 0 },

    submitError: { fontSize: 12, color: 'rgba(200,80,80,0.8)', textAlign: 'center', marginBottom: 8 },
    createBtn: {
        backgroundColor: '#2a2621', borderRadius: 14,
        height: 48, justifyContent: 'center', alignItems: 'center',
    },
    createBtnOff: { opacity: 0.35 },
    createBtnTxt: { ...BASE_TXT, fontWeight: '500', color: '#fdfcfa', letterSpacing: -0.1 },
});

