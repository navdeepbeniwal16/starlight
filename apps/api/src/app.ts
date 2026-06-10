import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import healthRouter from "./routes/health";
import authRouter from "./routes/auth.route";
import appConfigRouter from "./routes/app";
import dayTemplateRouter from "./routes/dayTemplate.route";
import dayPlanRouter from "./routes/dayPlan.route";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use("/health", healthRouter);
app.use("/auth", authRouter);
app.use("/app", appConfigRouter);
app.use("/day-template", dayTemplateRouter);
app.use("/day-plan", dayPlanRouter);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

export default app;