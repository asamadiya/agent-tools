import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import {
  TASK_STATUSES,
  loadState,
  nowIso,
  withState,
  type State,
  type Task,
  type TaskStatus,
} from "../state.js";
import {
  capturePane,
  isPaneId,
  killPane,
  killWindow,
  listWindows,
  paneExists,
} from "../tmux.js";
import { sessionLiveness, getTranscript } from "../session-state.js";
import { logger } from "../logger.js";

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const reconcileTask = async (t: Task, sessionRoot?: string): Promise<Task> => {
  if (t.status !== "running") return t;
  // session-state is the highest-fidelity liveness signal. If the session
  // recorded session.shutdown, the agent is gone regardless of pane/pid state.
  const live = sessionLiveness(t.id, sessionRoot);
  if (live.state === "shutdown") {
    return { ...t, status: "exited" as TaskStatus, updatedAt: nowIso() };
  }
  // Pane existence — useful when copilot crashed without a clean shutdown.
  if (t.tmuxTarget) {
    if (isPaneId(t.tmuxTarget)) {
      if (!(await paneExists(t.tmuxTarget))) {
        return { ...t, status: "exited" as TaskStatus, updatedAt: nowIso() };
      }
    } else {
      const sep = t.tmuxTarget.indexOf(":");
      if (sep > 0) {
        const session = t.tmuxTarget.slice(0, sep);
        const windowName = t.tmuxTarget.slice(sep + 1);
        const windows = await listWindows(session);
        if (!windows.some((w) => w.windowName === windowName)) {
          return { ...t, status: "exited" as TaskStatus, updatedAt: nowIso() };
        }
      }
    }
  }
  if (typeof t.pid === "number" && t.pid > 0 && !isAlive(t.pid)) {
    return { ...t, status: "exited" as TaskStatus, updatedAt: nowIso() };
  }
  return t;
};

const reconcileAll = async (s: State, sessionRoot?: string): Promise<State> => {
  const next: State = { tasks: {}, teams: s.teams };
  for (const [id, t] of Object.entries(s.tasks)) {
    next.tasks[id] = await reconcileTask(t, sessionRoot);
  }
  return next;
};

export const TaskListInputSchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  team_name: z.string().optional(),
});
export type TaskListInput = z.infer<typeof TaskListInputSchema>;

export interface TaskDeps {
  statePath?: string;
  sessionRoot?: string;
}

export const handleTaskList = async (
  raw: unknown,
  deps: TaskDeps,
): Promise<Task[]> => {
  const input = TaskListInputSchema.parse(raw ?? {});
  const opts = deps.statePath ? { path: deps.statePath } : {};
  await withState(async (s) => reconcileAll(s, deps.sessionRoot), opts);
  const cur = loadState(opts);
  return Object.values(cur.tasks).filter((t) => {
    if (input.status && t.status !== input.status) return false;
    if (input.team_name && t.team !== input.team_name) return false;
    return true;
  });
};

export const TaskGetInputSchema = z.object({ id: z.string().min(1) });
export const handleTaskGet = async (
  raw: unknown,
  deps: TaskDeps,
): Promise<Task | null> => {
  const { id } = TaskGetInputSchema.parse(raw);
  const opts = deps.statePath ? { path: deps.statePath } : {};
  await withState(async (s) => reconcileAll(s, deps.sessionRoot), opts);
  const cur = loadState(opts);
  return cur.tasks[id] ?? null;
};

export const TaskOutputInputSchema = z.object({
  id: z.string().min(1),
  /** Source preference. Default "transcript" returns events.jsonl-derived
   *  user/assistant turns concatenated. "pane" returns raw tmux scrollback.
   *  "log" returns the per-uuid log file (script(1) wrapper, foreground spawns). */
  source: z.enum(["transcript", "pane", "log"]).default("transcript"),
  tail_bytes: z.number().int().positive().optional(),
});
export const handleTaskOutput = async (
  raw: unknown,
  deps: TaskDeps,
): Promise<{ source: "transcript" | "pane" | "log" | "none"; content: string }> => {
  const input = TaskOutputInputSchema.parse(raw);
  const opts = deps.statePath ? { path: deps.statePath } : {};
  const cur = loadState(opts);
  const t = cur.tasks[input.id];
  if (!t) throw new Error(`TaskOutput: no such task ${input.id}`);

  if (input.source === "transcript") {
    const turns = getTranscript(t.id, deps.sessionRoot ? { root: deps.sessionRoot } : {});
    const content = turns
      .filter((tt) => tt.role === "user" || tt.role === "assistant")
      .map((tt) => `[${tt.role} #${tt.turnId ?? "?"}] ${tt.content}`)
      .join("\n\n");
    return { source: "transcript", content: maybeTail(content, input.tail_bytes) };
  }

  if (input.source === "pane") {
    if (t.tmuxTarget && t.status === "running") {
      try {
        const content = await capturePane(t.tmuxTarget, { joinWrapped: true });
        return { source: "pane", content: maybeTail(content, input.tail_bytes) };
      } catch {
        /* fall through */
      }
    }
    return { source: "none", content: "" };
  }

  // input.source === "log"
  if (t.log && existsSync(t.log)) {
    const content = readFileSync(t.log, "utf8");
    return { source: "log", content: maybeTail(content, input.tail_bytes) };
  }
  return { source: "none", content: "" };
};

const maybeTail = (s: string, n?: number): string => {
  if (!n || s.length <= n) return s;
  return s.slice(s.length - n);
};

// GetTranscript — structured turns from events.jsonl ----------------------

export const GetTranscriptInputSchema = z.object({
  id: z.string().min(1),
  /** Filter to turns with turnId >= this number. */
  since_turn: z.number().int().nonnegative().optional(),
});
export type GetTranscriptInput = z.infer<typeof GetTranscriptInputSchema>;

export const handleGetTranscript = async (
  raw: unknown,
  deps: TaskDeps,
): Promise<{
  id: string;
  turns: ReturnType<typeof getTranscript>;
}> => {
  const input = GetTranscriptInputSchema.parse(raw);
  const opts = deps.statePath ? { path: deps.statePath } : {};
  const cur = loadState(opts);
  const t = cur.tasks[input.id] ?? Object.values(cur.tasks).find((x) => x.name === input.id);
  if (!t) throw new Error(`GetTranscript: no task addressable as ${JSON.stringify(input.id)}`);
  const turns = getTranscript(t.id, {
    ...(deps.sessionRoot ? { root: deps.sessionRoot } : {}),
    ...(typeof input.since_turn === "number" ? { sinceTurn: input.since_turn } : {}),
  });
  return { id: t.id, turns };
};

export const TaskStopInputSchema = z.object({ id: z.string().min(1) });
export const handleTaskStop = async (
  raw: unknown,
  deps: TaskDeps,
): Promise<Task> => {
  const { id } = TaskStopInputSchema.parse(raw);
  const opts = deps.statePath ? { path: deps.statePath } : {};
  const cur = loadState(opts);
  const t = cur.tasks[id];
  if (!t) throw new Error(`TaskStop: no such task ${id}`);
  if (t.tmuxTarget) {
    try {
      if (isPaneId(t.tmuxTarget)) {
        await killPane(t.tmuxTarget);
      } else {
        await killWindow(t.tmuxTarget);
      }
    } catch (err) {
      logger.warn({ err, target: t.tmuxTarget }, "tmux kill failed");
    }
  }
  if (typeof t.pid === "number" && t.pid > 0 && isAlive(t.pid)) {
    try {
      process.kill(t.pid, "SIGTERM");
    } catch {
      /* ignore */
    }
  }
  const out = await withState(async (s) => {
    const cur2 = s.tasks[id];
    if (cur2) {
      s.tasks[id] = { ...cur2, status: "stopped" as TaskStatus, updatedAt: nowIso() };
    }
    return { state: s, result: s.tasks[id]! };
  }, opts);
  return out!;
};

export const TaskCreateInputSchema = z.object({
  content: z.string().min(1),
  status: z.enum(["todo", "in_progress", "completed"]).default("todo"),
  team_name: z.string().optional(),
});
export const handleTaskCreate = async (
  raw: unknown,
  deps: TaskDeps,
): Promise<Task> => {
  const input = TaskCreateInputSchema.parse(raw);
  const id = randomUUID();
  const opts = deps.statePath ? { path: deps.statePath } : {};
  const out = await withState(async (s) => {
    if (input.team_name && !s.teams[input.team_name]) {
      s.teams[input.team_name] = { name: input.team_name, createdAt: nowIso() };
    }
    s.tasks[id] = {
      id,
      status: input.status,
      description: input.content,
      ...(input.team_name ? { team: input.team_name } : {}),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    return { state: s, result: s.tasks[id]! };
  }, opts);
  return out!;
};

export const TaskUpdateInputSchema = z.object({
  id: z.string().min(1),
  status: z.enum(TASK_STATUSES).optional(),
  content: z.string().min(1).optional(),
});
export const handleTaskUpdate = async (
  raw: unknown,
  deps: TaskDeps,
): Promise<Task> => {
  const input = TaskUpdateInputSchema.parse(raw);
  const opts = deps.statePath ? { path: deps.statePath } : {};
  const out = await withState(async (s) => {
    const t = s.tasks[input.id];
    if (!t) throw new Error(`TaskUpdate: no such task ${input.id}`);
    s.tasks[input.id] = {
      ...t,
      ...(input.status ? { status: input.status } : {}),
      ...(input.content ? { description: input.content } : {}),
      updatedAt: nowIso(),
    };
    return { state: s, result: s.tasks[input.id]! };
  }, opts);
  return out!;
};
