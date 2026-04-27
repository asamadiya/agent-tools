import { execa, type ExecaError, type ResultPromise } from "execa";
import { logger } from "./logger.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (s: string): boolean => UUID_RE.test(s);

export interface CopilotInvocation {
  uuid: string;
  background: boolean;
  /** Required when background=false. In background mode the prompt is typed
   *  into the persistent REPL via tmux send-keys, not passed on argv. */
  prompt?: string;
  subagentType?: string;
  model?: string;
  mode?: string;
  /** Specific tools to allow (passed as repeated --allow-tool). If omitted
   *  and deniedTools is also omitted, falls back to --allow-all-tools. */
  allowedTools?: string[];
  /** Specific tools to deny (repeated --deny-tool). Combinable with
   *  allowedTools or with the default --allow-all-tools. */
  deniedTools?: string[];
  /** Extra dirs to grant access to (--add-dir, repeated). */
  addDirs?: string[];
}

export const buildArgs = (inv: CopilotInvocation): string[] => {
  if (!isUuid(inv.uuid)) {
    throw new Error(`copilot: bad uuid ${JSON.stringify(inv.uuid)}`);
  }
  if (!inv.background && (!inv.prompt || inv.prompt.length === 0)) {
    throw new Error("copilot: foreground mode requires a non-empty prompt");
  }
  // NOTE: copilot CLI 1.0.34 errors with "--name cannot be used with
  // --resume". Since --resume=<uuid> is our keystone (caller-chosen UUID is
  // the addressable id), we never pass --name. The human-friendly name lives
  // in our state file and surfaces only as the tmux window suffix.
  const args: string[] = [`--resume=${inv.uuid}`];
  if (inv.subagentType) args.push("--agent", inv.subagentType);
  if (inv.model) args.push("--model", inv.model);
  if (inv.mode) args.push("--mode", inv.mode);
  for (const d of inv.addDirs ?? []) args.push("--add-dir", d);

  const hasAllowList = inv.allowedTools && inv.allowedTools.length > 0;
  const hasDenyList = inv.deniedTools && inv.deniedTools.length > 0;
  if (!hasAllowList && !hasDenyList) {
    args.push("--allow-all-tools");
  } else {
    if (hasAllowList) {
      for (const t of inv.allowedTools!) args.push(`--allow-tool=${t}`);
    } else {
      // Deny-only: still need a baseline. Allow-all then carve out denies.
      args.push("--allow-all-tools");
    }
    if (hasDenyList) {
      for (const t of inv.deniedTools!) args.push(`--deny-tool=${t}`);
    }
  }

  if (inv.background) {
    // Persistent interactive REPL — no -p, no -i, no prompt. The caller types
    // the first turn via tmux send-keys after awaiting session.start.
    return args;
  }
  // Foreground: one-shot, response-only.
  args.push("-p", inv.prompt!, "-s");
  return args;
};

export interface ForegroundResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface ForegroundOptions extends CopilotInvocation {
  cwd?: string;
  binary?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export const runForeground = async (
  opts: ForegroundOptions,
): Promise<ForegroundResult> => {
  const args = buildArgs({ ...opts, background: false });
  const binary = opts.binary ?? "copilot";
  const start = Date.now();
  logger.info(
    { event: "copilot.spawn.fg", uuid: opts.uuid, args },
    "spawning copilot foreground",
  );
  try {
    const result = await execa(binary, args, {
      cwd: opts.cwd,
      env: opts.env,
      timeout: opts.timeoutMs ?? 0,
      reject: false,
      stripFinalNewline: false,
    });
    const out: ForegroundResult = {
      stdout: result.stdout?.toString() ?? "",
      stderr: result.stderr?.toString() ?? "",
      exitCode: result.exitCode ?? 1,
      durationMs: Date.now() - start,
    };
    logger.info(
      {
        event: "copilot.exit.fg",
        uuid: opts.uuid,
        exitCode: out.exitCode,
        ms: out.durationMs,
      },
      "copilot foreground exited",
    );
    return out;
  } catch (err) {
    const e = err as ExecaError;
    logger.error({ err: e, uuid: opts.uuid }, "copilot foreground spawn failed");
    throw err;
  }
};

export const buildBackgroundCommand = (
  opts: CopilotInvocation,
  binary = "copilot",
): { binary: string; args: string[] } => ({
  binary,
  args: buildArgs({ ...opts, background: true }),
});

export type { ResultPromise };
