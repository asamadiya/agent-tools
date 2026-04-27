import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { handleAgent } from "../../src/tools/agent.js";
import {
  handlePaneFocus,
  handlePaneJoin,
  handlePaneResize,
  handlePaneSwap,
} from "../../src/tools/panes.js";
import { tmuxAvailable } from "../../src/tmux.js";

const STUB = resolve(__dirname, "fixtures/stub-copilot");
const SESSION = `copilot-teams-panes-it-${process.pid}`;
const have = await tmuxAvailable();

let dir: string;
let statePath: string;
let stubDir: string;
let sessionRoot: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ct-pn-"));
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

const spawn = async (name: string) =>
  handleAgent(
    { description: name, prompt: "say boot", name, run_in_background: true, wait_first_turn_ms: 5000 },
    { cwd: process.cwd(), binary: STUB, statePath, sessionRoot, env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir } },
  );

describe.skipIf(!have)("Pane management", () => {
  it("PaneFocus selects the agent's window", async () => {
    const a = await spawn("focus-test");
    const r = await handlePaneFocus({ id: "focus-test" }, { statePath });
    expect(r.id).toBe(a.id);
    // No good way to assert "this client is focused on it", but the tmux call
    // exiting 0 is the contract.
    await execa("tmux", ["kill-window", "-t", a.tmuxTarget!], { reject: false });
  });

  it("PaneJoin merges agent pane into a target window", async () => {
    const a = await spawn("join-src");
    // Create a destination window in the same session.
    await execa("tmux", ["new-window", "-d", "-t", SESSION, "-n", "dest"], { reject: false });
    const r = await handlePaneJoin(
      { id: "join-src", target_window: `${SESSION}:dest`, horizontal: true },
      { statePath },
    );
    expect(r.id).toBe(a.id);
    // Source window cop:join-src should be gone after join.
    const list = await execa("tmux", ["list-windows", "-t", SESSION, "-F", "#{window_name}"], { reject: false });
    expect(list.stdout).toContain("dest");
    expect(list.stdout).not.toContain("cop:join-src");
    await execa("tmux", ["kill-window", "-t", `${SESSION}:dest`], { reject: false });
  });

  it("PaneResize: tmux call returns ok (best-effort visual change)", async () => {
    const a = await spawn("resize-test");
    // Resize requires the pane to be in a multi-pane window; use kill-pane
    // first if needed. Just assert the tmux call doesn't blow up.
    const r = await handlePaneResize({ id: "resize-test", direction: "D", cells: 1 }, { statePath });
    expect(r.id).toBe(a.id);
    await execa("tmux", ["kill-window", "-t", a.tmuxTarget!], { reject: false });
  });

  it("PaneSwap exchanges two agents", async () => {
    const a = await spawn("swap-a");
    const b = await spawn("swap-b");
    const r = await handlePaneSwap({ id: "swap-a", with_id: "swap-b" }, { statePath });
    expect([r.a, r.b].sort()).toEqual([a.id, b.id].sort());
    await execa("tmux", ["kill-window", "-t", a.tmuxTarget!], { reject: false });
    await execa("tmux", ["kill-window", "-t", b.tmuxTarget!], { reject: false });
  });
});

describe("Pane management — input validation", () => {
  it("PaneFocus rejects unknown id", async () => {
    await expect(handlePaneFocus({ id: "ghost" }, { statePath })).rejects.toThrow(/no task/);
  });
});
