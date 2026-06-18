import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { handleAgent } from "../../src/tools/agent.js";
import { handleSendMessage } from "../../src/tools/send-message.js";
import { handleStatus } from "../../src/tools/status.js";
import {
  capturePane,
  ensureSession,
  paneExists,
  sendLine,
  spawnWindow,
  splitPane,
  tmuxAvailable,
} from "../../src/tmux.js";
import { sessionLiveness } from "../../src/session-state.js";
import { withState, nowIso, type Task } from "../../src/state.js";

const STUB = resolve(__dirname, "fixtures/stub-copilot");
const SESSION = `copilot-teams-mission-it-${process.pid}`;
const have = await tmuxAvailable();

let dir: string;
let statePath: string;
let stubDir: string;
let sessionRoot: string;
// argv-logging stub written per-test
let argvStub: string;
let argvLog: string;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const writeArgvStub = (path: string, logFile: string): void => {
  // Wrapper around real stub-copilot that records argv to logFile then execs the
  // real stub. argv recorded one-per-line, header per invocation.
  const body = `#!/usr/bin/env bash
set -euo pipefail
{
  echo "---INVOCATION---"
  for a in "$@"; do
    printf '%s\\n' "$a"
  done
} >> ${JSON.stringify(logFile)}
exec ${JSON.stringify(STUB)} "$@"
`;
  writeFileSync(path, body);
  chmodSync(path, 0o755);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ct-mission-"));
  statePath = join(dir, "state.json");
  stubDir = mkdtempSync(join(tmpdir(), "ct-stub-"));
  sessionRoot = mkdtempSync(join(tmpdir(), "ct-sroot-"));
  argvStub = join(dir, "argv-stub");
  argvLog = join(dir, "argv.log");
  writeArgvStub(argvStub, argvLog);
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

describe.skipIf(!have)("[mission #1] SendMessage idle-poll waits for turn_end before typing", () => {
  it("polls while state=busy and lets the buffered turn_end through", async () => {
    // 1. Spawn a real background agent (kicks off pane + REPL + first turn).
    const a = await handleAgent(
      {
        description: "idle-poll",
        prompt: "say boot",
        name: "idle-poll",
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
    expect(a.firstTurnId).toBe("0");

    // 2. Manually inject a busy state by appending a turn_start without a
    //    turn_end. Now sessionLiveness() will report state="busy".
    const eventsFile = join(sessionRoot, a.id, "events.jsonl");
    const startEvt = {
      type: "assistant.turn_start",
      data: { turnId: "999" },
      id: `${a.id}-fake-start`,
      timestamp: new Date().toISOString(),
      parentId: null,
    };
    appendFileSync(eventsFile, `${JSON.stringify(startEvt)}\n`);

    const busyLive = sessionLiveness(a.id, sessionRoot);
    expect(busyLive.state).toBe("busy");

    // 3. Kick off SendMessage. It must NOT type into the pane while busy.
    //    To verify, we capture the pane before & during the polling phase
    //    and confirm "what is z?" hasn't appeared yet.
    const sendPromise = handleSendMessage(
      { to: "idle-poll", message: "what is z?", timeout_ms: 10_000 },
      { binary: STUB, statePath, sessionRoot },
    );

    // Give the poller a few ticks to spin (poll interval is 200ms).
    await sleep(700);
    const midCapture = await capturePane(a.tmuxTarget!, { joinWrapped: true });
    // The fake busy event has not been closed; poller should still be waiting.
    // Hence the message text should NOT yet be in the pane buffer.
    expect(midCapture).not.toContain("what is z?");

    // 4. Inject a matching turn_end to flip state -> idle. The poller wakes,
    //    types the line, the REPL processes it normally, awaitTurnEnd matches
    //    a higher turn count.
    const endEvt = {
      type: "assistant.turn_end",
      data: { turnId: "999" },
      id: `${a.id}-fake-end`,
      timestamp: new Date().toISOString(),
      parentId: null,
    };
    appendFileSync(eventsFile, `${JSON.stringify(endEvt)}\n`);

    const r = await sendPromise;
    expect(r.via).toBe("send-keys");
    // The injected fake-turn (counted as turn 1 by liveness) bumped turnCount,
    // so the actual reply turn is the next one. Whatever its id, output must
    // be MISSING (z was never set in stub kv) and turn_end must have arrived.
    expect(r.output).toBe("MISSING");

    await execa("tmux", ["kill-window", "-t", a.tmuxTarget!], { reject: false });
  });
});

describe.skipIf(!have)("[mission #2] Status correctness for pane id targets", () => {
  beforeAll(async () => {
    await ensureSession(SESSION);
  });

  it("real %N pane: pane.alive=true; ready=true when state=idle", async () => {
    // Create a pane we own (split a window inside our SESSION).
    const w = await spawnWindow({
      session: SESSION,
      windowName: `cop:status-host-${Math.random().toString(36).slice(2, 8)}`,
      command: "sleep 60",
    });
    const sp = await splitPane({
      parent: w.target,
      command: "sleep 60",
    });
    expect(sp.paneId).toMatch(/^%\d+$/);

    // Inject a fake task in state pointing at the pane id, with idle session.
    const fakeUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    // Build an events.jsonl that resolves to "idle" — start + turn_start +
    // turn_end (turnCount=1, no inTurn, no shutdown).
    const sdir = join(sessionRoot, fakeUuid);
    mkdirSync(sdir, { recursive: true });
    const lines = [
      { type: "session.start", data: { sessionId: fakeUuid }, id: "1", timestamp: new Date().toISOString(), parentId: null },
      { type: "assistant.turn_start", data: { turnId: "0" }, id: "2", timestamp: new Date().toISOString(), parentId: null },
      { type: "assistant.turn_end", data: { turnId: "0" }, id: "3", timestamp: new Date().toISOString(), parentId: null },
    ];
    writeFileSync(join(sdir, "events.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

    await withState((s) => {
      s.tasks[fakeUuid] = {
        id: fakeUuid,
        status: "running",
        createdAt: nowIso(),
        updatedAt: nowIso(),
        description: "status-pane-id",
        background: true,
        tmuxTarget: sp.paneId,
      } as Task;
      return s;
    }, { path: statePath });

    const s = await handleStatus({ id: fakeUuid }, { statePath, sessionRoot });
    expect(s.session.state).toBe("idle");
    expect(s.pane.target).toBe(sp.paneId);
    expect(s.pane.alive).toBe(true);
    expect(s.ready).toBe(true);

    await execa("tmux", ["kill-window", "-t", w.target], { reject: false });
  });

  it("non-existent %N pane: pane.alive=false; ready=false even if session idle", async () => {
    const fakeUuid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const sdir = join(sessionRoot, fakeUuid);
    mkdirSync(sdir, { recursive: true });
    const lines = [
      { type: "session.start", data: { sessionId: fakeUuid }, id: "1", timestamp: new Date().toISOString(), parentId: null },
      { type: "assistant.turn_start", data: { turnId: "0" }, id: "2", timestamp: new Date().toISOString(), parentId: null },
      { type: "assistant.turn_end", data: { turnId: "0" }, id: "3", timestamp: new Date().toISOString(), parentId: null },
    ];
    writeFileSync(join(sdir, "events.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

    // Pick a pane id we know does not exist. tmux pane ids are sequential per
    // server; %999999 is overwhelmingly unlikely to exist.
    const ghostPane = "%999999";
    expect(await paneExists(ghostPane)).toBe(false);

    await withState((s) => {
      s.tasks[fakeUuid] = {
        id: fakeUuid,
        status: "running",
        createdAt: nowIso(),
        updatedAt: nowIso(),
        description: "ghost",
        background: true,
        tmuxTarget: ghostPane,
      } as Task;
      return s;
    }, { path: statePath });

    const s = await handleStatus({ id: fakeUuid }, { statePath, sessionRoot });
    expect(s.session.state).toBe("idle");
    expect(s.pane.alive).toBe(false);
    expect(s.ready).toBe(false);
  });
});

describe.skipIf(!have)("[mission #3] system_prompt materialization", () => {
  it("writes ~/.copilot/agents/_ct_tmp_<uuid>.md and passes --agent _ct_tmp_<uuid>", async () => {
    const personaText = "You are TURTLE_VOICE_MISSION3.";
    const out = await handleAgent(
      {
        description: "sysp-mission",
        prompt: "say hi",
        run_in_background: false,
        system_prompt: personaText,
      },
      {
        cwd: process.cwd(),
        binary: argvStub,
        statePath,
        sessionRoot,
        env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir },
      },
    );

    const tmpName = `_ct_tmp_${out.id.replace(/-/g, "")}`;
    const personasDir = join(homedir(), ".copilot", "agents");
    const fpath = join(personasDir, `${tmpName}.md`);

    try {
      // (a) file exists with persona body
      expect(existsSync(fpath)).toBe(true);
      const body = readFileSync(fpath, "utf8");
      expect(body).toContain(personaText);
      expect(body).toContain(out.id);

      // (b) --agent <tmpName> appears in the spawned argv (captured by stub).
      const log = readFileSync(argvLog, "utf8");
      const argLines = log.split("\n");
      const agentIdx = argLines.findIndex((l) => l === "--agent");
      expect(agentIdx).toBeGreaterThanOrEqual(0);
      expect(argLines[agentIdx + 1]).toBe(tmpName);
      // resume uuid must also be present
      expect(argLines).toContain(`--resume=${out.id}`);
    } finally {
      try { (await import("node:fs")).unlinkSync(fpath); } catch { /* */ }
    }
  });

  it("rejects subagent_type + system_prompt with the documented error", async () => {
    await expect(
      handleAgent(
        {
          description: "x",
          prompt: "say x",
          subagent_type: "researcher",
          system_prompt: "pretend",
          run_in_background: false,
        },
        {
          cwd: process.cwd(),
          binary: argvStub,
          statePath,
          sessionRoot,
          env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir },
        },
      ),
    ).rejects.toThrow(/either subagent_type or system_prompt/);
  });
});

describe.skipIf(!have)("[mission #4] sendLine multi-line via sendBlock", () => {
  beforeAll(async () => {
    await ensureSession(SESSION);
  });

  it("typing 'first\\nsecond\\nthird' into a cat pane produces all three lines", async () => {
    const w = await spawnWindow({
      session: SESSION,
      windowName: `cop:multiline-${Math.random().toString(36).slice(2, 8)}`,
      command: "cat",
    });
    await sleep(150);
    await sendLine(w.target, "first\nsecond\nthird");
    await sleep(250);
    const captured = await capturePane(w.target, { joinWrapped: true });
    // All three tokens must show up. cat echoes each newline-terminated line.
    expect(captured).toContain("first");
    expect(captured).toContain("second");
    expect(captured).toContain("third");
    await execa("tmux", ["kill-window", "-t", w.target], { reject: false });
  });
});
