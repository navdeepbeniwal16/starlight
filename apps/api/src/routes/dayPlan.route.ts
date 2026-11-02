import { Router, Request, Response } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { getDayPlan, getReviewTasks, generatePlanProposal, confirmPlan, NoContainerBlocksError, InvalidPlacementError } from "../services/dayPlan.service";
import { DayTemplateNotFoundError } from "../services/dayTemplate.service";
import { DayShapeValidationError } from "../services/dayTemplate.validator";
import { AgentError } from "../services/planAgent.service";
import type { ConfirmPlan } from "../types/dayPlan.types";
import type { DayShape } from "../types/dayTemplate.types";
import { dateRegex, todayDateString, nowTimeString, parseTimezoneOffset } from "../lib/clientDate";

const router = Router();

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

router.get("/review-tasks", authenticate, async (req: Request, res: Response): Promise<void> => {
    res.set("Cache-Control", "no-store, private");

    const utcOffsetMins = parseTimezoneOffset(req);
    const date = todayDateString(utcOffsetMins);

    const result = await getReviewTasks(req.user!.sub, date);
    res.status(200).json({ success: true, data: result });
});

// Generates a plan proposal and returns it (Nothing is persisted)
router.post("/generate", authenticate, async (req: Request, res: Response): Promise<void> => {
    res.set("Cache-Control", "no-store, private");

    const { templateId, shape } = (req.body ?? {}) as { templateId?: unknown; shape?: unknown };
    if (typeof templateId !== 'string') {
        res.status(400).json({ success: false, error: 'templateId is required' });
        return;
    }
    if (!shape || typeof shape !== 'object' || Array.isArray(shape)) {
        res.status(400).json({ success: false, error: 'shape is required' });
        return;
    }

    const utcOffsetMins = parseTimezoneOffset(req);
    const date = todayDateString(utcOffsetMins);
    const nowHHmm = nowTimeString(utcOffsetMins);
    const now = new Date().toISOString();

    try {
        const result = await generatePlanProposal(req.user!.sub, date, nowHHmm, now, templateId, shape as DayShape);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        if (error instanceof DayShapeValidationError) {
            res.status(400).json({ success: false, error: error.message });
            return;
        }
        if (error instanceof DayTemplateNotFoundError) {
            res.status(404).json({ success: false, error: 'Day template not found' });
            return;
        }
        if (error instanceof NoContainerBlocksError) {
            res.status(400).json({ success: false, code: 'NO_CONTAINER_BLOCKS', error: 'No time blocks remain for today — all your available blocks have passed.' });
            return;
        }
        if (error instanceof AgentError) {
            res.status(502).json({ success: false, code: 'AGENT_ERROR', error: 'The planning agent could not generate a plan. Please try again.' });
            return;
        }
        throw error;
    }
});

router.post("/confirm", authenticate, async (req: Request, res: Response): Promise<void> => {
    res.set("Cache-Control", "no-store, private");

    const { templateId, plan } = (req.body ?? {}) as { templateId?: unknown; plan?: unknown };
    if (typeof templateId !== 'string') {
        res.status(400).json({ success: false, error: 'templateId is required' });
        return;
    }
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
        res.status(400).json({ success: false, error: 'plan is required' });
        return;
    }

    const utcOffsetMins = parseTimezoneOffset(req);
    const date = todayDateString(utcOffsetMins);
    const nowHHmm = nowTimeString(utcOffsetMins);

    try {
        const result = await confirmPlan(req.user!.sub, date, nowHHmm, templateId, plan as ConfirmPlan);
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        if (error instanceof DayShapeValidationError) {
            res.status(400).json({ success: false, error: error.message });
            return;
        }
        if (error instanceof DayTemplateNotFoundError) {
            res.status(404).json({ success: false, error: 'Day template not found' });
            return;
        }
        if (error instanceof InvalidPlacementError) {
            res.status(400).json({ success: false, error: 'A task is placed on a block that cannot hold tasks, or the same task appears more than once' });
            return;
        }
        throw error;
    }
});

export default router;
