import { useState, useEffect, useRef, useMemo } from "react";
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    PanResponder,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import type { Priority, EnergyLevel } from "../lib/api.types";

// ─── Constants ────────────────────────────────────────────────────────────────

export const ESTIMATE_OPTIONS = [
    { label: '15m', value: 15 },
    { label: '30m', value: 30 },
    { label: '45m', value: 45 },
    { label: '1h',  value: 60 },
    { label: '1.5h', value: 90 },
    { label: '2h',  value: 120 },
    { label: '3h',  value: 180 },
    { label: '4h+', value: 240 },
];

export const PROGRESS_PRESETS = [0, 25, 50, 75, 100];

export const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const MONTHS_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const WEEKDAYS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

export function defaultTime(): Date {
    const d = new Date(); d.setHours(23, 59, 0, 0); return d;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function getEstimateLabel(mins: number): string {
    return ESTIMATE_OPTIONS.find(o => o.value === mins)?.label ?? `${mins}m`;
}

export function fmt12(date: Date): string {
    const h = date.getHours(), m = date.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function formatDeadlineValue(day: Date, time: Date): string {
    return `${MONTHS_SHORT[day.getMonth()]} ${day.getDate()}, ${fmt12(time)}`;
}

export function priorityDotColor(p: Priority): string {
    return p === 'HIGH' ? '#d4a574' : p === 'MEDIUM' ? '#7a736a' : 'rgba(122,115,106,0.35)';
}

// ─── CalendarPicker ───────────────────────────────────────────────────────────

export function CalendarPicker({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
    const [viewDate, setViewDate] = useState(() => new Date(value.getFullYear(), value.getMonth(), 1));
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();

    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth  = new Date(year, month + 1, 0).getDate();
    const today = useMemo(() => new Date(), []);

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
            <View style={cal.weekRow}>
                {WEEKDAYS.map(d => <Text key={d} style={cal.weekday}>{d}</Text>)}
            </View>
            {weeks.map((wk, wi) => (
                <View key={wi} style={cal.weekRow}>
                    {wk.map((day, di) => {
                        if (!day) return <View key={`e${wi}-${di}`} style={cal.cell} />;
                        const isToday    = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
                        const isSelected = day === value.getDate() && month === value.getMonth() && year === value.getFullYear();
                        return (
                            <TouchableOpacity key={day} style={cal.cell} onPress={() => onChange(new Date(year, month, day))} activeOpacity={0.7}>
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

// ─── DeadlineExpanded ─────────────────────────────────────────────────────────

export function DeadlineExpanded({
    tempDay, onDayChange,
    deadlineTime, onTimeChange,
    showTimePicker, onToggleTimePicker,
    onConfirm, onClear, hasDeadline,
}: {
    tempDay: Date;
    onDayChange: (d: Date) => void;
    deadlineTime: Date;
    onTimeChange: (d: Date) => void;
    showTimePicker: boolean;
    onToggleTimePicker: () => void;
    onConfirm: () => void;
    onClear: () => void;
    hasDeadline: boolean;
}) {
    return (
        <View style={tf.deadlineSection}>
            <CalendarPicker value={tempDay} onChange={onDayChange} />
            <TouchableOpacity style={tf.timeRow} onPress={onToggleTimePicker} activeOpacity={0.7}>
                <View style={tf.timeLeft}>
                    <Ionicons name="time-outline" size={14} color="rgba(122,115,106,0.5)" />
                    <Text style={tf.timeLabel}>Time</Text>
                </View>
                <View style={tf.timeRight}>
                    <Text style={tf.timeValue}>{fmt12(deadlineTime)}</Text>
                    <Ionicons name={showTimePicker ? 'chevron-up' : 'chevron-down'} size={13} color="rgba(122,115,106,0.4)" />
                </View>
            </TouchableOpacity>
            {showTimePicker && (
                <View style={tf.spinnerWrap}>
                    <DateTimePicker
                        value={deadlineTime}
                        mode="time"
                        display="spinner"
                        onChange={(_, d) => { if (d) onTimeChange(d); }}
                        themeVariant="light"
                    />
                </View>
            )}
            <View style={tf.deadlineActions}>
                <TouchableOpacity style={tf.setBtn} onPress={onConfirm} activeOpacity={0.8}>
                    <Text style={tf.setBtnTxt}>Set deadline</Text>
                </TouchableOpacity>
                {hasDeadline && (
                    <TouchableOpacity onPress={onClear}>
                        <Text style={tf.clearTxt}>Clear deadline</Text>
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );
}

// ─── ProgressSlider ───────────────────────────────────────────────────────────

const THUMB = 20;

function calcPct(x: number, trackWidth: number): number {
    if (trackWidth === 0) return 0;
    return Math.round(Math.min(100, Math.max(0, (x / trackWidth) * 100)));
}

export function ProgressSlider({ value, onChange, onRelease }: {
    value: number;
    onChange: (v: number) => void;
    onRelease?: (v: number) => void;
}) {
    const [local, setLocal] = useState(value);
    const [trackWidth, setTrackWidth] = useState(0);
    const trackWidthRef  = useRef(0);
    const startPctRef    = useRef(0);
    const isDraggingRef  = useRef(false);
    const onChangeRef    = useRef(onChange);
    const onReleaseRef   = useRef(onRelease);
    useEffect(() => { onChangeRef.current = onChange; });
    useEffect(() => { onReleaseRef.current = onRelease; });
    useEffect(() => { if (!isDraggingRef.current) setLocal(value); }, [value]);

    const pan = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder:  () => true,
            onPanResponderGrant: (evt) => {
                isDraggingRef.current = true;
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
                isDraggingRef.current = false;
                const deltaPct = (gestureState.dx / trackWidthRef.current) * 100;
                const pct = Math.round(Math.min(100, Math.max(0, startPctRef.current + deltaPct)));
                setLocal(pct);
                onChangeRef.current(pct);
                onReleaseRef.current?.(pct);
            },
            onPanResponderTerminate: () => {
                isDraggingRef.current = false;
            },
        })
    ).current;

    const thumbLeft = trackWidth > 0 ? (local / 100) * (trackWidth - THUMB) : 0;

    return (
        <View
            style={sl.root}
            onLayout={e => {
                const w = e.nativeEvent.layout.width;
                trackWidthRef.current = w;
                setTrackWidth(w);
            }}
            {...pan.panHandlers}
        >
            <View style={sl.track} pointerEvents="none">
                <View style={[sl.fill, { width: `${local}%` as `${number}%` }]} />
            </View>
            <View style={[sl.thumb, { left: thumbLeft }]} pointerEvents="none" />
        </View>
    );
}

// ─── FieldRow ─────────────────────────────────────────────────────────────────

export function FieldRow({ label, subLabel, value, isOpen, onPress }: {
    label: string; subLabel?: string; value: string; isOpen: boolean; onPress: () => void;
}) {
    const isSet = value !== 'Not set';
    return (
        <TouchableOpacity style={tf.fieldRow} onPress={onPress} activeOpacity={0.7}>
            <View>
                <Text style={tf.fieldLabel}>{label}</Text>
                {subLabel ? <Text style={tf.fieldSub}>{subLabel}</Text> : null}
            </View>
            <View style={tf.fieldRight}>
                <Text style={isSet ? tf.fieldValSet : tf.fieldValUnset}>{value}</Text>
                <Ionicons name={isOpen ? 'chevron-down' : 'chevron-forward'} size={13} color="rgba(122,115,106,0.4)" />
            </View>
        </TouchableOpacity>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const BASE_TXT: { fontSize: number; color: string } = { fontSize: 14, color: '#2a2621' };

export const tf = StyleSheet.create({
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

    deadlineSection: {
        marginHorizontal: 12, marginTop: 4, marginBottom: 12,
        borderRadius: 12, borderWidth: 1,
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
    spinnerWrap: { height: 130, overflow: 'hidden', borderTopWidth: 1, borderTopColor: 'rgba(42,38,33,0.06)' },
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

    progressSection: { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 6 },
    progressPresets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 },
});

export const sl = StyleSheet.create({
    root: { height: 44, justifyContent: 'center' },
    track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(42,38,33,0.1)', overflow: 'hidden' },
    fill: { height: 4, backgroundColor: '#d4a574', borderRadius: 2 },
    thumb: {
        position: 'absolute', left: 0, top: (44 - THUMB) / 2,
        width: THUMB, height: THUMB, borderRadius: THUMB / 2,
        backgroundColor: '#2a2621',
        shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.15, shadowRadius: 3, elevation: 2,
    },
});

export const cal = StyleSheet.create({
    root: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 10 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
    monthTitle: { fontSize: 14, fontWeight: '600', color: '#2a2621', letterSpacing: -0.1 },
    navRow: { flexDirection: 'row', gap: 4 },
    navBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(42,38,33,0.05)', justifyContent: 'center', alignItems: 'center' },
    weekRow: { flexDirection: 'row', marginBottom: 2 },
    weekday: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '500', color: 'rgba(122,115,106,0.5)', letterSpacing: 0.3, marginBottom: 4 },
    cell: { flex: 1, aspectRatio: 1, justifyContent: 'center', alignItems: 'center' },
    circle: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
    circleToday: { backgroundColor: 'rgba(212,165,116,0.18)' },
    circleSelected: { backgroundColor: '#2a2621' },
    dateNum: { fontSize: 13, color: '#2a2621' },
    dateNumToday: { color: '#d4a574', fontWeight: '600' },
    dateNumSelected: { color: '#fdfcfa', fontWeight: '600' },
});
