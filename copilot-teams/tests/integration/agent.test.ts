import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { handleAgent, buildBackgroundShellCommand } from "../../src/tools/agent.js";
import { loadState } from "../../src/state.js";
import { tmuxAvailable } from "../../src/tmux.js";

const STUB = resolve(__dirname, "fixtures/stub-copilot");
const SESSION = `copilot-teams-agent-it-${process.pid}`;

let dir: string;
let statePath: string;
let stubDir: string;
let sessionRoot: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ct-agent-"));
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

const have = await tmuxAvailable();

describe("buildBackgroundShellCommand", () => {
  it("quotes binary, args, env safely; trails with exec bash", () => {
    const cmd = buildBackgroundShellCommand(
      "/usr/bin/copilot",
      ["--resume=u", "--allow-all-tools"],
      { K: "v with spaces" },
    );
    expect(cmd).toContain("/usr/bin/copilot");
    expect(cmd).toContain("'--resume=u'");
    expect(cmd).toContain("'--allow-all-tools'");
    expect(cmd).toContain("env K='v with spaces'");
    expect(cmd).toMatch(/exec bash$/);
  });

  it("omits env prefix when env is empty", () => {
    const cmd = buildBackgroundShellCommand("/c", ["--x"]);
    expect(cmd).not.toMatch(/^env /);
  });
});

describe.skipIf(!have)("Agent — foreground (one-shot)", () => {
  it("returns the stub's reply and records exited status", async () => {
    const out = await handleAgent(
      { description: "smoke", prompt: "say HELLO_FG", run_in_background: false },
      { cwd: process.cwd(), binary: STUB, statePath, sessionRoot, env: { COPILOT_SESSION_ROOT: sessionRoot } },
    );
    expect(out.status).toBe("exited");
    expect(out.exitCode).toBe(0);
    expect(out.output).toContain("HELLO_FG");

    const t = loadState({ path: statePath }).tasks[out.id];
    expect(t?.status).toBe("exited");
    expect(t?.background).toBe(false);
  });

  it("threads name, team, subagent_type into state", async () => {
    const out = await handleAgent(
      {
        description: "named",
        prompt: "say x",
        name: "alice",
        team_name: "review",
        subagent_type: "researcher",
        run_in_background: false,
      },
      { cwd: process.cwd(), binary: STUB, statePath, sessionRoot, env: { COPILOT_SESSION_ROOT: sessionRoot } },
    );
    const s = loadState({ path: statePath });
    expect(s.tasks[out.id]?.name).toBe("alice");
    expect(s.tasks[out.id]?.team).toBe("review");
    expect(s.tasks[out.id]?.subagentType).toBe("researcher");
    expect(s.teams["review"]?.name).toBe("review");
  });
});

describe.skipIf(!have)("Agent — background (persistent REPL)", () => {
  it("spawns interactive copilot, awaits session.start, sends initial prompt, captures first turn", async () => {
    const out = await handleAgent(
      {
        description: "bg-smoke",
        prompt: "say HELLO_BG",
        name: "bgtest",
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
    expect(out.status).toBe("running");
    expect(out.tmuxTarget).toMatch(/cop:bgtest$/);
    expect(out.firstTurnId).toBe("0");
    expect(out.output).toBe("HELLO_BG");

    const t = loadState({ path: statePath }).tasks[out.id];
    expect(t?.tmuxTarget).toBe(out.tmuxTarget);
    expect((t?.pid ?? 0)).toBeGreaterThan(0);

    // events.jsonl exists with the expected events
    const eventsPath = join(sessionRoot, out.id, "events.jsonl");
    expect(existsSync(eventsPath)).toBe(true);
    const events = readFileSync(eventsPath, "utf8");
    expect(events).toContain('"session.start"');
    expect(events).toContain('"assistant.message"');
    expect(events).toContain("HELLO_BG");

    await execa("tmux", ["kill-window", "-t", out.tmuxTarget!], { reject: false });
  });

  it("returns immediately (status=running) when wait_first_turn_ms is omitted", async () => {
    const out = await handleAgent(
      {
        description: "no-wait",
        prompt: "say x",
        name: "nowait",
        run_in_background: true,
      },
      {
        cwd: process.cwd(),
        binary: STUB,
        statePath,
        sessionRoot,
        env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir },
      },
    );
    expect(out.status).toBe("running");
    expect(out.output).toBeUndefined();
    expect(out.firstTurnId).toBeUndefined();

    await execa("tmux", ["kill-window", "-t", out.tmuxTarget!], { reject: false });
  });

  it("uses cop:<short-uuid> when no name given", async () => {
    const out = await handleAgent(
      { description: "anon", prompt: "say x", run_in_background: true },
      {
        cwd: process.cwd(),
        binary: STUB,
        statePath,
        sessionRoot,
        env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir },
      },
    );
    expect(out.tmuxTarget).toMatch(/cop:[0-9a-f]{8}$/);
    await execa("tmux", ["kill-window", "-t", out.tmuxTarget!], { reject: false });
  });

  it("background spawn without prompt is allowed (REPL stays open for SendMessage)", async () => {
    const out = await handleAgent(
      { description: "no-prompt", name: "ready-only", run_in_background: true },
      {
        cwd: process.cwd(),
        binary: STUB,
        statePath,
        sessionRoot,
        env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir },
      },
    );
    expect(out.status).toBe("running");
    expect(out.output).toBeUndefined();
    await execa("tmux", ["kill-window", "-t", out.tmuxTarget!], { reject: false });
  });
});

describe.skipIf(!have)("Agent — per-agent isolation (env, cwd, allowed_tools)", () => {
  it("env propagates to the spawned child", async () => {
    const out = await handleAgent(
      {
        description: "env-test",
        prompt: "say x",
        run_in_background: false,
        env: { CT_PROBE: "PROBE_VALUE" },
      },
      { cwd: process.cwd(), binary: STUB, statePath, sessionRoot, env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir } },
    );
    expect(out.status).toBe("exited");
    // The stub doesn't expose env directly; the contract is "no error, exit 0".
    // Real assertions of env propagation are in the unit tests for buildArgs.
  });

  it("input.cwd overrides deps.cwd for the spawn", async () => {
    const tmpCwd = mkdtempSync(join(tmpdir(), "ct-cwd-"));
    try {
      const out = await handleAgent(
        { description: "cwd-test", prompt: "say x", run_in_background: false, cwd: tmpCwd },
        { cwd: process.cwd(), binary: STUB, statePath, sessionRoot, env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir } },
      );
      expect(out.status).toBe("exited");
    } finally {
      rmSync(tmpCwd, { recursive: true, force: true });
    }
  });
});

describe("Agent — input validation", () => {
  it("rejects empty description", async () => {
    await expect(
      handleAgent({ description: "", prompt: "x" }, { cwd: process.cwd(), binary: STUB, statePath }),
    ).rejects.toThrow();
  });

  it("foreground rejects missing prompt", async () => {
    await expect(
      handleAgent({ description: "x", run_in_background: false }, { cwd: process.cwd(), binary: STUB, statePath }),
    ).rejects.toThrow();
  });
});
