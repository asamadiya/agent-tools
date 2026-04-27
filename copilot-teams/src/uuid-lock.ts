import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { logger } from "./logger.js";

const LOCK_DIR = join(homedir(), ".copilot", "agent-teams", "locks");

const ensureLockFile = (uuid: string): string => {
  mkdirSync(LOCK_DIR, { recursive: true });
  const path = join(LOCK_DIR, `${uuid}.lock`);
  try {
    writeFileSync(path, "", { flag: "a" });
  } catch {
    /* best-effort */
  }
  return path;
};

/** Run `fn` while holding a cross-process lock on this uuid. Concurrent
 *  callers serialize. Lock has a short stale window so a crashed holder
 *  doesn't deadlock the rest of the system: proper-lockfile heartbeats the
 *  lockfile mtime every stale/2 ms; if we exceed `stale` without an update,
 *  the lock is treated as abandoned and a new caller can take it.
 *
 *  Caller is responsible for not nesting locks on the same uuid (would
 *  deadlock). */
export const withUuidLock = async <T>(
  uuid: string,
  fn: () => Promise<T>,
  opts: { lockRetries?: number; staleMs?: number } = {},
): Promise<T> => {
  const path = ensureLockFile(uuid);
  const release = await lockfile.lock(path, {
    retries: { retries: opts.lockRetries ?? 60, minTimeout: 50, maxTimeout: 500 },
    // Short window so a crashed/aborted holder recovers quickly; the heartbeat
    // (stale/2) keeps live holders' locks valid.
    stale: opts.staleMs ?? 15_000,
    realpath: false,
  });
  try {
    return await fn();
  } finally {
    try {
      await release();
    } catch (err) {
      // Already-released, file deleted, etc. — log and swallow so a transient
      // release error doesn't mask the real error from fn().
      logger.warn({ err, uuid }, "uuid-lock: release failed (ignored)");
    }
  }
};

/** Global spawn lock. Held only around the critical section of "decide
 *  anchor + split + record state" so concurrent Agent calls serialize and
 *  the second one sees the first one's pane in state. Released before the
 *  long awaitSessionReady / awaitTurnEnd phase so spawns don't block each
 *  other on slow startups. */
export const withSpawnLock = async <T>(
  fn: () => Promise<T>,
  opts: { lockRetries?: number; staleMs?: number } = {},
): Promise<T> => {
  const path = ensureLockFile("_spawn");
  const release = await lockfile.lock(path, {
    retries: { retries: opts.lockRetries ?? 120, minTimeout: 25, maxTimeout: 300 },
    stale: opts.staleMs ?? 15_000,
    realpath: false,
  });
  try {
    return await fn();
  } finally {
    try {
      await release();
    } catch (err) {
      logger.warn({ err }, "spawn-lock: release failed (ignored)");
    }
  }
};
