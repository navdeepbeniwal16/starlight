import type { Request } from "express";

export const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

// Accepts an optional UTC offset in minutes via X-Timezone-Offset header
// (e.g. +600 for UTC+10, -300 for UTC-5). Falls back to server local time
// if the header is absent or out of the valid timezone range [-720, 840].
export function todayDateString(utcOffsetMins?: number): string {
    const now = new Date();
    if (utcOffsetMins !== undefined) {
        const localNow = new Date(now.getTime() + utcOffsetMins * 60 * 1000);
        const year = localNow.getUTCFullYear();
        const month = String(localNow.getUTCMonth() + 1).padStart(2, "0");
        const day = String(localNow.getUTCDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function nowTimeString(utcOffsetMins?: number): string {
    const now = new Date();
    if (utcOffsetMins !== undefined) {
        const localNow = new Date(now.getTime() + utcOffsetMins * 60 * 1000);
        return `${String(localNow.getUTCHours()).padStart(2, '0')}:${String(localNow.getUTCMinutes()).padStart(2, '0')}`;
    }
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export function parseTimezoneOffset(req: Request): number | undefined {
    const header = req.headers['x-timezone-offset'];
    const parsed = typeof header === 'string' ? parseInt(header, 10) : NaN;
    return Number.isInteger(parsed) && parsed >= -720 && parsed <= 840 ? parsed : undefined;
}
