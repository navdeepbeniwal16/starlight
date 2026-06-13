import { useState, useEffect, useRef, useMemo } from "react";
import {
    Modal,
    View,
    Text,
    TextInput,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    PanResponder,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { api } from "../lib/api";
import type { BacklogTask, Priority, EnergyLevel } from "../lib/api.types";

// ─── Constants ────────────────────────────────────────────────────────────────

const ESTIMATE_OPTIONS = [
    { label: '15m', value: 15 },
    { label: '30m', value: 30 },
    { label: '45m', value: 45 },
    { label: '1h',  value: 60 },
    { label: '1.5h', value: 90 },
    { label: '2h',  value: 120 },
    { label: '3h',  value: 180 },
    { label: '4h+', value: 240 },
];

const PROGRESS_PRESETS = [0, 25, 50, 75, 100];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

function defaultTime(): Date {
    const d = new Date(); d.setHours(23, 59, 0, 0); return d;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getEstimateLabel(mins: number): string {
    return ESTIMATE_OPTIONS.find(o => o.value === mins)?.label ?? `${mins}m`;
}

function fmt12(date: Date): string {
    const h = date.getHours(), m = date.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatDeadlineValue(day: Date, time: Date): string {
    return `${MONTHS_SHORT[day.getMonth()]} ${day.getDate()}, ${fmt12(time)}`;
}

function priorityDotColor(p: Priority): string {
    return p === 'HIGH' ? '#d4a574' : p === 'MEDIUM' ? '#7a736a' : 'rgba(122,115,106,0.35)';
}

// ─── Custom Calendar ──────────────────────────────────────────────────────────

function CalendarPicker({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
    const [viewDate, setViewDate] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1));
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();

    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth  = new Date(year, month + 1, 0).getDate();
    // Computed once on mount so the highlight doesn't drift if the modal stays open past midnight
    const today = useMemo(() => new Date(), []);

    // Build week rows
    const weeks: (number | null)[][] = [];
    let week: (number | null)[] = Array(firstWeekday).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
        week.push(d);
        if (week.length === 7) { weeks.push(week); week = []; }
    }
    if (week.length > 0) {
        while (week.length < 7) week.push(null);
        weeks.push(week);
    }

    function prev() { setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1)); }
    function next() { setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1)); }

    return (
        <View style={cal.root}>
            {/* Month nav */}
            <View style={cal.header}>
                <Text style={cal.monthTitle}>{MONTHS_FULL[month]} {year}</Text>
                <View style={cal.navRow}>
                    <TouchableOpacity style={cal.navBtn} onPress={prev} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Ionicons name="chevron-back" size={14} color="#7a736a" />
                    </TouchableOpacity>
                    <TouchableOpacity style={cal.navBtn} onPress={next} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Ionicons name="chevron-forward" size={14} color="#7a736a" />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Weekday labels */}
            <View style={cal.weekRow}>
                {WEEKDAYS.map(d => <Text key={d} style={cal.weekday}>{d}</Text>)}
            </View>

            {/* Date grid */}
            {weeks.map((wk, wi) => (
                <View key={wi} style={cal.weekRow}>
                    {wk.map((day, di) => {
                        if (!day) return <View key={`e${wi}-${di}`} style={cal.cell} />;
                        const isToday    = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
                        const isSelected = day === value.getDate() && month === value.getMonth() && year === value.getFullYear();
                        return (
                            <TouchableOpacity
                                key={day}
                                style={cal.cell}
                                onPress={() => onChange(new Date(year, month, day))}
                                activeOpacity={0.7}
                            >
                                <View style={[cal.circle, isSelected && cal.circleSelected, isToday && !isSelected && cal.circleToday]}>
                                    <Text style={[cal.dateNum, isSelected && cal.dateNumSelected, isToday && !isSelected && cal.dateNumToday]}>
                                        {day}
                                    </Text>
                                </View>
                            </TouchableOpacity>
                        );
                    })}
                </View>
            ))}
        </View>
    );
}

// ─── Custom Progress Slider ───────────────────────────────────────────────────

const THUMB = 20;

function calcPct(x: number, trackWidth: number): number {
    if (trackWidth === 0) return 0;
    return Math.round(Math.min(100, Math.max(0, (x / trackWidth) * 100)));
}

function ProgressSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    const [local, setLocal] = useState(value);
    const trackWidthRef  = useRef(0);
    const startPctRef    = useRef(0);
    const onChangeRef    = useRef(onChange);
    useEffect(() => { onChangeRef.current = onChange; });
    useEffect(() => { setLocal(value); }, [value]);

    // PanResponder created once — re-renders never drop the active gesture.
    // Moves use gestureState.dx (delta from grant point) instead of locationX,
    // because locationX resets to the child view's coordinate space as the
    // finger passes over the fill/thumb boundaries, causing position jumps.
    const pan = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder:  () => true,
            onPanResponderGrant: (evt) => {
                const pct = calcPct(evt.nativeEvent.locationX, trackWidthRef.current);
                startPctRef.current = pct;
                setLocal(pct);
                onChangeRef.current(pct);
            },
            onPanResponderMove: (_, gestureState) => {
                const deltaPct = (gestureState.dx / trackWidthRef.current) * 100;
                const pct = Math.round(Math.min(100, Math.max(0, startPctRef.current + deltaPct)));
                setLocal(pct);
                onChangeRef.current(pct);
            },
            onPanResponderRelease: (_, gestureState) => {
                const deltaPct = (gestureState.dx / trackWidthRef.current) * 100;
                const pct = Math.round(Math.min(100, Math.max(0, startPctRef.current + deltaPct)));
                setLocal(pct);
                onChangeRef.current(pct);
            },
        })
    ).current;

    const thumbLeft = trackWidthRef.current > 0
        ? (local / 100) * (trackWidthRef.current - THUMB)
        : 0;

    return (
        <View
            style={sl.root}
            onLayout={e => { trackWidthRef.current = e.nativeEvent.layout.width; }}
            {...pan.panHandlers}
        >
            <View style={sl.track} pointerEvents="none">
                <View style={[sl.fill, { width: `${local}%` as `${number}%` }]} />
            </View>
            <View style={[sl.thumb, { left: thumbLeft }]} pointerEvents="none" />
        </View>
    );
}

const sl = StyleSheet.create({
    root: { height: 44, justifyContent: 'center' },
    track: {
        height: 4, borderRadius: 2,
        backgroundColor: 'rgba(42,38,33,0.1)',
        overflow: 'hidden',
    },
    fill: { height: 4, backgroundColor: '#d4a574', borderRadius: 2 },
    thumb: {
        position: 'absolute',
        left: 0,
        top: (44 - THUMB) / 2,
        width: THUMB, height: THUMB, borderRadius: THUMB / 2,
        backgroundColor: '#2a2621',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.15,
        shadowRadius: 3,
        elevation: 2,
    },
});

// ─── FieldRow ─────────────────────────────────────────────────────────────────

type FieldKey = 'estimate' | 'priority' | 'effort' | 'deadline' | 'progress';

function FieldRow({ label, subLabel, value, isOpen, onPress }: {
    label: string; subLabel?: string; value: string; isOpen: boolean; onPress: () => void;
}) {
    const isSet = value !== 'Not set';
    return (
        <TouchableOpacity style={s.fieldRow} onPress={onPress} activeOpacity={0.7}>
            <View>
                <Text style={s.fieldLabel}>{label}</Text>
                {subLabel ? <Text style={s.fieldSub}>{subLabel}</Text> : null}
            </View>
            <View style={s.fieldRight}>
                <Text style={isSet ? s.fieldValSet : s.fieldValUnset}>{value}</Text>
                <Ionicons name={isOpen ? 'chevron-down' : 'chevron-forward'} size={13} color="rgba(122,115,106,0.4)" />
            </View>
        </TouchableOpacity>
    );
}

// ─── Types ───────────────────────────────────────────────────────────────────

type Props = { visible: boolean; onClose: () => void; onCreated: (task: BacklogTask) => void; };

// ─── Component ───────────────────────────────────────────────────────────────

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

                {/* Header */}
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
                    {/* Title */}
                    <TextInput
                        style={[s.titleInput, titleError && s.titleInputError]}
                        placeholder="What needs to be done?"
                        placeholderTextColor="rgba(122,115,106,0.3)"
                        value={title}
                        onChangeText={(t) => { setTitle(t); if (t.trim()) setTitleError(false); }}
                        autoFocus multiline blurOnSubmit returnKeyType="done"
                    />
                    {titleError && <Text style={s.inlineError}>Title is required</Text>}

                    {/* Fields */}
                    <View style={s.card}>

                        {/* Estimate */}
                        <FieldRow
                            label="Estimate" subLabel="Required for scheduling"
                            value={estimatedMins !== null ? getEstimateLabel(estimatedMins) : 'Not set'}
                            isOpen={activeField === 'estimate'}
                            onPress={() => toggleField('estimate')}
                        />
                        {activeField === 'estimate' && (
                            <View style={s.pills}>
                                {ESTIMATE_OPTIONS.map(o => (
                                    <TouchableOpacity
                                        key={o.value}
                                        style={[s.pill, estimatedMins === o.value && s.pillOn]}
                                        onPress={() => { setEstimatedMins(o.value); setActiveField(null); }}
                                    >
                                        <Text style={[s.pillTxt, estimatedMins === o.value && s.pillTxtOn]}>{o.label}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        )}

                        <View style={s.sep} />

                        {/* Priority */}
                        <FieldRow
                            label="Priority"
                            value={priority ? priority.charAt(0) + priority.slice(1).toLowerCase() : 'Not set'}
                            isOpen={activeField === 'priority'}
                            onPress={() => toggleField('priority')}
                        />
                        {activeField === 'priority' && (
                            <View style={s.pills}>
                                {(['HIGH','MEDIUM','LOW'] as Priority[]).map(p => (
                                    <TouchableOpacity
                                        key={p}
                                        style={[s.pill, priority === p && s.pillOn]}
                                        onPress={() => { setPriority(p); setActiveField(null); }}
                                    >
                                        <View style={[s.dot, { backgroundColor: priorityDotColor(p) }]} />
                                        <Text style={[s.pillTxt, priority === p && s.pillTxtOn]}>
                                            {p.charAt(0) + p.slice(1).toLowerCase()}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                                {priority !== null && (
                                    <TouchableOpacity
                                        style={s.pill}
                                        onPress={() => { setPriority(null); setActiveField(null); }}
                                    >
                                        <Text style={s.pillTxt}>Clear</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        )}

                        <View style={s.sep} />

                        {/* Effort */}
                        <FieldRow
                            label="Effort" subLabel="Est. energy required"
                            value={effort ? effort.charAt(0) + effort.slice(1).toLowerCase() : 'Not set'}
                            isOpen={activeField === 'effort'}
                            onPress={() => toggleField('effort')}
                        />
                        {activeField === 'effort' && (
                            <View style={s.pills}>
                                {(['HIGH','MEDIUM','LOW'] as EnergyLevel[]).map(e => (
                                    <TouchableOpacity
                                        key={e}
                                        style={[s.pill, effort === e && s.pillOn]}
                                        onPress={() => { setEffort(e); setActiveField(null); }}
                                    >
                                        <Text style={[s.pillTxt, effort === e && s.pillTxtOn]}>
                                            {e.charAt(0) + e.slice(1).toLowerCase()}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                                {effort !== null && (
                                    <TouchableOpacity
                                        style={s.pill}
                                        onPress={() => { setEffort(null); setActiveField(null); }}
                                    >
                                        <Text style={s.pillTxt}>Clear</Text>
                                    </TouchableOpacity>
                                )}
                            </View>
                        )}

                        <View style={s.sep} />

                        {/* Deadline */}
                        <FieldRow
                            label="Deadline"
                            value={deadlineDay ? formatDeadlineValue(deadlineDay, deadlineTime) : 'Not set'}
                            isOpen={activeField === 'deadline'}
                            onPress={() => toggleField('deadline')}
                        />
                        {activeField === 'deadline' && (
                            <View style={s.deadlineSection}>
                                <CalendarPicker value={tempDay} onChange={setTempDay} />
                                <TouchableOpacity style={s.timeRow} onPress={() => setShowTimePicker(v => !v)} activeOpacity={0.7}>
                                    <View style={s.timeLeft}>
                                        <Ionicons name="time-outline" size={14} color="rgba(122,115,106,0.5)" />
                                        <Text style={s.timeLabel}>Time</Text>
                                    </View>
                                    <View style={s.timeRight}>
                                        <Text style={s.timeValue}>{fmt12(deadlineTime)}</Text>
                                        <Ionicons name={showTimePicker ? 'chevron-up' : 'chevron-down'} size={13} color="rgba(122,115,106,0.4)" />
                                    </View>
                                </TouchableOpacity>
                                {showTimePicker && (
                                    <View style={s.spinnerWrap}>
                                        <DateTimePicker
                                            value={deadlineTime}
                                            mode="time"
                                            display="spinner"
                                            onChange={(_, d) => { if (d) setDeadlineTime(d); }}
                                            themeVariant="light"
                                        />
                                    </View>
                                )}
                                <View style={s.deadlineActions}>
                                    <TouchableOpacity
                                        style={s.setBtn}
                                        onPress={() => { setDeadlineDay(tempDay); setActiveField(null); }}
                                        activeOpacity={0.8}
                                    >
                                        <Text style={s.setBtnTxt}>Set deadline</Text>
                                    </TouchableOpacity>
                                    {deadlineDay && (
                                        <TouchableOpacity onPress={() => { setDeadlineDay(null); setActiveField(null); }}>
                                            <Text style={s.clearTxt}>Clear deadline</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            </View>
                        )}

                        <View style={s.sep} />

                        {/* Progress */}
                        <FieldRow
                            label="Progress" value={`${progress}%`}
                            isOpen={activeField === 'progress'}
                            onPress={() => toggleField('progress')}
                        />
                        {activeField === 'progress' && (
                            <View style={s.progressSection}>
                                <ProgressSlider value={progress} onChange={setProgress} />
                                <View style={s.progressPresets}>
                                    {PROGRESS_PRESETS.map(val => (
                                        <TouchableOpacity
                                            key={val}
                                            style={[s.pill, progress === val && s.pillOn]}
                                            onPress={() => setProgress(val)}
                                        >
                                            <Text style={[s.pillTxt, progress === val && s.pillTxtOn]}>{val}%</Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </View>
                        )}

                    </View>

                    {/* Notes — always visible */}
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

// ─── Styles ───────────────────────────────────────────────────────────────────

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

    fieldRow: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingVertical: 13,
    },
    fieldLabel: { ...BASE_TXT, fontWeight: '500' },
    fieldSub: { fontSize: 11, color: 'rgba(122,115,106,0.5)', marginTop: 2 },
    fieldRight: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    fieldValSet: { ...BASE_TXT, fontWeight: '500' },
    fieldValUnset: { ...BASE_TXT, color: 'rgba(122,115,106,0.45)', fontStyle: 'italic' },

    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, paddingBottom: 14, paddingTop: 2 },
    pill: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: 'rgba(42,38,33,0.06)',
        borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, gap: 6,
    },
    pillOn: { backgroundColor: '#2a2621' },
    pillTxt: { ...BASE_TXT },
    pillTxtOn: { color: '#fdfcfa' },
    dot: { width: 7, height: 7, borderRadius: 3.5 },

    // Deadline
    deadlineSection: {
        marginHorizontal: 12,
        marginTop: 4,
        marginBottom: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(42,38,33,0.06)',
        backgroundColor: 'rgba(245,243,239,0.5)',
        overflow: 'hidden',
    },
    timeRow: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 14, paddingVertical: 10,
        borderTopWidth: 1, borderTopColor: 'rgba(42,38,33,0.06)',
    },
    timeLeft: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    timeLabel: { ...BASE_TXT, color: 'rgba(122,115,106,0.7)' },
    timeRight: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    timeValue: { ...BASE_TXT, fontWeight: '500' },
    spinnerWrap: {
        height: 130,
        overflow: 'hidden',
        borderTopWidth: 1,
        borderTopColor: 'rgba(42,38,33,0.06)',
    },
    deadlineActions: {
        paddingHorizontal: 14, paddingTop: 10, paddingBottom: 14,
        gap: 10, alignItems: 'center',
        borderTopWidth: 1, borderTopColor: 'rgba(42,38,33,0.06)',
    },
    setBtn: {
        backgroundColor: '#2a2621', borderRadius: 12, height: 42,
        alignSelf: 'stretch', justifyContent: 'center', alignItems: 'center',
    },
    setBtnTxt: { ...BASE_TXT, fontWeight: '500', color: '#fdfcfa' },
    clearTxt: { fontSize: 13, color: 'rgba(122,115,106,0.5)', textDecorationLine: 'underline' },

    // Progress slider
    progressSection: { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 6 },
    progressPresets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 },

    // Notes
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

// Calendar styles (own namespace)
const cal = StyleSheet.create({
    root: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 10 },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 12,
    },
    monthTitle: { fontSize: 14, fontWeight: '600', color: '#2a2621', letterSpacing: -0.1 },
    navRow: { flexDirection: 'row', gap: 4 },
    navBtn: {
        width: 28, height: 28, borderRadius: 14,
        backgroundColor: 'rgba(42,38,33,0.05)',
        justifyContent: 'center', alignItems: 'center',
    },
    weekRow: { flexDirection: 'row', marginBottom: 2 },
    weekday: {
        flex: 1, textAlign: 'center',
        fontSize: 10, fontWeight: '500',
        color: 'rgba(122,115,106,0.5)',
        letterSpacing: 0.3, marginBottom: 4,
    },
    cell: { flex: 1, aspectRatio: 1, justifyContent: 'center', alignItems: 'center' },
    circle: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
    circleToday: { backgroundColor: 'rgba(212,165,116,0.18)' },
    circleSelected: { backgroundColor: '#2a2621' },
    dateNum: { fontSize: 13, color: '#2a2621' },
    dateNumToday: { color: '#d4a574', fontWeight: '600' },
    dateNumSelected: { color: '#fdfcfa', fontWeight: '600' },
});
