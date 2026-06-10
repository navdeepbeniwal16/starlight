import { Router, Request, Response } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { getDayPlan } from "../services/dayPlan.service";

const router = Router();

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

function todayDateString(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

router.get("/", authenticate, async (req: Request, res: Response): Promise<void> => {
    res.set("Cache-Control", "no-store, private");

    const dateParam = req.query.date;

    if (dateParam !== undefined && (typeof dateParam !== "string" || !dateRegex.test(dateParam))) {
        res.status(400).json({ success: false, error: "date must be a valid YYYY-MM-DD string" });
        return;
    }

    const date = dateParam ?? todayDateString();

    const plan = await getDayPlan(req.user!.sub, date);

    if (!plan) {
        res.status(404).json({ success: false, error: "No plan found for this date" });
        return;
    }

    res.status(200).json({ success: true, data: plan });
});

export default router;
