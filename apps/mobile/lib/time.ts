export function toMins(hhMm: string): number {
    const [h, m] = hhMm.split(':').map(Number);
    return h * 60 + m;
}

export function toHHmm(date: Date): string {
    return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

export function hhMmToDate(hhMm: string): Date {
    const [h, m] = hhMm.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
}

// Converts minutes since midnight to an "HH:mm" string.
export function fromMins(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

// Formats a minute count as a compact duration: "2h", "45m", or "1h 30m".
export function formatDuration(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
}

// Use when time + period need separate styles (e.g. period in a different colour)
export function parseDisplayTime(hhMm: string): { time: string; period: string } {
    const [h, m] = hhMm.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return { time: `${hour}:${m.toString().padStart(2, '0')}`, period };
}

// Use when the full time is rendered in a single <Text>
export function formatTime(hhMm: string): string {
    const { time, period } = parseDisplayTime(hhMm);
    return `${time} ${period}`;
}

export function formatTimeRange(startHhMm: string, endHhMm: string): string {
    const start = parseDisplayTime(startHhMm);
    const end = parseDisplayTime(endHhMm);
    const startLabel = start.period === end.period ? start.time : `${start.time} ${start.period}`;
    return `${startLabel} – ${end.time} ${end.period}`;
}
