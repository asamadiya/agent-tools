import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { handleAgent } from "../../src/tools/agent.js";
import { handleSendMessage } from "../../src/tools/send-message.js";
import { handleStatus } from "../../src/tools/status.js";
import { handleGetTranscript, handleTaskOutput, handleTaskList } from "../../src/tools/tasks.js";
import { tmuxAvailable } from "../../src/tmux.js";

const STUB = resolve(__dirname, "fixtures/stub-copilot");
const SESSION = `copilot-teams-st-it-${process.pid}`;
const have = await tmuxAvailable();

let dir: string;
let statePath: string;
let stubDir: string;
let sessionRoot: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ct-st-"));
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

const spawnAndAsk = async (name: string, prompt: string) => {
  const a = await handleAgent(
    { description: name, prompt, name, run_in_background: true, wait_first_turn_ms: 5000 },
    {
      cwd: process.cwd(), binary: STUB, statePath, sessionRoot,
      env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir },
    },
  );
  return a;
};

describe.skipIf(!have)("Status — deep liveness", () => {
  it("idle after first turn; ready=true; turnCount=1", async () => {
    const a = await spawnAndAsk("st-idle", "say hello");
    const s = await handleStatus({ id: a.id }, { statePath, sessionRoot });
    expect(s.session.state).toBe("idle");
    expect(s.session.turnCount).toBe(1);
    expect(s.pane.alive).toBe(true);
    expect(s.ready).toBe(true);
    await execa("tmux", ["kill-window", "-t", a.tmuxTarget!], { reject: false });
  });

  it("addressable by name", async () => {
    const a = await spawnAndAsk("by-name", "say x");
    const s = await handleStatus({ id: "by-name" }, { statePath, sessionRoot });
    expect(s.id).toBe(a.id);
    await execa("tmux", ["kill-window", "-t", a.tmuxTarget!], { reject: false });
  });

  it("after kill-window: pane.alive=false; reconciliation marks task exited", async () => {
    const a = await spawnAndAsk("st-killed", "say x");
    await execa("tmux", ["kill-window", "-t", a.tmuxTarget!], { reject: false });
    // Force reconciliation via TaskList
    const list = await handleTaskList({}, { statePath, sessionRoot });
    const t = list.find((x) => x.id === a.id);
    expect(t?.status).toBe("exited");
  });
});

describe.skipIf(!have)("GetTranscript / TaskOutput transcript-mode", () => {
  it("returns ordered user/assistant turns from events.jsonl", async () => {
    const a = await spawnAndAsk("trans1", "say first");
    await handleSendMessage(
      { to: "trans1", message: "say second" },
      { binary: STUB, statePath, sessionRoot },
    );
    const t = await handleGetTranscript({ id: "trans1" }, { statePath, sessionRoot });
    expect(t.turns.map((x) => `${x.role}:${x.content}`)).toEqual([
      "user:say first",
      "assistant:first",
      "user:say second",
      "assistant:second",
    ]);
    await execa("tmux", ["kill-window", "-t", a.tmuxTarget!], { reject: false });
  });

  it("since_turn filter omits earlier turns", async () => {
    const a = await spawnAndAsk("trans2", "say a");
    await handleSendMessage({ to: "trans2", message: "say b" }, { binary: STUB, statePath, sessionRoot });
    const t = await handleGetTranscript({ id: "trans2", since_turn: 1 }, { statePath, sessionRoot });
    expect(t.turns.map((x) => x.content)).toContain("say b");
    expect(t.turns.map((x) => x.content)).not.toContain("say a");
    await execa("tmux", ["kill-window", "-t", a.tmuxTarget!], { reject: false });
  });

  it("TaskOutput source=transcript prints normalized turns", async () => {
    const a = await spawnAndAsk("toutp", "say HELLO");
    const r = await handleTaskOutput(
      { id: a.id, source: "transcript" },
      { statePath, sessionRoot },
    );
    expect(r.source).toBe("transcript");
    expect(r.content).toContain("[user #0] say HELLO");
    expect(r.content).toContain("[assistant #0] HELLO");
    await execa("tmux", ["kill-window", "-t", a.tmuxTarget!], { reject: false });
  });
});
