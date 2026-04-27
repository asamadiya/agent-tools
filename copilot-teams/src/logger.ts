import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import pino from "pino";

const LOG_PATH = `${homedir()}/.copilot/agent-teams/server.log`;

mkdirSync(dirname(LOG_PATH), { recursive: true });

export const logger = pino(
  {
    level: process.env.COPILOT_TEAMS_LOG_LEVEL ?? "info",
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.destination({ dest: LOG_PATH, sync: false, mkdir: true }),
);

export type Logger = typeof logger;

let counter = 0;
export const newCorrelationId = (): string =>
  `${Date.now().toString(36)}-${(counter++).toString(36)}`;
