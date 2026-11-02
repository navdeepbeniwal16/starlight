import { Router, Request, Response } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import {
    listDayTemplates,
    getDayTemplateById,
    createDayTemplate,
    updateDayTemplate,
    deleteDayTemplate,
    DayTemplateNotFoundError,
    DuplicateTemplateNameError,
    CannotDeleteLastTemplateError,
} from "../services/dayTemplate.service";
import { DayTemplateValidationError } from "../services/dayTemplate.validator";
import { BlockInput } from "../types/dayTemplate.types";

const router = Router();

type ParsedTemplateBody =
    | { ok: true; name: string; wakeTime: string; sleepTime: string; blocks: BlockInput[] }
    | { ok: false; error: string };

// Structural shape guards for a template write payload. Since name bounds/uniqueness
// are the service's job; here we only assert the fields are present and typed.
function parseTemplateBody(body: unknown): ParsedTemplateBody {
    if (!body || typeof body !== "object") {
        return { ok: false, error: "Request body is required" };
    }

    const { name, wakeTime, sleepTime, blocks } = body as Record<string, unknown>;

    if (typeof name !== "string") {
        return { ok: false, error: "name must be a string" };
    }

    if (typeof wakeTime !== "string" || typeof sleepTime !== "string") {
        return { ok: false, error: "wakeTime and sleepTime must be strings" };
    }

    if (!Array.isArray(blocks) || blocks.length === 0) {
        return { ok: false, error: "blocks must be a non-empty array" };
    }

    const parsedBlocks: BlockInput[] = [];
    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (!block || typeof block !== "object") {
            return { ok: false, error: `Block at index ${i} is malformed` };
        }
        const { type, name: blockName, startTime, endTime, energyLevel } = block as Record<string, unknown>;
        if (
            typeof type !== "string" ||
            typeof blockName !== "string" ||
            typeof startTime !== "string" ||
            typeof endTime !== "string" ||
            (energyLevel !== undefined && typeof energyLevel !== "string")
        ) {
            return { ok: false, error: `Block at index ${i} is malformed` };
        }
        // Enum validity (BlockType/EnergyLevel) is the validator's job; client-sent block ids are dropped.
        parsedBlocks.push({
            type: type as BlockInput["type"],
            name: blockName.trim(),
            startTime,
            endTime,
            energyLevel: energyLevel as BlockInput["energyLevel"],
        });
    }

    return { ok: true, name, wakeTime, sleepTime, blocks: parsedBlocks };
}

router.get("/", authenticate, async (req: Request, res: Response): Promise<void> => {
    const templates = await listDayTemplates(req.user!.sub);
    res.status(200).json({ success: true, data: templates });
});

router.get("/:id", authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        const template = await getDayTemplateById(req.user!.sub, req.params.id as string);
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
            name: parsed.name,
            wakeTime: parsed.wakeTime,
            sleepTime: parsed.sleepTime,
            blocks: parsed.blocks,
        });
        res.status(201).json({ success: true, data: template });
    } catch (error) {
        if (error instanceof DayTemplateValidationError) {
            res.status(400).json({ success: false, error: error.message });
            return;
        }
        if (error instanceof DuplicateTemplateNameError) {
            res.status(409).json({ success: false, error: "You already have a template with that name" });
            return;
        }
        throw error;
    }
});

router.patch("/:id", authenticate, async (req: Request, res: Response): Promise<void> => {
    const parsed = parseTemplateBody(req.body);
    if (!parsed.ok) {
        res.status(400).json({ success: false, error: parsed.error });
        return;
    }

    try {
        const template = await updateDayTemplate({
            userId: req.user!.sub,
            id: req.params.id as string,
            name: parsed.name,
            wakeTime: parsed.wakeTime,
            sleepTime: parsed.sleepTime,
            blocks: parsed.blocks,
        });
        res.status(200).json({ success: true, data: template });
    } catch (error) {
        if (error instanceof DayTemplateNotFoundError) {
            res.status(404).json({ success: false, error: "Day template not found" });
            return;
        }
        if (error instanceof DayTemplateValidationError) {
            res.status(400).json({ success: false, error: error.message });
            return;
        }
        if (error instanceof DuplicateTemplateNameError) {
            res.status(409).json({ success: false, error: "You already have a template with that name" });
            return;
        }
        throw error;
    }
});

router.delete("/:id", authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        await deleteDayTemplate(req.user!.sub, req.params.id as string);
        res.status(204).send();
    } catch (error) {
        // Delete is idempotent: a missing or not-owned template is already in the
        // caller's desired end state, so report the no-op as success rather than 404.
        if (error instanceof DayTemplateNotFoundError) {
            res.status(204).send();
            return;
        }
        if (error instanceof CannotDeleteLastTemplateError) {
            res.status(409).json({ success: false, error: "You can't delete your only day template" });
            return;
        }
        throw error;
    }
});

export default router;
