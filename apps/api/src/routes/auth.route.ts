import { Router, Request, Response} from "express";
import { EmailAlreadyInUseError, getMe, InvalidCredentialsError, login, signup, UserNotFoundError } from "../services/auth.service";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/signup", async (req: Request, res: Response): Promise<void> => {
    if (!req.body || typeof req.body !== "object") {
        res.status(400).json({ success: false, error: "Request body is required" });
        return;
    }

    const { email, password, firstName, lastName } = req.body;

    // Check fields types
    if(
        typeof email !== "string" ||
        typeof password !== "string" ||
        typeof firstName !== "string" ||
        typeof lastName !== "string"
    ) {
        res.status(400).json({ success: false, error: "Invalid request body" });
        return;
    }

    const trimmedEmail = email.trim();
    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();

    // Check fields format
    if(trimmedEmail.length > 254 || !emailRegex.test(trimmedEmail)) {
        res.status(400).json({ success: false, error: "Invalid email" });
        return;
    }

    if(password.length < 8 || password.length > 72) {
        res.status(400).json({ success: false, error: "Password must be between 8 and 72 characters" });
        return;
    }

    if(!trimmedFirstName || !trimmedLastName) {
        res.status(400).json({ success: false, error: "First name and last name are required" });
        return;
    }

    try {
        const result = await signup({
            email: trimmedEmail,
            password: password,
            firstName: trimmedFirstName,
            lastName: trimmedLastName
        });

        res.status(201).json({ success: true, data: result });
    } catch (error) {
        if(error instanceof EmailAlreadyInUseError) {
            res.status(409).json({ success: false, error: "Email already in use" });
            return;
        }

        throw error;
    }
});

router.post("/login", async (req: Request, res: Response): Promise<void> => {
    if(!req.body || typeof req.body !== 'object') {
        res.status(400).json({ success: false, error: "Request body is required" });
        return;
    }

    const { email, password } = req.body;

    if(typeof email !== 'string' || typeof password !== 'string') {
        res.status(400).json({ success: false, error: 'Invalid request body' });
        return;
    }

    try {
        const result = await login({
            email: email.trim(),
            password: password
        });

        res.status(200).json({ success: true, data: result });
        return;
    } catch (error) {
        if(error instanceof InvalidCredentialsError) {
            res.status(401).json({ success: false, error: "Invalid credentials" });
            return;
        }

        throw error;
    }
});

router.get("/me", authenticate, async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.sub;

    try {
        const user = await getMe(userId);
        res.status(200).json({ success: true, data: user });
        return;
    } catch (error) {
        if(error instanceof UserNotFoundError) {
            res.status(404).json({ success: false, error: "User not found" });
            return;
        }

        throw error;
    }
});

export default router;