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
