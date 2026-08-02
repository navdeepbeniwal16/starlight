import { Router, Request, Response } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import {
    createDayTemplate,
    getDayTemplate,
    DayTemplateAlreadyExistsError,
    DayTemplateNotFoundError
} from "../services/dayTemplate.service";
import { DayTemplateValidationError } from "../services/dayTemplate.validator";

const router = Router();

router.get("/", authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const template = await getDayTemplate(req.user!.sub);
        res.status(200).json({ success: true, data: template });
    } catch (error) {
        if (error instanceof DayTemplateNotFoundError) {
            res.status(404).json({ success: false, error: "Day template not found" });
            return;
        }

        throw error;
    }
});

router.post("/", authenticate, async (req: Request, res: Response): Promise<void> => {
    if (!req.body || typeof req.body !== "object") {
        res.status(400).json({ success: false, error: "Request body is required" });
        return;
    }

    const { wakeTime, sleepTime, blocks } = req.body;

    // Structural shape guards only — semantic validation lives in validateDayTemplate
    if (typeof wakeTime !== "string" || typeof sleepTime !== "string") {
        res.status(400).json({ success: false, error: "wakeTime and sleepTime must be strings" });
        return;
    }

    if (!Array.isArray(blocks) || blocks.length === 0) {
        res.status(400).json({ success: false, error: "blocks must be a non-empty array" });
        return;
    }

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (
            !block || typeof block !== "object" ||
            typeof block.type !== "string" ||
            typeof block.name !== "string" ||
            typeof block.startTime !== "string" ||
            typeof block.endTime !== "string" ||
            (block.energyLevel !== undefined && typeof block.energyLevel !== "string")
        ) {
            res.status(400).json({ success: false, error: `Block at index ${i} is malformed` });
            return;
        }
    }

    try {
        const template = await createDayTemplate({
            userId: req.user!.sub,
            wakeTime,
            sleepTime,
            blocks: blocks.map((b: any) => ({
                type: b.type,
                name: b.name.trim(),
                startTime: b.startTime,
                endTime: b.endTime,
                energyLevel: b.energyLevel
            }))
        });

        res.status(201).json({ success: true, data: template });
    } catch (error) {
        if (error instanceof DayTemplateValidationError) {
            res.status(400).json({ success: false, error: error.message });
            return;
        }

        if (error instanceof DayTemplateAlreadyExistsError) {
            res.status(409).json({ success: false, error: "A day template already exists for this user" });
            return;
        }

        throw error;
    }
});

export default router;
