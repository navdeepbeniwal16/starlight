import { Router, Request, Response } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { getBacklog } from "../services/task.service";

const router = Router();

router.get("/", authenticate, async (req: Request, res: Response): Promise<void> => {
    res.set("Cache-Control", "no-store, private");
    const tasks = await getBacklog(req.user!.sub);
    res.status(200).json({ success: true, data: tasks });
});

export default router;
