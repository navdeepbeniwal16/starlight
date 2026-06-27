import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import logger from "./lib/logger";
import healthRouter from "./routes/health";
import authRouter from "./routes/auth.route";
import appConfigRouter from "./routes/app";
import dayTemplateRouter from "./routes/dayTemplate.route";
import dayPlanRouter from "./routes/dayPlan.route";
import taskRouter from "./routes/task.route";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use(
  pinoHttp({
    logger,
    customProps: (req, res) => ({
      userId: (req as Request).user?.sub ?? res.locals["userId"] ?? undefined,
      responseBody: res.locals["responseBody"],
    }),
    serializers: {
      req(req) {
        return {
          method: req.method,
          url: req.url,
          query: req.query,
          body: req.raw.body,
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  })
);

// Capture response body for logging before it's sent
app.use((_req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    res.locals["responseBody"] = body;
    return originalJson(body);
  };
  next();
});

app.use("/health", healthRouter);
app.use("/auth", authRouter);
app.use("/app", appConfigRouter);
app.use("/day-template", dayTemplateRouter);
app.use("/day-plan", dayPlanRouter);
app.use("/tasks", taskRouter);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

export default app;