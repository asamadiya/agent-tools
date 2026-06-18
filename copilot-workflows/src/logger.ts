import pino from "pino";

export const logger = pino({
  name: "copilot-workflows",
  level: process.env.COPILOT_WORKFLOWS_LOG_LEVEL ?? "info",
});
