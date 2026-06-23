import { Router, Request, Response } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { getDayPlan, createDraftPlan, getPlanTasks, generatePlan, NoTemplateError, NoContainerBlocksError, PlanNotFoundError, PlanNotInDraftError } from "../services/dayPlan.service";
import { AgentError } from "../services/planAgent.service";

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

function nowTimeString(utcOffsetMins?: number): string {
    const now = new Date();
    if (utcOffsetMins !== undefined) {
        const localNow = new Date(now.getTime() + utcOffsetMins * 60 * 1000);
        return `${String(localNow.getUTCHours()).padStart(2, '0')}:${String(localNow.getUTCMinutes()).padStart(2, '0')}`;
    }
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function parseTimezoneOffset(req: Request): number | undefined {
    const header = req.headers['x-timezone-offset'];
    const parsed = typeof header === 'string' ? parseInt(header, 10) : NaN;
    return Number.isInteger(parsed) && parsed >= -720 && parsed <= 840 ? parsed : undefined;
}

router.post("/", authenticate, async (req: Request, res: Response): Promise<void> => {
    const utcOffsetMins = parseTimezoneOffset(req);

    const date = todayDateString(utcOffsetMins);
    const nowHHmm = nowTimeString(utcOffsetMins);

    try {
        const result = await createDraftPlan(req.user!.sub, date, nowHHmm);
        res.status(201).json({ success: true, data: { id: result.id } });
    } catch (error) {
        if (error instanceof NoTemplateError) {
            res.status(400).json({ success: false, error: 'No day template found. Please set up your day template first.' });
            return;
        }
        if (error instanceof NoContainerBlocksError) {
            res.status(400).json({ success: false, error: 'No time blocks remain for today — all your available blocks have passed.' });
            return;
        }
        throw error;
    }
});

router.get("/", authenticate, async (req: Request, res: Response): Promise<void> => {
    res.set("Cache-Control", "no-store, private");

    const dateParam = req.query.date;

    if (dateParam !== undefined && (typeof dateParam !== "string" || !dateRegex.test(dateParam))) {
        res.status(400).json({ success: false, error: "date must be a valid YYYY-MM-DD string" });
        return;
    }

    const utcOffsetMins = parseTimezoneOffset(req);

    const date = dateParam ?? todayDateString(utcOffsetMins);

    const plan = await getDayPlan(req.user!.sub, date);

    if (!plan) {
        res.status(404).json({ success: false, error: "No plan found for this date" });
        return;
    }

    res.status(200).json({ success: true, data: plan });
});

router.get("/:id/tasks", authenticate, async (req: Request, res: Response): Promise<void> => {
    res.set("Cache-Control", "no-store, private");
    try {
        const result = await getPlanTasks(req.user!.sub, req.params.id as string);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        if (error instanceof PlanNotFoundError) {
            res.status(404).json({ success: false, error: 'Plan not found' });
            return;
        }
        throw error;
    }
});

router.post("/:id/generate", authenticate, async (req: Request, res: Response): Promise<void> => {
    res.set("Cache-Control", "no-store, private");
    try {
        const result = await generatePlan(req.user!.sub, req.params.id as string);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        if (error instanceof PlanNotFoundError) {
            res.status(404).json({ success: false, error: 'Plan not found' });
            return;
        }
        if (error instanceof PlanNotInDraftError) {
            res.status(409).json({ success: false, error: 'Plan is not a draft and cannot be generated' });
            return;
        }
        if (error instanceof AgentError) {
            res.status(502).json({ success: false, error: 'The planning agent could not generate a plan. Please try again.' });
            return;
        }
        throw error;
    }
});

export default router;
