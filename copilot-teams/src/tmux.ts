import { execa } from "execa";
import { logger } from "./logger.js";

export interface TmuxContext {
  inTmux: boolean;
  pane: string | null;
}

export const getTmuxContext = (env: NodeJS.ProcessEnv = process.env): TmuxContext => ({
  inTmux: Boolean(env.TMUX),
  pane: env.TMUX_PANE ?? null,
});

const tmux = async (args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
  const r = await execa("tmux", args, { reject: false });
  return {
    stdout: r.stdout?.toString() ?? "",
    stderr: r.stderr?.toString() ?? "",
    exitCode: r.exitCode ?? 1,
  };
};

export const tmuxAvailable = async (): Promise<boolean> => {
  try {
    const r = await execa("tmux", ["-V"], { reject: false });
    return (r.exitCode ?? 1) === 0;
  } catch {
    return false;
  }
};

export const currentSession = async (env: NodeJS.ProcessEnv = process.env): Promise<string | null> => {
  if (!env.TMUX) return null;
  const r = await tmux(["display-message", "-p", "#S"]);
  if (r.exitCode !== 0) return null;
  return r.stdout.trim() || null;
};

export const ensureSession = async (session: string): Promise<void> => {
  const has = await tmux(["has-session", "-t", session]);
  if (has.exitCode === 0) return;
  const r = await tmux(["new-session", "-d", "-s", session]);
  if (r.exitCode !== 0) {
    throw new Error(`tmux new-session failed: ${r.stderr || r.stdout}`);
  }
};

export interface SpawnWindowOpts {
  session: string;
  windowName: string;
  command: string; // shell command line; will be `exec`d in window
  cwd?: string;
}

export interface SpawnedWindow {
  session: string;
  windowName: string;
  windowId: string;
  paneId: string;
  panePid: number;
  target: string; // session:windowName
}

export const spawnWindow = async (opts: SpawnWindowOpts): Promise<SpawnedWindow> => {
  await ensureSession(opts.session);
  const args = [
    "new-window",
    "-d",
    "-t",
    opts.session,
    "-n",
    opts.windowName,
    "-P",
    "-F",
    "#{window_id} #{pane_id} #{pane_pid}",
  ];
  if (opts.cwd) {
    args.push("-c", opts.cwd);
  }
  args.push(opts.command);
  const r = await tmux(args);
  if (r.exitCode !== 0) {
    throw new Error(`tmux new-window failed: ${r.stderr || r.stdout}`);
  }
  const parts = r.stdout.trim().split(/\s+/);
  if (parts.length < 3) {
    throw new Error(`tmux new-window: bad output ${JSON.stringify(r.stdout)}`);
  }
  const [windowId, paneId, panePidStr] = parts as [string, string, string];
  const panePid = Number(panePidStr);
  const out: SpawnedWindow = {
    session: opts.session,
    windowName: opts.windowName,
    windowId,
    paneId,
    panePid,
    target: `${opts.session}:${opts.windowName}`,
  };
  logger.info({ event: "tmux.spawn", ...out }, "tmux window spawned");
  return out;
};

// Send a single line + Enter via tmux. Auto-fans-out multi-line content
// through sendBlock so callers don't have to special-case it.
export const sendLine = async (target: string, line: string): Promise<void> => {
  if (line.includes("\n")) {
    await sendBlock(target, line);
    return;
  }
  const r1 = await tmux(["send-keys", "-t", target, "-l", line]);
  if (r1.exitCode !== 0) {
    throw new Error(`tmux send-keys (-l) failed: ${r1.stderr || r1.stdout}`);
  }
  const r2 = await tmux(["send-keys", "-t", target, "Enter"]);
  if (r2.exitCode !== 0) {
    throw new Error(`tmux send-keys (Enter) failed: ${r2.stderr || r2.stdout}`);
  }
};

/** Send a multi-line block. Internal newlines go as Shift+Enter (literal LF
 *  in the input buffer without "submit"); a final Enter submits the block.
 *  Mirrors how a human pastes a multi-line prompt into copilot's REPL. */
export const sendBlock = async (target: string, block: string): Promise<void> => {
  const normalized = block.replace(/\r\n?/g, "\n");
  const trimmed = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  const lines = trimmed.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length > 0) {
      const r = await tmux(["send-keys", "-t", target, "-l", line]);
      if (r.exitCode !== 0) {
        throw new Error(`tmux send-keys (-l) failed: ${r.stderr || r.stdout}`);
      }
    }
    if (i < lines.length - 1) {
      const r = await tmux(["send-keys", "-t", target, "S-Enter"]);
      if (r.exitCode !== 0) {
        throw new Error(`tmux send-keys (S-Enter) failed: ${r.stderr || r.stdout}`);
      }
    }
  }
  const submit = await tmux(["send-keys", "-t", target, "Enter"]);
  if (submit.exitCode !== 0) {
    throw new Error(`tmux send-keys (Enter) failed: ${submit.stderr || submit.stdout}`);
  }
};

export interface CaptureOpts {
  start?: number | "earliest"; // -S
  end?: number | "latest"; // -E
  joinWrapped?: boolean; // -J
}

export const capturePane = async (target: string, opts: CaptureOpts = {}): Promise<string> => {
  const args = ["capture-pane", "-p", "-t", target];
  if (opts.joinWrapped !== false) args.push("-J");
  const start = opts.start ?? "earliest";
  args.push("-S", start === "earliest" ? "-" : String(start));
  if (opts.end !== undefined) {
    args.push("-E", opts.end === "latest" ? "-" : String(opts.end));
  }
  const r = await tmux(args);
  if (r.exitCode !== 0) {
    throw new Error(`tmux capture-pane failed: ${r.stderr || r.stdout}`);
  }
  return r.stdout;
};

export const killWindow = async (target: string): Promise<void> => {
  const r = await tmux(["kill-window", "-t", target]);
  if (r.exitCode !== 0 && !r.stderr.includes("can't find window")) {
    throw new Error(`tmux kill-window failed: ${r.stderr || r.stdout}`);
  }
};

export const killPane = async (target: string): Promise<void> => {
  const r = await tmux(["kill-pane", "-t", target]);
  if (r.exitCode !== 0 && !/can't find pane|no such pane/i.test(r.stderr)) {
    throw new Error(`tmux kill-pane failed: ${r.stderr || r.stdout}`);
  }
};

/** Pane ids ("%5") are globally unique within a tmux server; use this prefix
 *  to discriminate from session:windowName-style targets. */
export const isPaneId = (target: string): boolean => /^%\d+$/.test(target);

export const paneExists = async (target: string): Promise<boolean> => {
  const r = await tmux(["display-message", "-p", "-t", target, "#{pane_id}"]);
  return r.exitCode === 0 && r.stdout.trim() === target;
};

export interface SpawnPaneOpts {
  /** Target pane to split. Splits HORIZONTALLY by default (new pane on the
   *  right), so the parent stays put and the new pane appears beside it. */
  parent: string;
  command: string;
  cwd?: string;
  horizontal?: boolean;
  percent?: number;
  paneTitle?: string;
}

export interface SpawnedPane {
  paneId: string;
  panePid: number;
  windowId: string;
  session: string;
  windowName: string;
  target: string;
}

export const splitPane = async (opts: SpawnPaneOpts): Promise<SpawnedPane> => {
  const args = ["split-window", opts.horizontal === false ? "-v" : "-h", "-d", "-t", opts.parent];
  if (opts.percent) args.push("-p", String(opts.percent));
  if (opts.cwd) args.push("-c", opts.cwd);
  args.push("-P", "-F", "#{pane_id} #{pane_pid} #{window_id} #{session_name} #{window_name}");
  args.push(opts.command);
  const r = await tmux(args);
  if (r.exitCode !== 0) {
    throw new Error(`tmux split-window failed: ${r.stderr || r.stdout}`);
  }
  const parts = r.stdout.trim().split(/\s+/);
  if (parts.length < 5) {
    throw new Error(`tmux split-window: bad output ${JSON.stringify(r.stdout)}`);
  }
  const [paneId, panePidStr, windowId, session, windowName] = parts as [string, string, string, string, string];
  if (opts.paneTitle) {
    await tmux(["select-pane", "-t", paneId, "-T", opts.paneTitle]);
  }
  const panePid = Number(panePidStr);
  const out: SpawnedPane = { paneId, panePid, windowId, session, windowName, target: paneId };
  logger.info({ event: "tmux.splitPane", ...out, parent: opts.parent }, "tmux pane split");
  return out;
};

/** Apply the "main-vertical" layout so the leftmost (or caller-specified)
 *  pane is the large "command center" and the rest stack vertically on the
 *  right. Optional mainPaneIndex pins which pane gets the left position. */
export const applyMainVertical = async (
  windowOrPane: string,
  opts: { mainPaneIndex?: number; mainPaneWidth?: number } = {},
): Promise<void> => {
  const wid =
    (await tmux(["display-message", "-p", "-t", windowOrPane, "#{window_id}"])).stdout.trim() || windowOrPane;
  if (typeof opts.mainPaneIndex === "number") {
    await tmux(["set-window-option", "-t", wid, "main-pane-index", String(opts.mainPaneIndex)]);
  }
  if (typeof opts.mainPaneWidth === "number") {
    await tmux(["set-window-option", "-t", wid, "main-pane-width", String(opts.mainPaneWidth)]);
  }
  const r = await tmux(["select-layout", "-t", wid, "main-vertical"]);
  if (r.exitCode !== 0) {
    throw new Error(`tmux select-layout main-vertical failed: ${r.stderr || r.stdout}`);
  }
};

export const paneIndexOf = async (target: string): Promise<number | null> => {
  const r = await tmux(["display-message", "-p", "-t", target, "#{pane_index}"]);
  if (r.exitCode !== 0) return null;
  const n = Number(r.stdout.trim());
  return Number.isFinite(n) ? n : null;
};

export const windowOf = async (target: string): Promise<string | null> => {
  const r = await tmux(["display-message", "-p", "-t", target, "#{window_id}"]);
  if (r.exitCode !== 0) return null;
  return r.stdout.trim() || null;
};

export const sessionOf = async (target: string): Promise<string | null> => {
  const r = await tmux(["display-message", "-p", "-t", target, "#{session_name}"]);
  if (r.exitCode !== 0) return null;
  return r.stdout.trim() || null;
};

export interface WindowRow {
  windowId: string;
  windowName: string;
  panePid: number;
}

export const parseListWindows = (stdout: string): WindowRow[] => {
  const rows: WindowRow[] = [];
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    const [windowId, windowName, pidStr] = parts as [string, string, string];
    const panePid = Number(pidStr);
    if (!Number.isFinite(panePid)) continue;
    rows.push({ windowId, windowName, panePid });
  }
  return rows;
};

export const listWindows = async (session: string): Promise<WindowRow[]> => {
  const r = await tmux(["list-windows", "-t", session, "-F", "#{window_id} #{window_name} #{pane_pid}"]);
  if (r.exitCode !== 0) {
    if (r.stderr.includes("session not found") || r.stderr.includes("can't find session")) {
      return [];
    }
    throw new Error(`tmux list-windows failed: ${r.stderr || r.stdout}`);
  }
  return parseListWindows(r.stdout);
};

const SENTINEL_RE = /<<<COPILOT_TURN_DONE:([^>]+)>>>/g;

export interface SentinelHit {
  turn: string;
  index: number;
}

export const findSentinels = (text: string): SentinelHit[] => {
  const hits: SentinelHit[] = [];
  let m: RegExpExecArray | null;
  SENTINEL_RE.lastIndex = 0;
  while ((m = SENTINEL_RE.exec(text)) !== null) {
    hits.push({ turn: m[1] ?? "", index: m.index });
  }
  return hits;
};

export const lastSentinel = (text: string): SentinelHit | null => {
  const hits = findSentinels(text);
  return hits[hits.length - 1] ?? null;
};

// Default tmux session name when parent isn't already inside tmux.
export const defaultTeamSession = (pid: number = process.pid): string =>
  `copilot-team-${pid}`;

export const paneCurrentCommand = async (target: string): Promise<string | null> => {
  const r = await tmux(["display-message", "-p", "-t", target, "#{pane_current_command}"]);
  if (r.exitCode !== 0) return null;
  return r.stdout.trim() || null;
};

const COPILOT_CMD_NAMES = new Set(["copilot", "script", "node"]);

// Poll until the pane's current_command is no longer a copilot-y process
// (copilot itself, the script(1) wrapper, or its node helper). Returns true
// if idle was reached, false on timeout.
export const awaitPaneIdle = async (
  target: string,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<boolean> => {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const pollMs = opts.pollMs ?? 200;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cmd = await paneCurrentCommand(target);
    if (cmd === null) return true; // pane gone — definitely not running copilot
    if (!COPILOT_CMD_NAMES.has(cmd)) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
};
