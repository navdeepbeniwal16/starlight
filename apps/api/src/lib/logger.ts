import pino from "pino";

const REDACTED_PATHS = [
  "req.body.password",
  "res.body.token",
  "res.body.accessToken",
];

const logger = pino({
  redact: { paths: REDACTED_PATHS, censor: "[REDACTED]" },
});

export default logger;
