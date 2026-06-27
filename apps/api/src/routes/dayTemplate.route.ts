import { Router, Request, Response } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import {
    createDayTemplate,
    getDayTemplate,
    BlockOverlapError,
    ContainerBlockNotFoundError,
    DayTemplateAlreadyExistsError,
    DayTemplateNotFoundError,
    OutOfAwakeBoundsError
} from "../services/dayTemplate.service";
import { BlockType, EnergyLevel } from "../types/dayTemplate.types";

const router = Router();

const timeRegex = /^\d{2}:\d{2}$/;
const validBlockTypes = Object.values(BlockType);
const validEnergyLevels = Object.values(EnergyLevel);

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

    if (typeof wakeTime !== "string" || !timeRegex.test(wakeTime)) {
        res.status(400).json({ success: false, error: "wakeTime must be a valid HH:mm string" });
        return;
    }

    if (typeof sleepTime !== "string" || !timeRegex.test(sleepTime)) {
        res.status(400).json({ success: false, error: "sleepTime must be a valid HH:mm string" });
        return;
    }

    if (!Array.isArray(blocks) || blocks.length === 0) {
        res.status(400).json({ success: false, error: "blocks must be a non-empty array" });
        return;
    }

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];

        if (!block || typeof block !== "object") {
            res.status(400).json({ success: false, error: `Block at index ${i} is invalid` });
            return;
        }

        if (!validBlockTypes.includes(block.type)) {
            res.status(400).json({ success: false, error: `Block at index ${i} has invalid type` });
            return;
        }

        if (typeof block.name !== "string" || !block.name.trim()) {
            res.status(400).json({ success: false, error: `Block at index ${i} must have a non-empty name` });
            return;
        }

        if (typeof block.startTime !== "string" || !timeRegex.test(block.startTime)) {
            res.status(400).json({ success: false, error: `Block at index ${i} has invalid startTime` });
            return;
        }

        if (typeof block.endTime !== "string" || !timeRegex.test(block.endTime)) {
            res.status(400).json({ success: false, error: `Block at index ${i} has invalid endTime` });
            return;
        }

        if (block.energyLevel !== undefined && !validEnergyLevels.includes(block.energyLevel)) {
            res.status(400).json({ success: false, error: `Block at index ${i} has invalid energyLevel` });
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
        if (error instanceof ContainerBlockNotFoundError) {
            res.status(400).json({ success: false, error: "At least one CONTAINER block is required" });
            return;
        }

        if (error instanceof BlockOverlapError) {
            res.status(400).json({ success: false, error: "Blocks must not overlap" });
            return;
        }

        if (error instanceof OutOfAwakeBoundsError) {
            res.status(400).json({ success: false, error: "All blocks must fall within wakeTime and sleepTime" });
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
