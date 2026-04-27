import { z } from "zod";
import { loadState, type State, type Task } from "../state.js";
import {
  isPaneId,
  listWindows,
  paneCurrentCommand,
  paneExists,
} from "../tmux.js";
import {
  sessionLiveness,
  type LivenessState,
} from "../session-state.js";

export const StatusInputSchema = z.object({
  id: z.string().min(1),
});
export type StatusInput = z.infer<typeof StatusInputSchema>;

export interface StatusOutput {
  id: string;
  task: Task;
  /** Liveness inferred from events.jsonl. */
  session: {
    state: LivenessState;
    exists: boolean;
    turnCount: number;
    lastTurnId: string | null;
    lastEventType: string | null;
    lastEventAgeMs: number | null;
    shutdownType: string | null;
  };
  /** Liveness of the tmux window. */
  pane: {
    target: string | null;
    alive: boolean | null;
    currentCommand: string | null;
  };
  /** True iff the agent is alive and idle (ready to receive a SendMessage). */
  ready: boolean;
}

const findTask = (s: State, id: string): Task | null => {
  if (s.tasks[id]) return s.tasks[id]!;
  for (const t of Object.values(s.tasks)) if (t.name === id) return t;
  return null;
};

export const handleStatus = async (
  raw: unknown,
  deps: { statePath?: string; sessionRoot?: string },
): Promise<StatusOutput> => {
  const input = StatusInputSchema.parse(raw);
  const s = loadState(deps.statePath ? { path: deps.statePath } : {});
  const t = findTask(s, input.id);
  if (!t) throw new Error(`Status: no task addressable as ${JSON.stringify(input.id)}`);

  const live = sessionLiveness(t.id, deps.sessionRoot);

  let paneAlive: boolean | null = null;
  let cmd: string | null = null;
  if (t.tmuxTarget) {
    if (isPaneId(t.tmuxTarget)) {
      paneAlive = await paneExists(t.tmuxTarget);
    } else {
      const sep = t.tmuxTarget.indexOf(":");
      if (sep > 0) {
        const session = t.tmuxTarget.slice(0, sep);
        const windowName = t.tmuxTarget.slice(sep + 1);
        const ws = await listWindows(session);
        paneAlive = ws.some((w) => w.windowName === windowName);
      }
    }
    if (paneAlive) {
      cmd = await paneCurrentCommand(t.tmuxTarget);
    }
  }

  // "ready" = session exists + idle + (if pane is recorded) pane alive.
  const ready =
    live.state === "idle" &&
    (t.tmuxTarget ? paneAlive === true : true);

  return {
    id: t.id,
    task: t,
    session: {
      state: live.state,
      exists: live.exists,
      turnCount: live.turnCount,
      lastTurnId: live.lastTurnId,
      lastEventType: live.lastEventType,
      lastEventAgeMs: live.lastEventAgeMs,
      shutdownType: live.shutdownType,
    },
    pane: {
      target: t.tmuxTarget ?? null,
      alive: paneAlive,
      currentCommand: cmd,
    },
    ready,
  };
};
