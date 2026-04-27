import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { handleAgent } from "../../src/tools/agent.js";
import { handleSendMessage } from "../../src/tools/send-message.js";
import { tmuxAvailable } from "../../src/tmux.js";

const STUB = resolve(__dirname, "fixtures/stub-copilot");
const SESSION = `copilot-teams-sm-it-${process.pid}`;
const have = await tmuxAvailable();

let dir: string;
let statePath: string;
let stubDir: string;
let sessionRoot: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ct-sm-"));
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

describe("SendMessage — addressing & validation", () => {
  it("rejects unknown name", async () => {
    await expect(
      handleSendMessage({ to: "ghost", message: "hi" }, { binary: STUB, statePath }),
    ).rejects.toThrow(/no task addressable/);
  });

  it("rejects empty message", async () => {
    await expect(
      handleSendMessage({ to: "x", message: "" }, { binary: STUB, statePath }),
    ).rejects.toThrow();
  });
});

describe.skipIf(!have)("SendMessage — send-keys via live pane", () => {
  it("addresses a live background agent and round-trips through events.jsonl", async () => {
    const spawned = await handleAgent(
      {
        description: "bg-mem",
        prompt: "remember z=BG",
        name: "bg-mem",
        run_in_background: true,
        wait_first_turn_ms: 5000,
      },
      {
        cwd: process.cwd(),
        binary: STUB,
        statePath,
        sessionRoot,
        env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir },
      },
    );
    expect(spawned.firstTurnId).toBe("0");

    const r = await handleSendMessage(
      { to: "bg-mem", message: "what is z?" },
      { binary: STUB, statePath, sessionRoot },
    );
    expect(r.via).toBe("send-keys");
    expect(r.output).toBe("BG");
    expect(r.turnId).toBe("1");

    if (spawned.tmuxTarget) {
      await execa("tmux", ["kill-window", "-t", spawned.tmuxTarget], { reject: false });
    }
  });

  it("concurrent SendMessages serialize via uuid-lock without deadlock", async () => {
    const spawned = await handleAgent(
      {
        description: "seq",
        prompt: "say boot",
        name: "seq",
        run_in_background: true,
        wait_first_turn_ms: 5000,
      },
      {
        cwd: process.cwd(),
        binary: STUB,
        statePath,
        sessionRoot,
        env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir },
      },
    );
    // Fire 4 concurrent "say K" messages. The uuid lock serializes them; each
    // must complete with the right reply, and turn ids are unique and dense.
    const results = await Promise.all(
      ["A", "B", "C", "D"].map((k) =>
        handleSendMessage({ to: "seq", message: `say ${k}` }, { binary: STUB, statePath, sessionRoot }),
      ),
    );
    expect(results.map((r) => r.output).sort()).toEqual(["A", "B", "C", "D"]);
    const turnIds = results.map((r) => Number(r.turnId)).sort((a, b) => a - b);
    expect(turnIds).toEqual([1, 2, 3, 4]); // turn 0 was the initial spawn

    if (spawned.tmuxTarget) {
      await execa("tmux", ["kill-window", "-t", spawned.tmuxTarget], { reject: false });
    }
  });
});

describe.skipIf(!have)("SendMessage — subprocess fallback", () => {
  it("uses subprocess mode when target has no live pane", async () => {
    const spawned = await handleAgent(
      { description: "fg-only", prompt: "remember y=FG", run_in_background: false },
      {
        cwd: process.cwd(),
        binary: STUB,
        statePath,
        sessionRoot,
        env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir },
      },
    );
    const r = await handleSendMessage(
      { to: spawned.id, message: "what is y?" },
      { binary: STUB, statePath, sessionRoot, env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir } } as never,
    );
    expect(r.via).toBe("subprocess");
    expect(r.output).toContain("FG");
  });

  it("subprocess:true forces subprocess even with live pane (per-turn override path)", async () => {
    const spawned = await handleAgent(
      {
        description: "ovr",
        prompt: "say boot",
        name: "ovr",
        run_in_background: true,
        wait_first_turn_ms: 5000,
      },
      {
        cwd: process.cwd(),
        binary: STUB,
        statePath,
        sessionRoot,
        env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir },
      },
    );
    const r = await handleSendMessage(
      { to: "ovr", message: "say HELLO_OVERRIDE", subprocess: true },
      { binary: STUB, statePath, sessionRoot },
    );
    expect(r.via).toBe("subprocess");
    expect(r.output).toContain("HELLO_OVERRIDE");

    if (spawned.tmuxTarget) {
      await execa("tmux", ["kill-window", "-t", spawned.tmuxTarget], { reject: false });
    }
  });
});
