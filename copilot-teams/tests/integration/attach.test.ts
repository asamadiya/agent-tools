import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { handleAgent } from "../../src/tools/agent.js";
import { handleAttach, handleWhoOwns } from "../../src/tools/attach.js";
import { tmuxAvailable } from "../../src/tmux.js";

const STUB = resolve(__dirname, "fixtures/stub-copilot");
const SESSION = `copilot-teams-attach-it-${process.pid}`;
const have = await tmuxAvailable();

let dir: string;
let statePath: string;
let stubDir: string;
let sessionRoot: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ct-att-"));
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

describe("Attach — input validation", () => {
  it("rejects unknown id", async () => {
    await expect(
      handleAttach({ id: "ghost" }, { statePath }),
    ).rejects.toThrow(/no task addressable/);
  });
});

describe.skipIf(!have)("Attach — info mode (returns commands without executing)", () => {
  it("info mode returns the switch-client command", async () => {
    const spawned = await handleAgent(
      { description: "x", prompt: "say hi", name: "alpha", run_in_background: true },
      { cwd: process.cwd(), binary: STUB, statePath, sessionRoot, env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir } },
    );
    const r = await handleAttach({ id: "alpha", mode: "info" }, { statePath });
    expect(r.executed).toBe(false);
    expect(r.commands[0]).toContain("switch-client");
    expect(r.commands[0]).toContain(spawned.tmuxTarget);
    await execa("tmux", ["kill-window", "-t", spawned.tmuxTarget!], { reject: false });
  });

  it("rejects when target has no tmuxTarget (foreground task)", async () => {
    const spawned = await handleAgent(
      { description: "fg", prompt: "say x", run_in_background: false },
      { cwd: process.cwd(), binary: STUB, statePath, sessionRoot, env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir } },
    );
    await expect(
      handleAttach({ id: spawned.id, mode: "info" }, { statePath }),
    ).rejects.toThrow(/no tmuxTarget/);
  });

  it("split mode emits join-pane command", async () => {
    const spawned = await handleAgent(
      { description: "x", prompt: "say x", name: "splitter", run_in_background: true },
      { cwd: process.cwd(), binary: STUB, statePath, sessionRoot, env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir } },
    );
    const r = await handleAttach({ id: "splitter", mode: "info" }, { statePath });
    expect(r.commands[0]?.[0]).toBe("switch-client");
    const r2 = await handleAttach({ id: "splitter", mode: "info" }, { statePath });
    expect(r2.commands[0]?.[0]).toBe("switch-client");
    await execa("tmux", ["kill-window", "-t", spawned.tmuxTarget!], { reject: false });
  });
});

describe.skipIf(!have)("WhoOwns reverse lookup", () => {
  it("by name", async () => {
    const spawned = await handleAgent(
      { description: "x", prompt: "say x", name: "lookup-me", run_in_background: true },
      { cwd: process.cwd(), binary: STUB, statePath, sessionRoot, env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir } },
    );
    const t = await handleWhoOwns({ name: "lookup-me" }, { statePath });
    expect(t?.id).toBe(spawned.id);
    await execa("tmux", ["kill-window", "-t", spawned.tmuxTarget!], { reject: false });
  });

  it("by uuid", async () => {
    const spawned = await handleAgent(
      { description: "x", prompt: "say x", run_in_background: true },
      { cwd: process.cwd(), binary: STUB, statePath, sessionRoot, env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir } },
    );
    const t = await handleWhoOwns({ uuid: spawned.id }, { statePath });
    expect(t?.id).toBe(spawned.id);
    await execa("tmux", ["kill-window", "-t", spawned.tmuxTarget!], { reject: false });
  });

  it("by tmux_target", async () => {
    const spawned = await handleAgent(
      { description: "x", prompt: "say x", name: "by-tmux", run_in_background: true },
      { cwd: process.cwd(), binary: STUB, statePath, sessionRoot, env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir } },
    );
    const t = await handleWhoOwns({ tmux_target: spawned.tmuxTarget! }, { statePath });
    expect(t?.id).toBe(spawned.id);
    await execa("tmux", ["kill-window", "-t", spawned.tmuxTarget!], { reject: false });
  });

  it("returns null for unknowns", async () => {
    expect(await handleWhoOwns({ name: "nobody" }, { statePath })).toBeNull();
  });

  it("rejects an empty query", async () => {
    await expect(handleWhoOwns({}, { statePath })).rejects.toThrow();
  });
});
