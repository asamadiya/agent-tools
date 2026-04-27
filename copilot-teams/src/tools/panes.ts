import { execa } from "execa";
import { z } from "zod";
import { loadState, type State, type Task } from "../state.js";
import { logger } from "../logger.js";

const findTask = (s: State, id: string): Task | null => {
  if (s.tasks[id]) return s.tasks[id]!;
  for (const t of Object.values(s.tasks)) if (t.name === id) return t;
  return null;
};

const tmux = async (args: string[]): Promise<{ exit: number; stdout: string; stderr: string }> => {
  const r = await execa("tmux", args, { reject: false });
  return { exit: r.exitCode ?? 1, stdout: r.stdout?.toString() ?? "", stderr: r.stderr?.toString() ?? "" };
};

const requireTarget = (t: Task): string => {
  if (!t.tmuxTarget) {
    throw new Error(`task ${t.id} has no tmuxTarget (not a background agent)`);
  }
  return t.tmuxTarget;
};

// PaneJoin ----------------------------------------------------------------

export const PaneJoinInputSchema = z.object({
  id: z.string().min(1),
  /** Destination window. Defaults to current. Format: "session:window" or
   *  pane id. */
  target_window: z.string().optional(),
  /** Layout the destination after join. E.g., "tiled", "even-horizontal".
   *  Defaults to leaving layout untouched. */
  layout: z.string().optional(),
  /** Place the joined pane horizontally (-h) instead of vertically (-v). */
  horizontal: z.boolean().optional(),
  /** Percentage size of the new pane (1-99). */
  size_percent: z.number().int().min(1).max(99).optional(),
});
export type PaneJoinInput = z.infer<typeof PaneJoinInputSchema>;

export const handlePaneJoin = async (
  raw: unknown,
  deps: { statePath?: string },
): Promise<{ id: string; result: string }> => {
  const input = PaneJoinInputSchema.parse(raw);
  const s = loadState(deps.statePath ? { path: deps.statePath } : {});
  const t = findTask(s, input.id);
  if (!t) throw new Error(`PaneJoin: no task addressable as ${JSON.stringify(input.id)}`);
  const src = requireTarget(t);
  const args = ["join-pane", "-s", src];
  if (input.target_window) args.push("-t", input.target_window);
  args.push(input.horizontal ? "-h" : "-v");
  // tmux join-pane uses `-l <size>` (cells or N%), not `-p`. The latter is
  // for split-window only and silently ignored here, leaving the join with
  // no size and tmux complaining "size missing".
  if (input.size_percent) args.push("-l", `${input.size_percent}%`);
  const r = await tmux(args);
  if (r.exit !== 0) {
    throw new Error(`tmux join-pane failed: ${r.stderr || r.stdout}`);
  }
  if (input.layout) {
    await tmux(["select-layout", input.layout]);
  }
  logger.info({ event: "pane.join", id: t.id, args }, "pane joined");
  return { id: t.id, result: "joined" };
};

// PaneBreak ---------------------------------------------------------------

export const PaneBreakInputSchema = z.object({
  id: z.string().min(1),
  /** Optional new window name. */
  new_window_name: z.string().optional(),
});

export const handlePaneBreak = async (
  raw: unknown,
  deps: { statePath?: string },
): Promise<{ id: string; result: string }> => {
  const input = PaneBreakInputSchema.parse(raw);
  const s = loadState(deps.statePath ? { path: deps.statePath } : {});
  const t = findTask(s, input.id);
  if (!t) throw new Error(`PaneBreak: no task ${input.id}`);
  const src = requireTarget(t);
  const args = ["break-pane", "-s", src];
  if (input.new_window_name) args.push("-n", input.new_window_name);
  const r = await tmux(args);
  if (r.exit !== 0) throw new Error(`tmux break-pane failed: ${r.stderr || r.stdout}`);
  return { id: t.id, result: "broken" };
};

// PaneFocus ---------------------------------------------------------------

export const PaneFocusInputSchema = z.object({ id: z.string().min(1) });
export const handlePaneFocus = async (
  raw: unknown,
  deps: { statePath?: string },
): Promise<{ id: string }> => {
  const input = PaneFocusInputSchema.parse(raw);
  const s = loadState(deps.statePath ? { path: deps.statePath } : {});
  const t = findTask(s, input.id);
  if (!t) throw new Error(`PaneFocus: no task ${input.id}`);
  const target = requireTarget(t);
  // Try select-window first (window target); if it's a pane in a current
  // window, select-pane handles it. Try both; the right one will succeed.
  const a = await tmux(["select-window", "-t", target]);
  if (a.exit !== 0) {
    const b = await tmux(["select-pane", "-t", target]);
    if (b.exit !== 0) {
      throw new Error(`tmux select-window/-pane failed: ${a.stderr || b.stderr}`);
    }
  }
  return { id: t.id };
};

// PaneResize --------------------------------------------------------------

export const PaneResizeInputSchema = z.object({
  id: z.string().min(1),
  direction: z.enum(["U", "D", "L", "R"]).optional(),
  cells: z.number().int().positive().optional(),
  /** Set absolute size as percentage of the window. */
  percent: z.number().int().min(1).max(99).optional(),
});

export const handlePaneResize = async (
  raw: unknown,
  deps: { statePath?: string },
): Promise<{ id: string }> => {
  const input = PaneResizeInputSchema.parse(raw);
  const s = loadState(deps.statePath ? { path: deps.statePath } : {});
  const t = findTask(s, input.id);
  if (!t) throw new Error(`PaneResize: no task ${input.id}`);
  const target = requireTarget(t);
  const args = ["resize-pane", "-t", target];
  if (input.direction) args.push(`-${input.direction}`);
  if (input.cells) args.push(String(input.cells));
  if (input.percent) {
    // tmux 3.0+: `-p <percent>` uses absolute percentage if -x/-y omitted.
    args.push("-p", String(input.percent));
  }
  const r = await tmux(args);
  if (r.exit !== 0) throw new Error(`tmux resize-pane failed: ${r.stderr || r.stdout}`);
  return { id: t.id };
};

// PaneSwap ----------------------------------------------------------------

export const PaneSwapInputSchema = z.object({
  id: z.string().min(1),
  with_id: z.string().min(1),
});

export const handlePaneSwap = async (
  raw: unknown,
  deps: { statePath?: string },
): Promise<{ a: string; b: string }> => {
  const input = PaneSwapInputSchema.parse(raw);
  const s = loadState(deps.statePath ? { path: deps.statePath } : {});
  const a = findTask(s, input.id);
  const b = findTask(s, input.with_id);
  if (!a || !b) throw new Error("PaneSwap: one or both tasks not found");
  const aTarget = requireTarget(a);
  const bTarget = requireTarget(b);
  const r = await tmux(["swap-pane", "-s", aTarget, "-t", bTarget]);
  if (r.exit !== 0) throw new Error(`tmux swap-pane failed: ${r.stderr || r.stdout}`);
  return { a: a.id, b: b.id };
};
