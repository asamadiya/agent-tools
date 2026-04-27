import { execa } from "execa";
import { z } from "zod";
import { loadState, type State, type Task } from "../state.js";
import { isPaneId } from "../tmux.js";
import { logger } from "../logger.js";

export const AttachInputSchema = z.object({
  id: z.string().min(1),
  /** Default "switch" — bring the agent's tmux window to the foreground in
   *  the current client. "split" creates a split (horizontal or vertical) in
   *  the current window pulling the agent's pane in. "join" pulls the agent
   *  pane into the current window as a new pane. "info" returns the commands
   *  without executing. */
  mode: z.enum(["switch", "split", "join", "info"]).default("switch"),
  /** For split: percentage of the new pane (1-99). */
  percentage: z.number().int().min(1).max(99).optional(),
  /** For split: "h" (left/right) or "v" (top/bottom). Default "v". */
  direction: z.enum(["h", "v"]).optional(),
  /** Override target tmux client. Default: current. */
  client: z.string().optional(),
});
export type AttachInput = z.infer<typeof AttachInputSchema>;

export interface AttachOutput {
  id: string;
  tmuxTarget: string;
  mode: AttachInput["mode"];
  commands: string[][];
  executed: boolean;
}

const findTaskById = (s: State, id: string): Task | null => {
  if (s.tasks[id]) return s.tasks[id]!;
  for (const t of Object.values(s.tasks)) if (t.name === id) return t;
  return null;
};

const tmux = async (args: string[]): Promise<{ exit: number; stdout: string; stderr: string }> => {
  const r = await execa("tmux", args, { reject: false });
  return { exit: r.exitCode ?? 1, stdout: r.stdout?.toString() ?? "", stderr: r.stderr?.toString() ?? "" };
};

export const handleAttach = async (
  raw: unknown,
  deps: { statePath?: string },
): Promise<AttachOutput> => {
  const input = AttachInputSchema.parse(raw);
  const s = loadState(deps.statePath ? { path: deps.statePath } : {});
  const t = findTaskById(s, input.id);
  if (!t) throw new Error(`Attach: no task addressable as ${JSON.stringify(input.id)}`);
  if (!t.tmuxTarget) {
    throw new Error(`Attach: task ${t.id} has no tmuxTarget (not a background agent)`);
  }
  const target = t.tmuxTarget;
  const commands: string[][] = [];
  const targetIsPane = isPaneId(target);

  switch (input.mode) {
    case "switch": {
      // Pane targets need a select-window first (tmux navigates to the pane's
      // window) plus a select-pane for focus. switch-client handles
      // session:windowName targets directly.
      if (targetIsPane) {
        commands.push(["select-window", "-t", target]);
        commands.push(["select-pane", "-t", target]);
      } else {
        commands.push(input.client
          ? ["switch-client", "-c", input.client, "-t", target]
          : ["switch-client", "-t", target]);
      }
      break;
    }
    case "split":
    case "join": {
      // Pulls the agent pane into the current window. With pane targets this
      // works as-is. Window targets imply moving the lone pane of that window.
      commands.push(["join-pane", "-s", target]);
      break;
    }
    case "info":
      if (targetIsPane) {
        commands.push(["select-window", "-t", target]);
        commands.push(["select-pane", "-t", target]);
      } else {
        commands.push(["switch-client", "-t", target]);
      }
      break;
  }

  let executed = false;
  if (input.mode !== "info") {
    for (const args of commands) {
      const r = await tmux(args);
      if (r.exit !== 0) {
        logger.warn({ args, stderr: r.stderr }, "Attach tmux command failed");
        throw new Error(`Attach: tmux ${args[0]} failed: ${r.stderr || r.stdout}`);
      }
    }
    executed = true;
  }
  return { id: t.id, tmuxTarget: target, mode: input.mode, commands, executed };
};

// Reverse lookup ----------------------------------------------------------

export const WhoOwnsInputSchema = z
  .object({
    pane: z.string().optional(),
    uuid: z.string().optional(),
    name: z.string().optional(),
    tmux_target: z.string().optional(),
  })
  .refine((v) => v.pane || v.uuid || v.name || v.tmux_target, {
    message: "WhoOwns: provide at least one of pane, uuid, name, tmux_target",
  });
export type WhoOwnsInput = z.infer<typeof WhoOwnsInputSchema>;

export const handleWhoOwns = async (
  raw: unknown,
  deps: { statePath?: string },
): Promise<Task | null> => {
  const q = WhoOwnsInputSchema.parse(raw);
  const s = loadState(deps.statePath ? { path: deps.statePath } : {});
  for (const t of Object.values(s.tasks)) {
    if (q.uuid && t.id === q.uuid) return t;
    if (q.name && t.name === q.name) return t;
    if (q.tmux_target && t.tmuxTarget === q.tmux_target) return t;
    if (q.pane && t.tmuxTarget) {
      // Resolve pane id of the recorded tmux_target
      const r = await tmux(["display-message", "-p", "-t", t.tmuxTarget, "#{pane_id}"]);
      if (r.exit === 0 && r.stdout.trim() === q.pane) return t;
    }
  }
  return null;
};
