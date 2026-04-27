import {
  existsSync,
  readFileSync,
  statSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logger } from "./logger.js";

export interface SessionEvent {
  type: string;
  data: Record<string, unknown>;
  id: string;
  timestamp: string;
  parentId: string | null;
}

const SESSION_ROOT = join(homedir(), ".copilot", "session-state");

export const sessionDir = (uuid: string, root: string = SESSION_ROOT): string =>
  join(root, uuid);

export const eventsPath = (uuid: string, root?: string): string =>
  join(sessionDir(uuid, root), "events.jsonl");

export const sessionExists = (uuid: string, root?: string): boolean =>
  existsSync(sessionDir(uuid, root));

const parseLine = (line: string): SessionEvent | null => {
  if (!line.trim()) return null;
  try {
    const e = JSON.parse(line) as SessionEvent;
    if (typeof e.type !== "string") return null;
    return e;
  } catch {
    return null;
  }
};

export interface ReadEventsOpts {
  root?: string;
  /** Skip events whose `id` is at or before this id (exclusive). Useful for
   *  tailing — pass the last seen id to get only new events. */
  afterId?: string | null;
  /** Cap returned events to the last N. Applied after afterId filter. */
  tail?: number;
}

export const readEvents = (uuid: string, opts: ReadEventsOpts = {}): SessionEvent[] => {
  const path = eventsPath(uuid, opts.root);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  const out: SessionEvent[] = [];
  let pastCursor = !opts.afterId;
  for (const line of raw.split("\n")) {
    const e = parseLine(line);
    if (!e) continue;
    if (!pastCursor) {
      if (e.id === opts.afterId) pastCursor = true;
      continue;
    }
    out.push(e);
  }
  if (opts.tail && out.length > opts.tail) {
    return out.slice(out.length - opts.tail);
  }
  return out;
};

const TURN_END = "assistant.turn_end";
const TURN_START = "assistant.turn_start";
const MSG = "assistant.message";
const USER_MSG = "user.message";
const SHUTDOWN = "session.shutdown";

export type LivenessState =
  | "missing"
  | "starting"
  | "idle"
  | "busy"
  | "shutdown";

export interface SessionLiveness {
  state: LivenessState;
  exists: boolean;
  lastEventType: string | null;
  lastEventTimestamp: string | null;
  lastEventAgeMs: number | null;
  turnCount: number;
  lastTurnId: string | null;
  shutdownType: string | null;
}

export const sessionLiveness = (uuid: string, root?: string): SessionLiveness => {
  if (!sessionExists(uuid, root)) {
    return {
      state: "missing",
      exists: false,
      lastEventType: null,
      lastEventTimestamp: null,
      lastEventAgeMs: null,
      turnCount: 0,
      lastTurnId: null,
      shutdownType: null,
    };
  }
  const events = readEvents(uuid, root ? { root } : {});
  let lastEvent: SessionEvent | null = null;
  let turnCount = 0;
  let lastTurnId: string | null = null;
  let shutdownType: string | null = null;
  let inTurn = false;
  for (const e of events) {
    lastEvent = e;
    if (e.type === TURN_START) {
      inTurn = true;
      const tid = (e.data as { turnId?: string }).turnId;
      if (typeof tid === "string") lastTurnId = tid;
    } else if (e.type === TURN_END) {
      inTurn = false;
      turnCount += 1;
      const tid = (e.data as { turnId?: string }).turnId;
      if (typeof tid === "string") lastTurnId = tid;
    } else if (e.type === SHUTDOWN) {
      const st = (e.data as { shutdownType?: string }).shutdownType;
      if (typeof st === "string") shutdownType = st;
    }
  }
  let state: LivenessState;
  if (shutdownType) state = "shutdown";
  else if (inTurn) state = "busy";
  else if (turnCount === 0) state = "starting";
  else state = "idle";

  let lastEventAgeMs: number | null = null;
  let lastEventTimestamp: string | null = null;
  if (lastEvent) {
    lastEventTimestamp = lastEvent.timestamp;
    const ts = Date.parse(lastEvent.timestamp);
    if (Number.isFinite(ts)) lastEventAgeMs = Math.max(0, Date.now() - ts);
  } else {
    // Empty events.jsonl — file exists but no events yet. Use mtime as a hint.
    try {
      const st = statSync(eventsPath(uuid, root));
      lastEventAgeMs = Math.max(0, Date.now() - st.mtimeMs);
    } catch {
      /* ignore */
    }
  }

  return {
    state,
    exists: true,
    lastEventType: lastEvent?.type ?? null,
    lastEventTimestamp,
    lastEventAgeMs,
    turnCount,
    lastTurnId,
    shutdownType,
  };
};

export interface AwaitTurnEndOpts {
  root?: string;
  /** Wait until the count of assistant.turn_end events strictly exceeds this
   *  baseline. Read it from sessionLiveness().turnCount before sending input.
   *  null/undefined → wait for any first turn_end. */
  baselineTurnCount?: number | null;
  /** Polling interval, ms. */
  pollMs?: number;
  /** Hard timeout, ms. */
  timeoutMs?: number;
}

export interface TurnResult {
  turnId: string;
  content: string;
  /** Index of the assistant.message in the full event list. */
  messageIndex: number;
}

export const awaitTurnEnd = async (
  uuid: string,
  opts: AwaitTurnEndOpts = {},
): Promise<TurnResult> => {
  const baseline = opts.baselineTurnCount ?? 0;
  const pollMs = opts.pollMs ?? 200;
  const timeoutMs = opts.timeoutMs ?? 60_000 * 5;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = readEvents(uuid, opts.root ? { root: opts.root } : {});
    // Walk forward, count turn_ends until we exceed baseline, then return that
    // one's content (with its preceding assistant.message).
    let count = 0;
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      if (e.type !== TURN_END) continue;
      count += 1;
      if (count <= baseline) continue;
      const tid = (e.data as { turnId?: string }).turnId;
      let messageContent = "";
      let messageIndex = -1;
      for (let j = i - 1; j >= 0; j--) {
        const ej = events[j]!;
        if (ej.type === TURN_START) break;
        if (ej.type === MSG) {
          const c = (ej.data as { content?: string }).content;
          if (typeof c === "string") {
            messageContent = c;
            messageIndex = j;
          }
          break;
        }
      }
      return { turnId: typeof tid === "string" ? tid : String(count - 1), content: messageContent, messageIndex };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`awaitTurnEnd: timed out after ${timeoutMs}ms (uuid=${uuid})`);
};

export interface AwaitReadyOpts {
  root?: string;
  pollMs?: number;
  timeoutMs?: number;
}

/** Resolves once events.jsonl contains a session.start (or session.resume). */
export const awaitSessionReady = async (
  uuid: string,
  opts: AwaitReadyOpts = {},
): Promise<void> => {
  const pollMs = opts.pollMs ?? 100;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = readEvents(uuid, opts.root ? { root: opts.root } : {});
    if (events.some((e) => e.type === "session.start" || e.type === "session.resume")) {
      return;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`awaitSessionReady: no session.start within ${timeoutMs}ms`);
};

export interface TranscriptTurn {
  turnId: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
}

export const getTranscript = (
  uuid: string,
  opts: { root?: string; sinceTurn?: number } = {},
): TranscriptTurn[] => {
  const events = readEvents(uuid, opts.root ? { root: opts.root } : {});
  const turns: TranscriptTurn[] = [];
  let currentTurnId: string | null = null;
  for (const e of events) {
    if (e.type === TURN_START) {
      const tid = (e.data as { turnId?: string }).turnId;
      currentTurnId = typeof tid === "string" ? tid : null;
      // user.message that immediately preceded this turn_start belongs to it.
      for (let i = turns.length - 1; i >= 0; i--) {
        const u = turns[i]!;
        if (u.role !== "user") break;
        if (u.turnId !== null) break;
        turns[i] = { ...u, turnId: currentTurnId };
      }
      continue;
    }
    if (e.type === TURN_END) {
      // Inter-turn — the next user.message belongs to the next turn, not this
      // one. Drop the carried turnId so retroactive assignment kicks in.
      currentTurnId = null;
      continue;
    }
    if (e.type === USER_MSG) {
      const c = (e.data as { content?: string }).content;
      if (typeof c === "string") {
        turns.push({ turnId: currentTurnId, role: "user", content: c, timestamp: e.timestamp });
      }
    } else if (e.type === MSG) {
      const c = (e.data as { content?: string }).content;
      if (typeof c === "string") {
        turns.push({ turnId: currentTurnId, role: "assistant", content: c, timestamp: e.timestamp });
      }
    } else if (e.type === "system.message") {
      const c = (e.data as { content?: string }).content;
      if (typeof c === "string") {
        turns.push({ turnId: currentTurnId, role: "system", content: c, timestamp: e.timestamp });
      }
    }
  }
  if (typeof opts.sinceTurn === "number") {
    return turns.filter((t) => Number(t.turnId ?? "-1") >= opts.sinceTurn!);
  }
  return turns;
};

export const listAllSessionUuids = (root: string = SESSION_ROOT): string[] => {
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((d) => /^[0-9a-f-]{36}$/i.test(d));
};

export const removeSession = (uuid: string, root?: string): void => {
  const dir = sessionDir(uuid, root);
  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true });
      logger.info({ event: "session.removed", uuid }, "session-state dir removed");
    } catch (err) {
      logger.warn({ err, uuid }, "removeSession failed");
    }
  }
};
