import { execa } from "execa";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type ProgressReporter, noopProgress } from "../progress.js";
import { handleSendMessage, type SendMessageOutput } from "./send-message.js";
import { buildArgs } from "../copilot.js";
import { isPaneId, paneExists } from "../tmux.js";
import { buildBackgroundShellCommand } from "./agent.js";
import { awaitSessionReady } from "../session-state.js";
import {
  AgentInputSchema,
  handleAgent,
  type AgentDeps,
  type AgentOutput,
} from "./agent.js";
import { handleTaskStop } from "./tasks.js";
import { listAllSessionUuids, removeSession } from "../session-state.js";
import { loadState, withState, nowIso, type State, type Task } from "../state.js";
import { logger } from "../logger.js";

const findTask = (s: State, id: string): Task | null => {
  if (s.tasks[id]) return s.tasks[id]!;
  for (const t of Object.values(s.tasks)) if (t.name === id) return t;
  return null;
};

// SendToTeam --------------------------------------------------------------

export const SendToTeamInputSchema = z.object({
  team: z.string().min(1),
  message: z.string().min(1),
  mode: z.enum(["broadcast", "first"]).default("broadcast"),
  timeout_ms: z.number().int().positive().optional(),
  /** Limit concurrent send-keys; default = no limit. */
  concurrency: z.number().int().positive().optional(),
  /** Forwarded to each SendMessage. */
  subprocess: z.boolean().optional(),
  model: z.string().optional(),
});
export type SendToTeamInput = z.infer<typeof SendToTeamInputSchema>;

export interface SendToTeamOutput {
  team: string;
  mode: "broadcast" | "first";
  results: Array<{ id: string; name?: string; output: string; turnId?: string; error?: string }>;
}

export const handleSendToTeam = async (
  raw: unknown,
  deps: { binary?: string; statePath?: string; sessionRoot?: string; cwd?: string },
  progress: ProgressReporter = noopProgress,
): Promise<SendToTeamOutput> => {
  const input = SendToTeamInputSchema.parse(raw);
  const s = loadState(deps.statePath ? { path: deps.statePath } : {});
  const members = Object.values(s.tasks).filter(
    (t) => t.team === input.team && t.status === "running",
  );
  if (members.length === 0) {
    logger.warn({ team: input.team }, "SendToTeam: no running members");
    return { team: input.team, mode: input.mode, results: [] };
  }
  await progress(0, members.length, `dispatching to ${members.length} members`);

  const dispatch = async (t: Task) => {
    try {
      const r = await handleSendMessage(
        {
          to: t.id,
          message: input.message,
          ...(input.subprocess ? { subprocess: input.subprocess } : {}),
          ...(input.model ? { model: input.model } : {}),
          ...(input.timeout_ms ? { timeout_ms: input.timeout_ms } : {}),
        },
        deps,
      );
      return { id: t.id, ...(t.name ? { name: t.name } : {}), output: r.output, ...(r.turnId ? { turnId: r.turnId } : {}) };
    } catch (err) {
      return {
        id: t.id,
        ...(t.name ? { name: t.name } : {}),
        output: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  if (input.mode === "first") {
    const firstWinner: SendToTeamOutput["results"][number] = await Promise.race(members.map(dispatch));
    return { team: input.team, mode: "first", results: [firstWinner] };
  }
  // broadcast: limit concurrency if requested
  const conc = input.concurrency ?? members.length;
  const results: SendToTeamOutput["results"] = [];
  for (let i = 0; i < members.length; i += conc) {
    const batch = members.slice(i, i + conc);
    const got = await Promise.all(batch.map(dispatch));
    results.push(...got);
    await progress(results.length, members.length, `${results.length}/${members.length} replied`);
  }
  return { team: input.team, mode: "broadcast", results };
};

// Restart -----------------------------------------------------------------

export const RestartInputSchema = z.object({
  id: z.string().min(1),
  /** Override the spawn prompt. Default: re-use the original. */
  prompt: z.string().optional(),
});

export const handleRestart = async (
  raw: unknown,
  deps: AgentDeps,
): Promise<AgentOutput> => {
  const input = RestartInputSchema.parse(raw);
  const s = loadState(deps.statePath ? { path: deps.statePath } : {});
  const t = findTask(s, input.id);
  if (!t) throw new Error(`Restart: no task addressable as ${JSON.stringify(input.id)}`);

  // In-place restart: when the task has a live tmux pane id, recycle it via
  // `tmux respawn-pane -k <new copilot command>` so the agent comes back in
  // the same visual slot of the same window. New uuid (so events.jsonl is
  // clean) but same pane → no orphans, no layout drift.
  if (t.tmuxTarget && isPaneId(t.tmuxTarget) && (await paneExists(t.tmuxTarget))) {
    const oldUuid = t.id;
    const newUuid = randomUUID();
    const binary = deps.binary ?? "copilot";
    const inv = {
      uuid: newUuid,
      background: true,
      ...(t.subagentType ? { subagentType: t.subagentType } : {}),
      ...(t.model ? { model: t.model } : {}),
    };
    const args = buildArgs(inv);
    const logPath = `${process.env.HOME}/.copilot/agent-teams/logs/${newUuid}.log`;
    mkdirSync(dirname(logPath), { recursive: true });
    const cmd = buildBackgroundShellCommand(binary, args, deps.env ?? {});
    const r = await execa(
      "tmux",
      ["respawn-pane", "-k", "-t", t.tmuxTarget, cmd],
      { reject: false },
    );
    if ((r.exitCode ?? 1) !== 0) {
      throw new Error(`tmux respawn-pane failed: ${r.stderr || r.stdout}`);
    }
    // Stop the old task record, then create a new one with the same pane.
    await withState(async (cur) => {
      const old = cur.tasks[oldUuid];
      if (old) {
        cur.tasks[oldUuid] = { ...old, status: "stopped", updatedAt: nowIso() };
      }
      cur.tasks[newUuid] = {
        id: newUuid,
        status: "running",
        description: t.description ?? "restarted",
        ...(input.prompt ? { prompt: input.prompt } : t.prompt ? { prompt: t.prompt } : {}),
        background: true,
        tmuxTarget: t.tmuxTarget!,
        log: logPath,
        ...(t.name ? { name: t.name } : {}),
        ...(t.team ? { team: t.team } : {}),
        ...(t.subagentType ? { subagentType: t.subagentType } : {}),
        ...(t.model ? { model: t.model } : {}),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      return cur;
    }, deps.statePath ? { path: deps.statePath } : {});

    // Wait for the fresh session.start, then optionally type the prompt.
    try {
      await awaitSessionReady(newUuid, {
        timeoutMs: 120_000,
        ...(deps.sessionRoot ? { root: deps.sessionRoot } : {}),
      });
    } catch (err) {
      // Pane is up; events.jsonl just hasn't landed yet. Caller can poll Status.
    }
    if (input.prompt ?? t.prompt) {
      const { sendLine } = await import("../tmux.js");
      await sendLine(t.tmuxTarget!, (input.prompt ?? t.prompt)!);
    }
    return {
      id: newUuid,
      status: "running",
      tmuxTarget: t.tmuxTarget!,
      isolation: t.isolation ?? null,
    };
  }

  // Fallback: no recyclable pane (foreground task, or pane gone). Stop and
  // spawn fresh.
  if (t.status === "running") {
    await handleTaskStop(
      { id: t.id },
      {
        ...(deps.statePath ? { statePath: deps.statePath } : {}),
        ...(deps.sessionRoot ? { sessionRoot: deps.sessionRoot } : {}),
      },
    );
  }
  const config: z.infer<typeof AgentInputSchema> = AgentInputSchema.parse({
    description: t.description ?? "restarted",
    prompt: input.prompt ?? t.prompt,
    run_in_background: t.background ?? true,
    ...(t.name ? { name: t.name } : {}),
    ...(t.team ? { team_name: t.team } : {}),
    ...(t.subagentType ? { subagent_type: t.subagentType } : {}),
    ...(t.model ? { model: t.model } : {}),
  });
  return handleAgent(config, deps);
};

// Pause / Resume ----------------------------------------------------------

export const PauseInputSchema = z.object({ id: z.string().min(1) });
export const handlePause = async (
  raw: unknown,
  deps: { statePath?: string },
): Promise<{ id: string; signaled: boolean }> => {
  const input = PauseInputSchema.parse(raw);
  const s = loadState(deps.statePath ? { path: deps.statePath } : {});
  const t = findTask(s, input.id);
  if (!t) throw new Error(`Pause: no task ${input.id}`);
  if (typeof t.pid !== "number" || t.pid <= 0) {
    throw new Error(`Pause: task ${t.id} has no pid (foreground task?)`);
  }
  try {
    process.kill(t.pid, "SIGSTOP");
    return { id: t.id, signaled: true };
  } catch (err) {
    logger.warn({ err, id: t.id, pid: t.pid }, "Pause failed");
    return { id: t.id, signaled: false };
  }
};

export const ResumeInputSchema = z.object({ id: z.string().min(1) });
export const handleResume = async (
  raw: unknown,
  deps: { statePath?: string },
): Promise<{ id: string; signaled: boolean }> => {
  const input = ResumeInputSchema.parse(raw);
  const s = loadState(deps.statePath ? { path: deps.statePath } : {});
  const t = findTask(s, input.id);
  if (!t) throw new Error(`Resume: no task ${input.id}`);
  if (typeof t.pid !== "number" || t.pid <= 0) {
    throw new Error(`Resume: task ${t.id} has no pid`);
  }
  try {
    process.kill(t.pid, "SIGCONT");
    return { id: t.id, signaled: true };
  } catch (err) {
    logger.warn({ err, id: t.id, pid: t.pid }, "Resume failed");
    return { id: t.id, signaled: false };
  }
};

// GC ----------------------------------------------------------------------

export const GcInputSchema = z.object({
  dry_run: z.boolean().default(false),
  /** Remove session-state dirs whose UUIDs are not in our task state. */
  orphan_session_dirs: z.boolean().default(true),
  /** Remove task records whose status is exited/stopped and updatedAt is
   *  older than this many hours. */
  prune_exited_older_than_hours: z.number().int().positive().optional(),
});
export type GcInput = z.infer<typeof GcInputSchema>;

export interface GcOutput {
  dryRun: boolean;
  orphanSessionDirsRemoved: string[];
  ephemeralPersonaFilesRemoved: string[];
  prunedTaskIds: string[];
}

export const handleGc = async (
  raw: unknown,
  deps: { statePath?: string; sessionRoot?: string },
): Promise<GcOutput> => {
  const input = GcInputSchema.parse(raw);
  const s = loadState(deps.statePath ? { path: deps.statePath } : {});
  const knownUuids = new Set(Object.keys(s.tasks));

  const orphans: string[] = [];
  if (input.orphan_session_dirs) {
    for (const u of listAllSessionUuids(deps.sessionRoot)) {
      if (!knownUuids.has(u)) {
        orphans.push(u);
        if (!input.dry_run) {
          removeSession(u, deps.sessionRoot);
        }
      }
    }
  }

  // Sweep ephemeral system_prompt persona files (.md) whose uuid is not in
  // our task state. Naming pattern: `_ct_tmp_<uuid-no-dashes>.md`.
  const ephemeralPersonaFiles: string[] = [];
  if (input.orphan_session_dirs) {
    try {
      const { homedir } = await import("node:os");
      const { readdirSync, unlinkSync } = await import("node:fs");
      const { join } = await import("node:path");
      const dir = join(homedir(), ".copilot", "agents");
      const knownTrimmed = new Set(Array.from(knownUuids).map((u) => u.replace(/-/g, "")));
      for (const f of readdirSync(dir)) {
        const m = /^_ct_tmp_([0-9a-f]{32})\.md$/.exec(f);
        if (!m) continue;
        if (knownTrimmed.has(m[1]!)) continue;
        ephemeralPersonaFiles.push(f);
        if (!input.dry_run) unlinkSync(join(dir, f));
      }
    } catch {
      /* dir missing or unreadable — nothing to GC */
    }
  }

  const pruned: string[] = [];
  if (typeof input.prune_exited_older_than_hours === "number") {
    const cutoff = Date.now() - input.prune_exited_older_than_hours * 3_600_000;
    if (!input.dry_run) {
      await withState(async (cur) => {
        for (const [id, t] of Object.entries(cur.tasks)) {
          if (t.status !== "exited" && t.status !== "stopped" && t.status !== "completed") continue;
          const updated = Date.parse(t.updatedAt);
          if (Number.isFinite(updated) && updated < cutoff) {
            pruned.push(id);
            delete cur.tasks[id];
          }
        }
        return cur;
      }, deps.statePath ? { path: deps.statePath } : {});
    } else {
      for (const [id, t] of Object.entries(s.tasks)) {
        if (t.status !== "exited" && t.status !== "stopped" && t.status !== "completed") continue;
        const updated = Date.parse(t.updatedAt);
        if (Number.isFinite(updated) && updated < cutoff) pruned.push(id);
      }
    }
  }

  await withState(async (cur) => {
    cur.tasks = Object.fromEntries(
      Object.entries(cur.tasks).map(([k, v]) => [k, { ...v, updatedAt: nowIso() }]),
    );
    return cur;
  }, deps.statePath ? { path: deps.statePath } : {}).catch(() => undefined);

  return {
    dryRun: input.dry_run,
    orphanSessionDirsRemoved: orphans,
    ephemeralPersonaFilesRemoved: ephemeralPersonaFiles,
    prunedTaskIds: pruned,
  };
};
