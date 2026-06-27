import { Router, Request, Response } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { getBacklog, createTask, getTaskById, deleteTask, updateTask, InvalidProgressError, InvalidDeadlineError, TaskNotFoundError } from "../services/task.service";
import type { CreateTaskInput, UpdateTaskInput } from "../types/task.types";

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

router.patch("/:id", authenticate, async (req: Request, res: Response): Promise<void> => {
    res.set("Cache-Control", "no-store, private");

    if (!req.body || typeof req.body !== "object") {
        res.status(400).json({ success: false, error: "Request body is required" });
        return;
    }

    const { title, notes, estimatedMins, priority, effort, deadline, progress } = req.body as UpdateTaskInput;

    const hasField = [title, notes, estimatedMins, priority, effort, deadline, progress].some(v => v !== undefined);
    if (!hasField) {
        res.status(400).json({ success: false, error: "At least one field is required" });
        return;
    }

    if (title !== undefined && (typeof title !== "string" || title.trim().length === 0)) {
        res.status(400).json({ success: false, error: "Title cannot be empty" });
        return;
    }

    if (estimatedMins !== undefined && (typeof estimatedMins !== "number" || estimatedMins <= 0)) {
        res.status(400).json({ success: false, error: "Estimate must be a positive number" });
        return;
    }

    try {
        const task = await updateTask(req.user!.sub, req.params.id as string, { title, notes, estimatedMins, priority, effort, deadline, progress });
        res.json({ success: true, data: task });
    } catch (error) {
        if (error instanceof TaskNotFoundError) {
            res.status(404).json({ success: false, error: "Task not found" });
            return;
        }
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

router.get("/:id", authenticate, async (req: Request, res: Response): Promise<void> => {
    res.set("Cache-Control", "no-store, private");
    try {
        const task = await getTaskById(req.user!.sub, req.params.id as string);
        if (!task) {
            res.status(404).json({ success: false, error: 'Task not found' });
            return;
        }
        res.json({ success: true, data: task });
    } catch (error) {
        throw error;
    }
});

router.delete("/:id", authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        await deleteTask(req.user!.sub, req.params.id as string);
        res.status(204).send();
    } catch (error) {
        if (error instanceof TaskNotFoundError) {
            res.status(404).json({ success: false, error: 'Task not found' });
            return;
        }
        throw error;
    }
});

export default router;
