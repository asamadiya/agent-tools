import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { logger } from "../logger.js";
import {
  type CopilotInvocation,
  buildArgs,
  runForeground,
} from "../copilot.js";
import {
  currentSession,
  defaultTeamSession,
  ensureSession,
  getTmuxContext,
  isPaneId,
  paneExists,
  sendLine,
  spawnWindow,
  splitPane,
  tmuxAvailable,
} from "../tmux.js";
import { addWorktree, finalizeWorktree, generateBranchName, isGitRepo } from "../worktree.js";
import {
  awaitSessionReady,
  awaitTurnEnd,
} from "../session-state.js";
import { nowIso, type State, type Task, withState } from "../state.js";
import { type ProgressReporter, noopProgress } from "../progress.js";

export const AgentInputSchema = z.object({
  description: z.string().min(1),
  prompt: z.string().optional(),
  subagent_type: z.string().optional(),
  name: z.string().min(1).optional(),
  team_name: z.string().min(1).optional(),
  run_in_background: z.boolean().default(false),
  model: z.string().optional(),
  isolation: z.literal("worktree").optional(),
  mode: z.string().optional(),
  /** Per-agent tool allowlist. If omitted, --allow-all-tools. */
  allowed_tools: z.array(z.string()).optional(),
  /** Per-agent tool denylist. */
  denied_tools: z.array(z.string()).optional(),
  /** Extra dirs (Copilot --add-dir) granted to this agent. */
  add_dirs: z.array(z.string()).optional(),
  /** For background agents, wait this long for the first turn to complete
   *  and return its content in `output`. 0 = don't wait, return immediately
   *  after session.start. Default: 0 (return after spawn). */
  wait_first_turn_ms: z.number().int().nonnegative().optional(),
  /** Per-agent env vars (propagate to the child process). */
  env: z.record(z.string(), z.string()).optional(),
  /** Per-agent working directory (overrides parent cwd). Combinable with
   *  isolation:'worktree' (which overrides cwd to a fresh worktree). */
  cwd: z.string().optional(),
  /** Inline system prompt / persona. Materialized as a temp Copilot custom
   *  agent (.md file under ~/.copilot/agents/) and selected via --agent so
   *  it lands as a real system prompt — not as a typed-in user message.
   *  Mutually exclusive with subagent_type (use one or the other). */
  system_prompt: z.string().optional(),
  /** Override the tmux pane to anchor this team's layout to. When set, the
   *  spawn splits this pane (or its window's existing chain) instead of
   *  whatever TMUX_PANE happens to be. Useful when the MCP server has been
   *  re-spawned and TMUX_PANE follows the user's current focus, OR when you
   *  want to pin a team to a specific pane regardless of focus. */
  parent_pane: z.string().regex(/^%\d+$/).optional(),
});

export type AgentInput = z.infer<typeof AgentInputSchema>;

export interface AgentOutput {
  id: string;
  status: Task["status"];
  /** First-turn assistant content (background with wait_first_turn_ms>0) or
   *  full stdout (foreground). */
  output?: string;
  exitCode?: number;
  tmuxTarget?: string;
  isolation?: { worktree: string; branch: string } | null;
  /** Background only: turnId of the first turn if waited for. */
  firstTurnId?: string;
}

export interface AgentDeps {
  cwd: string;
  binary?: string;
  statePath?: string;
  env?: Record<string, string>;
  /** Override session-state root (testing). */
  sessionRoot?: string;
}

const shortUuid = (uuid: string): string => uuid.replace(/-/g, "").slice(0, 8);

const buildWindowName = (input: AgentInput, uuid: string): string =>
  `cop:${input.name ?? shortUuid(uuid)}`;

const recordTask = async (
  uuid: string,
  input: AgentInput,
  extras: Partial<Task>,
  statePath: string | undefined,
): Promise<void> => {
  await withState((s: State) => {
    if (input.team_name && !s.teams[input.team_name]) {
      s.teams[input.team_name] = { name: input.team_name, createdAt: nowIso() };
    }
    s.tasks[uuid] = {
      id: uuid,
      status: "running",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      description: input.description,
      ...(input.prompt ? { prompt: input.prompt } : {}),
      background: input.run_in_background,
      ...(input.name ? { name: input.name } : {}),
      ...(input.team_name ? { team: input.team_name } : {}),
      ...(input.subagent_type ? { subagentType: input.subagent_type } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...extras,
    };
    return s;
  }, statePath ? { path: statePath } : {});
};

const updateTask = async (
  uuid: string,
  patch: Partial<Task>,
  statePath: string | undefined,
): Promise<void> => {
  await withState((s: State) => {
    const t = s.tasks[uuid];
    if (t) {
      s.tasks[uuid] = { ...t, ...patch, updatedAt: nowIso() };
    }
    return s;
  }, statePath ? { path: statePath } : {});
};

const shellQuote = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;

/** Build the command for the persistent interactive copilot REPL inside a
 *  tmux pane. No script(1) wrapper — events.jsonl is the canonical log. */
export const buildBackgroundShellCommand = (
  binary: string,
  args: string[],
  env: Record<string, string> = {},
): string => {
  const envPrefix = Object.entries(env)
    .map(([k, v]) => `${k}=${shellQuote(v)}`)
    .join(" ");
  const cmd = [binary, ...args].map(shellQuote).join(" ");
  const full = envPrefix ? `env ${envPrefix} ${cmd}` : cmd;
  // `; exec bash` keeps the pane attachable if the user manually quits the
  // REPL — they can still inspect scrollback or restart manually.
  return `${full}; exec bash`;
};

export const handleAgent = async (
  raw: unknown,
  deps: AgentDeps,
  progress: ProgressReporter = noopProgress,
): Promise<AgentOutput> => {
  const input = AgentInputSchema.parse(raw);
  const uuid = randomUUID();
  // Per-agent cwd overrides deps.cwd (the parent's cwd at server start).
  const cwd = input.cwd ?? deps.cwd;
  const binary = deps.binary ?? "copilot";
  const mergedEnv: Record<string, string> = { ...(deps.env ?? {}), ...(input.env ?? {}) };

  let isolation: { worktree: string; branch: string } | null = null;
  let runCwd = cwd;
  let isolationHandle: Awaited<ReturnType<typeof addWorktree>> | null = null;
  if (input.isolation === "worktree") {
    if (!(await isGitRepo(cwd))) {
      throw new Error("isolation:'worktree' requires a git repo cwd");
    }
    const branch = generateBranchName(input.name ?? input.description.slice(0, 24), uuid);
    isolationHandle = await addWorktree(cwd, branch);
    runCwd = isolationHandle.worktree;
    isolation = { worktree: isolationHandle.worktree, branch: isolationHandle.branch };
  }

  // If the caller passed an inline system_prompt, materialize a temp Copilot
  // custom agent under ~/.copilot/agents/ so --agent picks it up as a real
  // system prompt. Naming pattern is recognizable for GC.
  let agentName = input.subagent_type;
  if (input.system_prompt) {
    if (input.subagent_type) {
      throw new Error("Agent: pass either subagent_type or system_prompt, not both");
    }
    const tmpName = `_ct_tmp_${uuid.replace(/-/g, "")}`;
    const agentsDir = join(homedir(), ".copilot", "agents");
    mkdirSync(agentsDir, { recursive: true });
    const body = `---\nname: ${tmpName}\ndescription: ephemeral system prompt for copilot-teams uuid=${uuid}\n---\n\n${input.system_prompt}\n`;
    writeFileSync(join(agentsDir, `${tmpName}.md`), body);
    agentName = tmpName;
  }

  const inv: CopilotInvocation = {
    uuid,
    background: input.run_in_background,
    ...(input.prompt ? { prompt: input.prompt } : {}),
    ...(agentName ? { subagentType: agentName } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.allowed_tools ? { allowedTools: input.allowed_tools } : {}),
    ...(input.denied_tools ? { deniedTools: input.denied_tools } : {}),
    ...(input.add_dirs ? { addDirs: input.add_dirs } : {}),
  };

  await recordTask(uuid, input, isolation ? { isolation } : {}, deps.statePath);
  await progress(1, undefined, "task recorded");

  if (!input.run_in_background) {
    if (!input.prompt) {
      throw new Error("foreground Agent requires a prompt");
    }
    const result = await runForeground({
      ...inv,
      prompt: input.prompt,
      cwd: runCwd,
      binary,
      ...(Object.keys(mergedEnv).length > 0 ? { env: { ...process.env, ...mergedEnv } as Record<string, string> } : {}),
    });
    let kept = false;
    if (isolationHandle) {
      const fin = await finalizeWorktree(isolationHandle);
      kept = fin.kept;
    }
    await updateTask(
      uuid,
      {
        status: result.exitCode === 0 ? "exited" : "stopped",
        exitCode: result.exitCode,
        ...(isolation && !kept ? { isolation: null } : {}),
      },
      deps.statePath,
    );
    logger.info({ event: "agent.fg.done", uuid, exitCode: result.exitCode }, "agent foreground done");
    return {
      id: uuid,
      status: result.exitCode === 0 ? "exited" : "stopped",
      output: result.stdout,
      exitCode: result.exitCode,
      isolation: kept ? isolation : null,
    };
  }

  // Background — persistent interactive copilot in a tmux pane.
  if (!(await tmuxAvailable())) {
    throw new Error("background spawn requires tmux on PATH");
  }
  const ctx = getTmuxContext();
  const session = ctx.inTmux
    ? (process.env.TMUX_SESSION ?? (await currentSession()) ?? defaultTeamSession())
    : defaultTeamSession();
  await ensureSession(session);

  const args = buildArgs(inv);
  const logPath = `${process.env.HOME}/.copilot/agent-teams/logs/${uuid}.log`;
  mkdirSync(dirname(logPath), { recursive: true });
  const command = buildBackgroundShellCommand(binary, args, mergedEnv);
  const windowName = buildWindowName(input, uuid);

  // Layout: when the parent itself is in a tmux pane (the common case for an
  // interactive copilot session), spawn the agent as a SPLIT in the same
  // window so the parent stays as the "command center" on the left and agents
  // stack vertically on the right.
  //
  // Strategy is *chain split* — never `select-layout main-vertical`, which
  // would reflow every pane in the window and clobber unrelated panes
  // (vim/logs/etc.) the user has open. Instead:
  //   - First agent in this window: split the parent pane horizontally.
  //     parent stays where it was, new pane appears to its right.
  //   - Subsequent agents: split the most-recent live agent pane vertically.
  //     The right column grows downward without touching the parent or any
  //     other pane in the window.
  //
  // Falls back to a separate window when the parent isn't in tmux.
  let target: string;
  let panePid: number;
  // Resolution order for the team's anchor pane:
  //   1. input.parent_pane — explicit override from the caller. Pin a team
  //      to a specific pane regardless of focus or env state.
  //   2. Any existing agent's pane that still exists in tmux — the team's
  //      anchor window is wherever those panes already live. Status field
  //      is intentionally NOT consulted: tmux is the source of truth, our
  //      `running`/`stopped` field can drift after manual kill/restart, and
  //      a pane the user can still see is a legit chain target.
  //   3. process.env.TMUX_PANE — fall-through for the very first spawn.
  //      Read fresh per call because the MCP server may have been respawned
  //      by copilot, in which case it inherited the user's *current* shell
  //      env. That's correct for the first agent but should never override
  //      an existing chain (handled by ordering above).
  const explicitParent = (input as { parent_pane?: string }).parent_pane;
  const fallbackParent = process.env.TMUX_PANE;
  const useSplitLayout = ctx.inTmux && Boolean(explicitParent || fallbackParent);
  if (useSplitLayout) {
    let chainParent: string | null = null;
    if (!explicitParent) {
      const cur = (await import("../state.js")).loadState(deps.statePath ? { path: deps.statePath } : {});
      for (const t of Object.values(cur.tasks).reverse()) {
        if (!t.tmuxTarget || !isPaneId(t.tmuxTarget)) continue;
        if (!(await paneExists(t.tmuxTarget))) continue;
        chainParent = t.tmuxTarget;
        break;
      }
    }
    const splitFrom = explicitParent ?? chainParent ?? fallbackParent!;
    // First-in-team split is left/right (parent | new); subsequent splits
    // stack vertically off the chain parent. Explicit parent_pane is treated
    // as "first split" so the caller's anchor stays as the left column.
    const horizontal = !chainParent;
    const sp = await splitPane({
      parent: splitFrom,
      command,
      ...(runCwd !== process.cwd() ? { cwd: runCwd } : {}),
      horizontal,
      paneTitle: windowName,
    });
    target = sp.target;
    panePid = sp.panePid;
    // Make the pane title visible by enabling per-window border-status, so the
    // user actually sees `cop:<name>` above each agent's pane. Per-window so
    // we don't disturb other tmux windows.
    try {
      const { execa } = await import("execa");
      const win = sp.windowId;
      await execa("tmux", ["set-window-option", "-t", win, "pane-border-status", "top"], { reject: false });
      await execa("tmux", ["set-window-option", "-t", win, "pane-border-format", " #{pane_title} "], { reject: false });
    } catch {
      /* cosmetic only */
    }
  } else {
    const w = await spawnWindow({ session, windowName, command, cwd: runCwd });
    target = w.target;
    panePid = w.panePid;
  }

  await updateTask(
    uuid,
    { pid: panePid, tmuxTarget: target, log: logPath },
    deps.statePath,
  );

  await progress(2, undefined, "tmux pane spawned");

  // Optimistically wait for events.jsonl session.start so we can confidently
  // type the initial prompt in. Real copilot can take 30-60s on cold start,
  // so the timeout is generous. If it doesn't land we log + continue — the
  // pane is alive, the user can attach and watch / call Status later.
  try {
    await awaitSessionReady(uuid, {
      timeoutMs: input.wait_first_turn_ms ? Math.max(120_000, input.wait_first_turn_ms) : 120_000,
      ...(deps.sessionRoot ? { root: deps.sessionRoot } : {}),
    });
    await progress(3, undefined, "session.start landed");
  } catch (err) {
    logger.warn(
      { err, uuid, target },
      "agent: events.jsonl session.start did not land in time; pane is up, continuing",
    );
    // Don't mark stopped — the pane is alive and the session may still be
    // initializing. Caller can poll Status to wait for ready=true.
  }

  // If the caller gave an initial prompt, type it in.
  let firstTurn: { turnId: string; content: string } | null = null;
  if (input.prompt) {
    await sendLine(target, input.prompt);
    await progress(4, undefined, "initial prompt sent");
    if ((input.wait_first_turn_ms ?? 0) > 0) {
      try {
        const r = await awaitTurnEnd(uuid, {
          baselineTurnCount: 0,
          timeoutMs: input.wait_first_turn_ms!,
          ...(deps.sessionRoot ? { root: deps.sessionRoot } : {}),
        });
        firstTurn = { turnId: r.turnId, content: r.content };
        await progress(5, undefined, "first turn ended");
      } catch (err) {
        logger.warn({ err, uuid }, "agent: first turn did not end within wait_first_turn_ms");
      }
    }
  }

  return {
    id: uuid,
    status: "running",
    tmuxTarget: target,
    isolation,
    ...(firstTurn ? { output: firstTurn.content, firstTurnId: firstTurn.turnId } : {}),
  };
};
