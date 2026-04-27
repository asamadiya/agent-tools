import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { handleAgent } from "../../src/tools/agent.js";
import { handleSendToTeam, handleRestart, handleGc } from "../../src/tools/lifecycle.js";
import { handleTeamCreate } from "../../src/tools/teams.js";
import { handleTaskList } from "../../src/tools/tasks.js";
import { tmuxAvailable } from "../../src/tmux.js";
import { loadState } from "../../src/state.js";

const STUB = resolve(__dirname, "fixtures/stub-copilot");
const SESSION = `copilot-teams-life-it-${process.pid}`;
const have = await tmuxAvailable();

let dir: string;
let statePath: string;
let stubDir: string;
let sessionRoot: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ct-life-"));
  statePath = join(dir, "state.json");
  stubDir = mkdtempSync(join(tmpdir(), "ct-stub-"));
  sessionRoot = mkdtempSync(join(tmpdir(), "ct-sroot-"));
  process.env.STUB_COPILOT_DIR = stubDir;
  process.env.COPILOT_SESSION_ROOT = sessionRoot;
  process.env.TMUX_SESSION = SESSION;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(stubDir, { recursive: true, force: true });
  rmSync(sessionRoot, { recursive: true, force: true });
});

afterAll(async () => {
  await execa("tmux", ["kill-session", "-t", SESSION], { reject: false });
});

describe.skipIf(!have)("SendToTeam — broadcast", () => {
  it("delivers the same message to every running member and aggregates replies", async () => {
    await handleTeamCreate({ name: "rev" }, { statePath });
    const a = await handleAgent(
      { description: "ma", prompt: "say boot", name: "ma", team_name: "rev", run_in_background: true, wait_first_turn_ms: 5000 },
      { cwd: process.cwd(), binary: STUB, statePath, sessionRoot, env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir } },
    );
    const b = await handleAgent(
      { description: "mb", prompt: "say boot", name: "mb", team_name: "rev", run_in_background: true, wait_first_turn_ms: 5000 },
      { cwd: process.cwd(), binary: STUB, statePath, sessionRoot, env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir } },
    );
    const r = await handleSendToTeam(
      { team: "rev", message: "say HELLO_TEAM" },
      { binary: STUB, statePath, sessionRoot },
    );
    expect(r.results).toHaveLength(2);
    for (const e of r.results) expect(e.output).toBe("HELLO_TEAM");
    await execa("tmux", ["kill-window", "-t", a.tmuxTarget!], { reject: false });
    await execa("tmux", ["kill-window", "-t", b.tmuxTarget!], { reject: false });
  });

  it("returns empty results for a team with no running members", async () => {
    await handleTeamCreate({ name: "ghost" }, { statePath });
    const r = await handleSendToTeam(
      { team: "ghost", message: "say x" },
      { binary: STUB, statePath, sessionRoot },
    );
    expect(r.results).toEqual([]);
  });
});

describe.skipIf(!have)("Restart", () => {
  it("stops then respawns with same config; new uuid", async () => {
    const a = await handleAgent(
      { description: "rst", prompt: "say boot", name: "rst", run_in_background: true, wait_first_turn_ms: 5000 },
      { cwd: process.cwd(), binary: STUB, statePath, sessionRoot, env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir } },
    );
    const b = await handleRestart(
      { id: "rst" },
      { cwd: process.cwd(), binary: STUB, statePath, sessionRoot, env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir } },
    );
    expect(b.id).not.toBe(a.id);
    expect(b.status).toBe("running");
    const list = await handleTaskList({}, { statePath, sessionRoot });
    const oldT = list.find((t) => t.id === a.id);
    expect(oldT?.status === "stopped" || oldT?.status === "exited").toBe(true);
    await execa("tmux", ["kill-window", "-t", b.tmuxTarget!], { reject: false });
  });
});

describe("GC — orphan session-state dirs", () => {
  it("dry_run reports orphans without removing them", async () => {
    const orphanUuid = "11111111-2222-3333-4444-555555555555";
    mkdirSync(join(sessionRoot, orphanUuid), { recursive: true });
    const r = await handleGc({ dry_run: true }, { statePath, sessionRoot });
    expect(r.dryRun).toBe(true);
    expect(r.orphanSessionDirsRemoved).toContain(orphanUuid);
    expect(existsSync(join(sessionRoot, orphanUuid))).toBe(true);
  });

  it("non-dry-run actually removes them", async () => {
    const orphanUuid = "22222222-2222-2222-2222-222222222222";
    mkdirSync(join(sessionRoot, orphanUuid), { recursive: true });
    const r = await handleGc({ dry_run: false }, { statePath, sessionRoot });
    expect(r.orphanSessionDirsRemoved).toContain(orphanUuid);
    expect(existsSync(join(sessionRoot, orphanUuid))).toBe(false);
  });

  it("does not touch session dirs that correspond to known tasks", async () => {
    // Pre-populate state with one task whose uuid matches a session dir.
    const knownUuid = "33333333-3333-3333-3333-333333333333";
    mkdirSync(join(sessionRoot, knownUuid), { recursive: true });
    const orphan = "44444444-4444-4444-4444-444444444444";
    mkdirSync(join(sessionRoot, orphan), { recursive: true });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      statePath,
      JSON.stringify({
        tasks: {
          [knownUuid]: { id: knownUuid, status: "running", createdAt: "now", updatedAt: "now" },
        },
        teams: {},
      }),
    );
    const r = await handleGc({ dry_run: false }, { statePath, sessionRoot });
    expect(r.orphanSessionDirsRemoved).toEqual([orphan]);
    expect(existsSync(join(sessionRoot, knownUuid))).toBe(true);
    expect(existsSync(join(sessionRoot, orphan))).toBe(false);
  });

  it("loadState reflects pruned tasks when prune_exited_older_than_hours is set", async () => {
    const { writeFileSync } = await import("node:fs");
    const oldTs = new Date(Date.now() - 25 * 3600_000).toISOString();
    const newTs = new Date().toISOString();
    writeFileSync(
      statePath,
      JSON.stringify({
        tasks: {
          "old-uuid": { id: "old-uuid", status: "exited", createdAt: oldTs, updatedAt: oldTs },
          "new-uuid": { id: "new-uuid", status: "exited", createdAt: newTs, updatedAt: newTs },
        },
        teams: {},
      }),
    );
    const r = await handleGc(
      { dry_run: false, prune_exited_older_than_hours: 24 },
      { statePath, sessionRoot },
    );
    expect(r.prunedTaskIds).toContain("old-uuid");
    expect(r.prunedTaskIds).not.toContain("new-uuid");
    const after = loadState({ path: statePath });
    expect(after.tasks["old-uuid"]).toBeUndefined();
    expect(after.tasks["new-uuid"]).toBeDefined();
  });
});
