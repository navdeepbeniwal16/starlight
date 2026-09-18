import { Router, Request, Response } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { getOnboarding, markOnboarded } from "../services/onboarding.service";

const router = Router();

router.get("/onboarding", authenticate, async (req: Request, res: Response): Promise<void> => {
    const onboarding = await getOnboarding(req.user!.sub);
    res.status(200).json({ success: true, data: onboarding });
});

router.put("/onboarding", authenticate, async (req: Request, res: Response): Promise<void> => {
    const onboarding = await markOnboarded(req.user!.sub);
    res.status(200).json({ success: true, data: onboarding });
});

export default router;
