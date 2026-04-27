import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";

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
 *  callers serialize. Caller is responsible for not nesting locks on the
 *  same uuid (would deadlock). */
export const withUuidLock = async <T>(
  uuid: string,
  fn: () => Promise<T>,
  opts: { lockRetries?: number } = {},
): Promise<T> => {
  const path = ensureLockFile(uuid);
  const release = await lockfile.lock(path, {
    retries: { retries: opts.lockRetries ?? 60, minTimeout: 50, maxTimeout: 500 },
    stale: 60_000,
    realpath: false,
  });
  try {
    return await fn();
  } finally {
    await release();
  }
};
