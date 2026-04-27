import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  existsSync,
  closeSync,
  openSync,
  fsyncSync,
  copyFileSync,
} from "node:fs";
import lockfile from "proper-lockfile";
import { z } from "zod";
import { logger } from "./logger.js";

export const TASK_STATUSES = [
  "running",
  "exited",
  "stopped",
  "todo",
  "in_progress",
  "completed",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TaskSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  team: z.string().optional(),
  status: z.enum(TASK_STATUSES),
  exitCode: z.number().nullable().optional(),
  pid: z.number().nullable().optional(),
  tmuxTarget: z.string().nullable().optional(),
  log: z.string().nullable().optional(),
  isolation: z
    .object({ worktree: z.string(), branch: z.string() })
    .nullable()
    .optional(),
  description: z.string().optional(),
  prompt: z.string().optional(),
  subagentType: z.string().optional(),
  model: z.string().optional(),
  background: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

export const TeamSchema = z.object({
  name: z.string().min(1),
  createdAt: z.string(),
});
export type Team = z.infer<typeof TeamSchema>;

export const AnchorSchema = z.object({
  paneId: z.string(),
  windowId: z.string().optional(),
  setAt: z.string(),
});
export type Anchor = z.infer<typeof AnchorSchema>;

export const StateSchema = z.object({
  tasks: z.record(z.string(), TaskSchema).default({}),
  teams: z.record(z.string(), TeamSchema).default({}),
  /** The pane the team is anchored to. Persisted across MCP server respawns
   *  so re-launches don't follow the user's current TMUX_PANE around. Cleared
   *  when the pane no longer exists and there are no live agents. */
  anchor: AnchorSchema.nullable().default(null),
});
export type State = z.infer<typeof StateSchema>;

const DEFAULT_DIR = join(homedir(), ".copilot", "agent-teams");
const DEFAULT_STATE_PATH = join(DEFAULT_DIR, "state.json");

export interface StateOptions {
  path?: string;
  lockRetries?: number;
}

const empty = (): State => ({ tasks: {}, teams: {}, anchor: null });

const ensureFile = (path: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify(empty(), null, 2));
  }
};

export const loadState = (opts: StateOptions = {}): State => {
  const path = opts.path ?? DEFAULT_STATE_PATH;
  ensureFile(path);
  const raw = readFileSync(path, "utf8");
  try {
    const parsed = StateSchema.parse(JSON.parse(raw));
    return parsed;
  } catch (err) {
    const backup = `${path}.corrupt-${Date.now()}.bak`;
    try {
      copyFileSync(path, backup);
    } catch {
      /* best-effort */
    }
    logger.error(
      { err, backup, path },
      "state file invalid — backed up and reset",
    );
    const fresh = empty();
    writeFileSync(path, JSON.stringify(fresh, null, 2));
    return fresh;
  }
};

const atomicWrite = (path: string, content: string): void => {
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, content);
  const fd = openSync(tmp, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
};

export const saveState = (state: State, opts: StateOptions = {}): void => {
  const path = opts.path ?? DEFAULT_STATE_PATH;
  ensureFile(path);
  const validated = StateSchema.parse(state);
  atomicWrite(path, `${JSON.stringify(validated, null, 2)}\n`);
};

export const withState = async <T>(
  mutator: (s: State) => State | Promise<State> | { state: State; result: T } | Promise<{ state: State; result: T }>,
  opts: StateOptions = {},
): Promise<T | undefined> => {
  const path = opts.path ?? DEFAULT_STATE_PATH;
  ensureFile(path);
  const release = await lockfile.lock(path, {
    retries: { retries: opts.lockRetries ?? 20, minTimeout: 25, maxTimeout: 250 },
    stale: 30_000,
    realpath: false,
  });
  try {
    const current = loadState({ path });
    const out = await mutator(current);
    let next: State;
    let result: T | undefined;
    if (out && typeof out === "object" && "state" in out && "result" in out) {
      next = out.state;
      result = out.result;
    } else {
      next = out as State;
    }
    saveState(next, { path });
    return result;
  } finally {
    await release();
  }
};

export const nowIso = (): string => new Date().toISOString();

/** Resolve `id` (uuid or human name) to a task, preferring live > running >
 *  most recent so accumulated stale entries don't shadow the actual current
 *  agent. `isAlive(target)` is injected so the caller chooses the liveness
 *  test (typically tmux paneExists). */
export const resolveTask = async (
  s: State,
  id: string,
  isAlive: (tmuxTarget: string) => Promise<boolean>,
): Promise<Task | null> => {
  if (s.tasks[id]) return s.tasks[id]!;
  const candidates = Object.values(s.tasks).filter((t) => t.name === id);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  const scored = await Promise.all(
    candidates.map(async (t) => {
      let alive = false;
      if (t.tmuxTarget && t.tmuxTarget.startsWith("%")) {
        try { alive = await isAlive(t.tmuxTarget); } catch { /* ignore */ }
      }
      return {
        t,
        alive,
        running: t.status === "running",
        updated: Date.parse(t.updatedAt) || 0,
      };
    }),
  );
  scored.sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.running !== b.running) return a.running ? -1 : 1;
    return b.updated - a.updated;
  });
  return scored[0]!.t;
};
