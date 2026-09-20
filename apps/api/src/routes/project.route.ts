import { Router, Request, Response } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import {
    getAllProjects,
    getProjectById,
    createProject,
    updateProject,
    deleteProject,
    setInFocus,
    ProjectNotFoundError,
    DuplicateProjectNameError,
    InFocusLimitError,
} from "../services/project.service";
import type { CreateProjectInput, UpdateProjectInput } from "../types/project.types";

const router = Router();

router.get("/", authenticate, async (req: Request, res: Response): Promise<void> => {
    res.set("Cache-Control", "no-store, private");

    const projects = await getAllProjects(req.user!.sub);
    res.status(200).json({ success: true, data: projects });
});

router.post("/", authenticate, async (req: Request, res: Response): Promise<void> => {
    if (!req.body || typeof req.body !== "object") {
        res.status(400).json({ success: false, error: "Request body is required" });
        return;
    }

    const { name, goal } = req.body as CreateProjectInput;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ success: false, error: "Name is required" });
        return;
    }

    try {
        const project = await createProject(req.user!.sub, { name, goal });
        res.status(201).json({ success: true, data: project });
    } catch (error) {
        if (error instanceof DuplicateProjectNameError) {
            res.status(409).json({ success: false, error: "A project with that name already exists" });
            return;
        }
        throw error;
    }
});

router.patch("/:id/focus", authenticate, async (req: Request, res: Response): Promise<void> => {
    res.set("Cache-Control", "no-store, private");

    const { inFocus } = req.body ?? {};
    if (typeof inFocus !== "boolean") {
        res.status(400).json({ success: false, error: "inFocus must be a boolean" });
        return;
    }

    try {
        const project = await setInFocus(req.user!.sub, req.params.id as string, inFocus);
        res.json({ success: true, data: project });
    } catch (error) {
        if (error instanceof ProjectNotFoundError) {
            res.status(404).json({ success: false, error: "Project not found" });
            return;
        }
        if (error instanceof InFocusLimitError) {
            res.status(409).json({ success: false, error: "At most 3 projects can be in focus" });
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

    const { name, goal } = req.body as UpdateProjectInput;

    const hasField = [name, goal].some(v => v !== undefined);
    if (!hasField) {
        res.status(400).json({ success: false, error: "At least one field is required" });
        return;
    }

    if (name !== undefined && (typeof name !== "string" || name.trim().length === 0)) {
        res.status(400).json({ success: false, error: "Name cannot be empty" });
        return;
    }

    try {
        const project = await updateProject(req.user!.sub, req.params.id as string, { name, goal });
        res.json({ success: true, data: project });
    } catch (error) {
        if (error instanceof ProjectNotFoundError) {
            res.status(404).json({ success: false, error: "Project not found" });
            return;
        }
        if (error instanceof DuplicateProjectNameError) {
            res.status(409).json({ success: false, error: "A project with that name already exists" });
            return;
        }
        throw error;
    }
});

router.get("/:id", authenticate, async (req: Request, res: Response): Promise<void> => {
    res.set("Cache-Control", "no-store, private");

    const project = await getProjectById(req.user!.sub, req.params.id as string);
    if (!project) {
        res.status(404).json({ success: false, error: "Project not found" });
        return;
    }
    res.json({ success: true, data: project });
});

router.delete("/:id", authenticate, async (req: Request, res: Response): Promise<void> => {
    try {
        await deleteProject(req.user!.sub, req.params.id as string);
        res.status(204).send();
    } catch (error) {
        if (error instanceof ProjectNotFoundError) {
            res.status(404).json({ success: false, error: "Project not found" });
            return;
        }
        throw error;
    }
});

export default router;
