import { Router, Request, Response } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import {
    createDayTemplate,
    updateDayTemplate,
    getDayTemplate,
    DayTemplateAlreadyExistsError,
    DayTemplateNotFoundError
} from "../services/dayTemplate.service";
import { DayTemplateValidationError } from "../services/dayTemplate.validator";
import { BlockInput } from "../types/dayTemplate.types";

const router = Router();

type ParsedTemplateBody =
    | { ok: true; wakeTime: string; sleepTime: string; blocks: BlockInput[] }
    | { ok: false; error: string };

// Structural shape guards for a template write payload.
function parseTemplateBody(body: unknown): ParsedTemplateBody {
    if (!body || typeof body !== "object") {
        return { ok: false, error: "Request body is required" };
    }

    const { wakeTime, sleepTime, blocks } = body as Record<string, unknown>;

    if (typeof wakeTime !== "string" || typeof sleepTime !== "string") {
        return { ok: false, error: "wakeTime and sleepTime must be strings" };
    }

    if (!Array.isArray(blocks) || blocks.length === 0) {
        return { ok: false, error: "blocks must be a non-empty array" };
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
            return { ok: false, error: `Block at index ${i} is malformed` };
        }
    }

    return {
        ok: true,
        wakeTime,
        sleepTime,
        // Client-sent block ids are dropped here.
        blocks: blocks.map((b: any) => ({
            type: b.type,
            name: b.name.trim(),
            startTime: b.startTime,
            endTime: b.endTime,
            energyLevel: b.energyLevel
        }))
    };
}

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
    const parsed = parseTemplateBody(req.body);
    if (!parsed.ok) {
        res.status(400).json({ success: false, error: parsed.error });
        return;
    }

    try {
        const template = await createDayTemplate({
            userId: req.user!.sub,
            wakeTime: parsed.wakeTime,
            sleepTime: parsed.sleepTime,
            blocks: parsed.blocks
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

router.put("/", authenticate, async (req: Request, res: Response): Promise<void> => {
    const parsed = parseTemplateBody(req.body);
    if (!parsed.ok) {
        res.status(400).json({ success: false, error: parsed.error });
        return;
    }

    try {
        const template = await updateDayTemplate({
            userId: req.user!.sub,
            wakeTime: parsed.wakeTime,
            sleepTime: parsed.sleepTime,
            blocks: parsed.blocks
        });

        res.status(200).json({ success: true, data: template });
    } catch (error) {
        if (error instanceof DayTemplateValidationError) {
            res.status(400).json({ success: false, error: error.message });
            return;
        }

        if (error instanceof DayTemplateNotFoundError) {
            res.status(404).json({ success: false, error: "Day template not found" });
            return;
        }

        throw error;
    }
});

export default router;
