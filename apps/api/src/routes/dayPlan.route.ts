import { Router, Request, Response } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { getDayPlan } from "../services/dayPlan.service";

const router = Router();

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

// Accepts an optional UTC offset in minutes via X-Timezone-Offset header
// (e.g. +600 for UTC+10, -300 for UTC-5). Falls back to server local time
// if the header is absent or out of the valid timezone range [-720, 840].
function todayDateString(utcOffsetMins?: number): string {
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

router.get("/", authenticate, async (req: Request, res: Response): Promise<void> => {
    res.set("Cache-Control", "no-store, private");

    const dateParam = req.query.date;

    if (dateParam !== undefined && (typeof dateParam !== "string" || !dateRegex.test(dateParam))) {
        res.status(400).json({ success: false, error: "date must be a valid YYYY-MM-DD string" });
        return;
    }

    const offsetHeader = req.headers['x-timezone-offset'];
    const parsedOffset = typeof offsetHeader === 'string' ? parseInt(offsetHeader, 10) : NaN;
    const utcOffsetMins = Number.isInteger(parsedOffset) && parsedOffset >= -720 && parsedOffset <= 840
        ? parsedOffset
        : undefined;

    const date = dateParam ?? todayDateString(utcOffsetMins);

    const plan = await getDayPlan(req.user!.sub, date);

    if (!plan) {
        res.status(404).json({ success: false, error: "No plan found for this date" });
        return;
    }

    res.status(200).json({ success: true, data: plan });
});

export default router;
