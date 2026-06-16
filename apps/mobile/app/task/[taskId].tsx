import { useCallback, useEffect, useRef, useState } from "react";
import {
    View,
    Text,
    TextInput,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    Alert,
    ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../lib/api";
import type { TaskDetail, EnergyLevel, Priority, UpdateTaskInput } from "../../lib/api.types";
import {
    ESTIMATE_OPTIONS, PROGRESS_PRESETS,
    FieldRow, ProgressSlider, DeadlineExpanded,
    getEstimateLabel, formatDeadlineValue, priorityDotColor,
    defaultTime,
    tf,
} from "../../components/TaskFields";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type FieldKey = 'estimate' | 'priority' | 'effort' | 'deadline' | 'progress';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

function deadlineToParts(iso: string): { day: Date; time: Date } {
    const d = new Date(iso);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const time = new Date(d);
    return { day, time };
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TaskDetailScreen() {
    const router = useRouter();
    const navigation = useNavigation();
    const { taskId } = useLocalSearchParams<{ taskId: string }>();

    // Server state
    const [task, setTask] = useState<TaskDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);

    // Editable local state
    const [title, setTitle]               = useState('');
    const [notes, setNotes]               = useState('');
    const [estimatedMins, setEstimatedMins] = useState(15);
    const [priority, setPriority]         = useState<Priority | null>(null);
    const [effort, setEffort]             = useState<EnergyLevel | null>(null);
    const [deadlineDay, setDeadlineDay]   = useState<Date | null>(null);
    const [deadlineTime, setDeadlineTime] = useState<Date>(defaultTime());
    const [tempDay, setTempDay]           = useState<Date>(() => new Date());
    const [showTimePicker, setShowTimePicker] = useState(false);
    const [progress, setProgress]         = useState(0);

    // UI state
    const [activeField, setActiveField]   = useState<FieldKey | null>(null);
    const [saveStatus, setSaveStatus]     = useState<SaveStatus>('idle');
    const [saveError, setSaveError]       = useState<string | null>(null);
    const [titleError, setTitleError]     = useState(false);
    const [deleting, setDeleting]         = useState(false);

    // Debounce refs
    const titleDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
    const notesDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
    const savedStatusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ─── Sync helpers ──────────────────────────────────────────────────────────

    const syncFromTask = useCallback((t: TaskDetail) => {
        setTitle(t.title);
        setNotes(t.notes ?? '');
        setEstimatedMins(t.estimatedMins);
        setPriority(t.priority);
        setEffort(t.effort);
        setProgress(t.progress ?? 0);
        if (t.deadline) {
            const { day, time } = deadlineToParts(t.deadline);
            setDeadlineDay(day);
            setDeadlineTime(time);
            setTempDay(day);
        } else {
            setDeadlineDay(null);
            setDeadlineTime(defaultTime());
            setTempDay(new Date());
        }
    }, []);

    // ─── Fetch ─────────────────────────────────────────────────────────────────

    useEffect(() => {
        if (!taskId) return;
        let active = true;
        api.getTaskDetail(taskId).then(result => {
            if (!active) return;
            if (result.ok) {
                setTask(result.data);
                syncFromTask(result.data);
            } else {
                setFetchError(result.error);
            }
            setLoading(false);
        });
        return () => { active = false; };
    }, [taskId, syncFromTask]);

    // ─── Disable swipe-back while slider is active ────────────────────────────

    useEffect(() => {
        navigation.setOptions({ gestureEnabled: activeField !== 'progress' });
    }, [activeField, navigation]);

    // ─── Cleanup debounce timers on unmount ────────────────────────────────────

    useEffect(() => () => {
        if (titleDebounce.current) clearTimeout(titleDebounce.current);
        if (notesDebounce.current) clearTimeout(notesDebounce.current);
        if (savedStatusTimer.current) clearTimeout(savedStatusTimer.current);
    }, []);

    // ─── Save ──────────────────────────────────────────────────────────────────

    async function save(patch: UpdateTaskInput) {
        if (!taskId) return;
        setSaveStatus('saving');
        setSaveError(null);
        if (savedStatusTimer.current) clearTimeout(savedStatusTimer.current);

        const result = await api.updateTask(taskId, patch);

        if (result.ok) {
            setTask(result.data);
            syncFromTask(result.data);
            setSaveStatus('saved');
            savedStatusTimer.current = setTimeout(() => setSaveStatus(s => s === 'saved' ? 'idle' : s), 1500);
        } else {
            setSaveStatus('error');
            setSaveError(result.error);
            if (task) syncFromTask(task);
        }
    }

    // ─── Field handlers ────────────────────────────────────────────────────────

    function handleTitleChange(value: string) {
        setTitle(value);
        setTitleError(!value.trim());
        if (titleDebounce.current) clearTimeout(titleDebounce.current);
        if (!value.trim()) return;
        titleDebounce.current = setTimeout(() => save({ title: value.trim() }), 700);
    }

    function handleNotesChange(value: string) {
        setNotes(value);
        if (notesDebounce.current) clearTimeout(notesDebounce.current);
        notesDebounce.current = setTimeout(() => save({ notes: value.trim() || null }), 700);
    }

    function handleEstimateSelect(mins: number) {
        setEstimatedMins(mins);
        setActiveField(null);
        save({ estimatedMins: mins });
    }

    function handlePrioritySelect(p: Priority | null) {
        setPriority(p);
        setActiveField(null);
        save({ priority: p });
    }

    function handleEffortSelect(e: EnergyLevel | null) {
        setEffort(e);
        setActiveField(null);
        save({ effort: e });
    }

    function handleDeadlineConfirm() {
        setDeadlineDay(tempDay);
        setActiveField(null);
        setShowTimePicker(false);
        const combined = new Date(
            tempDay.getFullYear(), tempDay.getMonth(), tempDay.getDate(),
            deadlineTime.getHours(), deadlineTime.getMinutes(), 0
        );
        save({ deadline: combined.toISOString() });
    }

    function handleDeadlineClear() {
        setDeadlineDay(null);
        setActiveField(null);
        setShowTimePicker(false);
        save({ deadline: null });
    }

    function handleProgressPreset(val: number) {
        setProgress(val);
        save({ progress: val });
    }

    function handleProgressSliderRelease(val: number) {
        setProgress(val);
        save({ progress: val });
    }

    function toggleField(key: FieldKey) {
        if (activeField === key) {
            if (key === 'deadline') setShowTimePicker(false);
            setActiveField(null);
            return;
        }
        if (key === 'deadline') setTempDay(deadlineDay ?? new Date());
        setActiveField(key);
    }

    // ─── Done toggle ───────────────────────────────────────────────────────────

    function handleDoneToggle() {
        if (task?.status === 'DONE') {
            setProgress(75);
            save({ progress: 75 });
        } else {
            setProgress(100);
            save({ progress: 100 });
        }
    }

    // ─── Delete ────────────────────────────────────────────────────────────────

    function confirmDelete() {
        Alert.alert(
            'Delete task',
            'This action cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: handleDelete },
            ]
        );
    }

    async function handleDelete() {
        if (!taskId) return;
        setDeleting(true);
        const result = await api.deleteTask(taskId);
        if (result.ok) {
            router.back();
        } else {
            setDeleting(false);
            Alert.alert('Error', result.error);
        }
    }

    // ─── Derived display values ────────────────────────────────────────────────

    const isDone = task?.status === 'DONE';
    const deadlineDisplayValue = deadlineDay
        ? formatDeadlineValue(deadlineDay, deadlineTime)
        : 'Not set';

    // ─── Render ────────────────────────────────────────────────────────────────

    return (
        <SafeAreaView style={s.safeArea}>

            <View style={s.backRow}>
                <TouchableOpacity style={s.backButton} onPress={() => router.back()} activeOpacity={0.7}>
                    <Ionicons name="chevron-back" size={20} color="#7a736a" />
                    <Text style={s.backLabel}>Backlog</Text>
                </TouchableOpacity>
            </View>

            {loading && (
                <View style={s.centered}>
                    <ActivityIndicator color="#d4a574" />
                </View>
            )}

            {!loading && fetchError && (
                <View style={s.centered}>
                    <Text style={s.fetchErrorText}>{fetchError}</Text>
                </View>
            )}

            {!loading && !fetchError && task && (
                <ScrollView
                    style={s.scroll}
                    contentContainerStyle={s.content}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                >
                    {/* Title */}
                    <TextInput
                        style={[s.titleInput, titleError && s.titleInputError]}
                        value={title}
                        onChangeText={handleTitleChange}
                        multiline blurOnSubmit returnKeyType="done"
                        placeholderTextColor="rgba(122,115,106,0.3)"
                    />
                    {titleError && <Text style={s.titleErrorText}>Title cannot be empty</Text>}

                    {/* Status badge + Done toggle */}
                    <View style={s.statusRow}>
                        <View style={[s.statusBadge, isDone ? s.statusBadgeDone : task.status === 'IN_PROGRESS' ? s.statusBadgeActive : s.statusBadgeMuted]}>
                            {task.status === 'IN_PROGRESS' && <View style={s.statusDot} />}
                            <Text style={[s.statusText, isDone ? s.statusTextDone : task.status === 'IN_PROGRESS' ? s.statusTextActive : s.statusTextMuted]}>
                                {isDone ? 'Done' : task.status === 'IN_PROGRESS' ? 'In Progress' : 'Todo'}
                            </Text>
                        </View>
                        <TouchableOpacity onPress={handleDoneToggle} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                            <Ionicons
                                name={isDone ? 'checkmark-circle' : 'checkmark-circle-outline'}
                                size={28}
                                color={isDone ? '#5c5248' : 'rgba(122,115,106,0.3)'}
                            />
                        </TouchableOpacity>
                    </View>

                    {/* Fields card */}
                    <View style={s.card}>

                        <FieldRow
                            label="Estimate" subLabel="Required for scheduling"
                            value={getEstimateLabel(estimatedMins)}
                            isOpen={activeField === 'estimate'}
                            onPress={() => toggleField('estimate')}
                        />
                        {activeField === 'estimate' && (
                            <View style={tf.pills}>
                                {ESTIMATE_OPTIONS.map(o => (
                                    <TouchableOpacity
                                        key={o.value}
                                        style={[tf.pill, estimatedMins === o.value && tf.pillOn]}
                                        onPress={() => handleEstimateSelect(o.value)}
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
                                        onPress={() => handlePrioritySelect(p)}
                                    >
                                        <View style={[tf.dot, { backgroundColor: priorityDotColor(p) }]} />
                                        <Text style={[tf.pillTxt, priority === p && tf.pillTxtOn]}>
                                            {p.charAt(0) + p.slice(1).toLowerCase()}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                                {priority !== null && (
                                    <TouchableOpacity style={tf.pill} onPress={() => handlePrioritySelect(null)}>
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
                                        onPress={() => handleEffortSelect(e)}
                                    >
                                        <Text style={[tf.pillTxt, effort === e && tf.pillTxtOn]}>
                                            {e.charAt(0) + e.slice(1).toLowerCase()}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                                {effort !== null && (
                                    <TouchableOpacity style={tf.pill} onPress={() => handleEffortSelect(null)}>
                                        <Text style={tf.pillTxt}>Clear</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        )}

                        <View style={s.sep} />

                        <FieldRow
                            label="Deadline"
                            value={deadlineDisplayValue}
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
                                onConfirm={handleDeadlineConfirm}
                                onClear={handleDeadlineClear}
                                hasDeadline={deadlineDay !== null}
                            />
                        )}

                        <View style={s.sep} />

                        <FieldRow
                            label="Progress"
                            value={`${progress}%`}
                            isOpen={activeField === 'progress'}
                            onPress={() => toggleField('progress')}
                        />
                        {activeField === 'progress' && (
                            <View style={tf.progressSection}>
                                <ProgressSlider
                                    value={progress}
                                    onChange={setProgress}
                                    onRelease={handleProgressSliderRelease}
                                />
                                <View style={tf.progressPresets}>
                                    {PROGRESS_PRESETS.map(val => (
                                        <TouchableOpacity
                                            key={val}
                                            style={[tf.pill, progress === val && tf.pillOn]}
                                            onPress={() => handleProgressPreset(val)}
                                        >
                                            <Text style={[tf.pillTxt, progress === val && tf.pillTxtOn]}>{val}%</Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </View>
                        )}

                    </View>

                    {/* Notes */}
                    <View style={s.notesCard}>
                        <Text style={s.notesLabel}>NOTES</Text>
                        <TextInput
                            style={s.notesInput}
                            placeholder="Add context, links, or anything relevant..."
                            placeholderTextColor="rgba(122,115,106,0.3)"
                            value={notes}
                            onChangeText={handleNotesChange}
                            multiline textAlignVertical="top"
                        />
                    </View>

                    {/* Done / Delete */}
                    <TouchableOpacity
                        style={s.deleteButton}
                        onPress={confirmDelete}
                        activeOpacity={0.5}
                        disabled={deleting}
                        hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
                    >
                        <Ionicons name="trash-outline" size={15} color="rgba(212,24,61,0.6)" />
                        <Text style={s.deleteLabel}>Delete task</Text>
                    </TouchableOpacity>

                </ScrollView>
            )}

            {!loading && !fetchError && task && (
                <View style={s.saveStatusRow}>
                    {saveStatus === 'saving' && <Text style={s.savingText}>Saving...</Text>}
                    {saveStatus === 'saved'  && <Text style={s.savedText}>Saved</Text>}
                    {saveStatus === 'error'  && <Text style={s.saveErrorText}>{saveError}</Text>}
                </View>
            )}
        </SafeAreaView>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const BASE_TXT: { fontSize: number; color: string } = { fontSize: 14, color: '#2a2621' };

const s = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: '#fdfcfa' },

    backRow: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 2 },
    backButton: {
        flexDirection: 'row', alignItems: 'center', gap: 2,
        alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 4,
    },
    backLabel: { fontSize: 15, color: '#7a736a' },

    scroll: { flex: 1 },

    saveStatusRow: { height: 32, justifyContent: 'center', alignItems: 'center' },
    savingText: { fontSize: 12, color: '#d4a574' },
    savedText:  { fontSize: 12, color: 'rgba(122,115,106,0.5)' },
    saveErrorText: { fontSize: 12, color: 'rgba(200,80,80,0.8)' },

    centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    fetchErrorText: { fontSize: 14, color: '#7a736a', textAlign: 'center' },

    content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40, gap: 12 },

    titleInput: {
        ...BASE_TXT, fontSize: 23.2, fontWeight: '500',
        letterSpacing: -0.3, lineHeight: 32, padding: 0,
        paddingHorizontal: 4,
    },
    titleInputError: { borderBottomWidth: 1, borderBottomColor: 'rgba(200,80,80,0.4)' },
    titleErrorText: { fontSize: 12, color: 'rgba(200,80,80,0.8)', paddingHorizontal: 4 },

    statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },

    statusBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
        paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1,
    },
    statusBadgeActive: { backgroundColor: 'rgba(212,165,116,0.1)', borderColor: 'rgba(212,165,116,0.2)' },
    statusBadgeDone:   { backgroundColor: 'rgba(92,82,72,0.10)', borderColor: 'rgba(92,82,72,0.20)' },
    statusBadgeMuted:  { backgroundColor: 'rgba(232,228,221,0.4)', borderColor: 'rgba(42,38,33,0.06)'   },
    statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#d4a574' },
    statusText: { fontSize: 12, fontWeight: '500' },
    statusTextActive: { color: '#d4a574' },
    statusTextDone:   { color: '#5c5248' },
    statusTextMuted:  { color: 'rgba(122,115,106,0.6)' },

    card: {
        backgroundColor: '#fffef9', borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.10)', borderRadius: 16, overflow: 'hidden',
    },
    sep: { height: 1, backgroundColor: 'rgba(42,38,33,0.10)' },

    notesCard: {
        backgroundColor: '#fffef9', borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.10)', borderRadius: 16,
        paddingHorizontal: 16, paddingVertical: 14,
    },
    notesLabel: { fontSize: 10, color: 'rgba(122,115,106,0.4)', letterSpacing: 1.1, marginBottom: 8 },
    notesInput: { ...BASE_TXT, minHeight: 72, lineHeight: 20, padding: 0 },

    deleteButton: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 6, alignSelf: 'center', marginVertical: 12,
    },
    deleteLabel: { fontSize: 14, color: 'rgba(212,24,61,0.6)' },
});
