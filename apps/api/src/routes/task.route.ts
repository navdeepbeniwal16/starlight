import { Router, Request, Response } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { getBacklog, createTask, InvalidProgressError, InvalidDeadlineError } from "../services/task.service";
import type { CreateTaskInput } from "../types/task.types";

const router = Router();

router.get("/", authenticate, async (req: Request, res: Response): Promise<void> => {
    res.set("Cache-Control", "no-store, private");

    try {
        const tasks = await getBacklog(req.user!.sub);
        res.status(200).json({ success: true, data: tasks });
    } catch (error) {
        throw error;
    }
});

router.post("/", authenticate, async (req: Request, res: Response): Promise<void> => {
    if (!req.body || typeof req.body !== "object") {
        res.status(400).json({ success: false, error: "Request body is required" });
        return;
    }

    const { title, estimatedMins, priority, effort, deadline, progress, notes } = req.body as CreateTaskInput;

    if (!title || typeof title !== "string" || title.trim().length === 0) {
        res.status(400).json({ success: false, error: "Title is required" });
        return;
    }
    if (!estimatedMins || typeof estimatedMins !== "number") {
        res.status(400).json({ success: false, error: "Estimate is required" });
        return;
    }

    try {
        const task = await createTask(req.user!.sub, { title, estimatedMins, priority, effort, deadline, progress, notes });
        res.status(201).json({ success: true, data: task });
    } catch (error) {
        if (error instanceof InvalidProgressError) {
            res.status(400).json({ success: false, error: "Progress must be an integer between 0 and 100" });
            return;
        }
        if (error instanceof InvalidDeadlineError) {
            res.status(400).json({ success: false, error: "Invalid deadline date" });
            return;
        }

        throw error;
    }
});

export default router;
