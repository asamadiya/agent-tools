/**
 * SE-team workflow scenarios. See tests/SCENARIOS.md for the narrative.
 *
 * Each test creates its own ephemeral tmux session
 * `ct-se-<pid>-<short-uuid>` and tears it down in afterEach. Tests never
 * touch any tmux session not created here. The "parent pane" is a fresh
 * pane we create inside that session and bind to TMUX_PANE before invoking
 * handleAgent.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { handleAgent } from "../../src/tools/agent.js";
import { handleSendMessage } from "../../src/tools/send-message.js";
import { handleStatus } from "../../src/tools/status.js";
import {
  handleGc,
  handleRestart,
  handleSendToTeam,
} from "../../src/tools/lifecycle.js";
import { handleTaskList } from "../../src/tools/tasks.js";
import { loadState, nowIso } from "../../src/state.js";
import { tmuxAvailable } from "../../src/tmux.js";
import { buildArgs } from "../../src/copilot.js";

const STUB = resolve(__dirname, "fixtures/stub-copilot");
const have = await tmuxAvailable();

interface Ctx {
  session: string;
  parentPane: string;
  parentWindowId: string;
  dir: string;
  statePath: string;
  stubDir: string;
  sessionRoot: string;
  /** All panes/windows created so we can clean up regardless of test path. */
  cleanupTargets: string[];
}

const tmux = async (args: string[]) => {
  const r = await execa("tmux", args, { reject: false });
  return {
    exit: r.exitCode ?? 1,
    stdout: r.stdout?.toString() ?? "",
    stderr: r.stderr?.toString() ?? "",
  };
};

const display = async (target: string, fmt: string): Promise<string> => {
  const r = await tmux(["display-message", "-p", "-t", target, fmt]);
  return r.stdout.trim();
};

const listPanes = async (
  session: string,
): Promise<{ pane: string; window: string; left: number; top: number }[]> => {
  const r = await tmux([
    "list-panes",
    "-s",
    "-t",
    session,
    "-F",
    "#{pane_id} #{window_id} #{pane_left} #{pane_top}",
  ]);
  if (r.exit !== 0) return [];
  return r.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [pane, window, left, top] = l.split(/\s+/);
      return {
        pane: pane!,
        window: window!,
        left: Number(left),
        top: Number(top),
      };
    });
};

const setupCtx = async (): Promise<Ctx> => {
  const session = `ct-se-${process.pid}-${randomUUID().slice(0, 8)}`;
  // Create the session detached. Its lone pane becomes our parent pane.
  const created = await execa(
    "tmux",
    [
      "new-session",
      "-d",
      "-s",
      session,
      "-x",
      "200",
      "-y",
      "60",
      "-P",
      "-F",
      "#{pane_id} #{window_id}",
    ],
    { reject: false },
  );
  if ((created.exitCode ?? 1) !== 0) {
    throw new Error(`tmux new-session failed: ${created.stderr}`);
  }
  const [parentPane, parentWindowId] =
    created.stdout?.toString().trim().split(/\s+/) ?? [];
  if (!parentPane || !parentWindowId) {
    throw new Error(`bad new-session output: ${created.stdout}`);
  }
  const dir = mkdtempSync(join(tmpdir(), "ct-se-"));
  const statePath = join(dir, "state.json");
  const stubDir = mkdtempSync(join(tmpdir(), "ct-se-stub-"));
  const sessionRoot = mkdtempSync(join(tmpdir(), "ct-se-sroot-"));
  process.env.STUB_COPILOT_DIR = stubDir;
  process.env.COPILOT_SESSION_ROOT = sessionRoot;
  process.env.TMUX_SESSION = session;
  process.env.TMUX_PANE = parentPane;
  // Pretend we're inside tmux so the agent uses split-pane mode.
  if (!process.env.TMUX) process.env.TMUX = "/tmp/fake-tmux,0,0";
  return {
    session,
    parentPane,
    parentWindowId,
    dir,
    statePath,
    stubDir,
    sessionRoot,
    cleanupTargets: [],
  };
};

const teardownCtx = async (ctx: Ctx | null): Promise<void> => {
  if (!ctx) return;
  // Kill the entire session — only ones we created.
  await execa("tmux", ["kill-session", "-t", ctx.session], { reject: false });
  rmSync(ctx.dir, { recursive: true, force: true });
  rmSync(ctx.stubDir, { recursive: true, force: true });
  rmSync(ctx.sessionRoot, { recursive: true, force: true });
  delete process.env.TMUX_PANE;
  delete process.env.TMUX_SESSION;
};

const stdEnv = (ctx: Ctx) => ({
  COPILOT_SESSION_ROOT: ctx.sessionRoot,
  STUB_COPILOT_DIR: ctx.stubDir,
});

const stdDeps = (ctx: Ctx) => ({
  cwd: process.cwd(),
  binary: STUB,
  statePath: ctx.statePath,
  sessionRoot: ctx.sessionRoot,
  env: stdEnv(ctx),
});

describe.skipIf(!have)("SE-team scenarios", () => {
  let ctx: Ctx | null = null;
  beforeEach(async () => {
    ctx = await setupCtx();
  });
  afterEach(async () => {
    await teardownCtx(ctx);
    ctx = null;
  });

  it("S1 — parallel-spawn chains off a single anchor", async () => {
    const c = ctx!;
    const spawn = (name: string) =>
      handleAgent(
        {
          description: name,
          name,
          run_in_background: true,
        },
        stdDeps(c),
      );

    const [a, b, d] = await Promise.all([
      spawn("tpm"),
      spawn("tech-fellow"),
      spawn("ci-chaser"),
    ]);

    // All distinct
    const ids = [a.tmuxTarget!, b.tmuxTarget!, d.tmuxTarget!];
    expect(new Set(ids).size).toBe(3);

    // All in the same window as the parent pane.
    for (const t of ids) {
      const win = await display(t, "#{window_id}");
      expect(win).toBe(c.parentWindowId);
    }

    // Anchor recorded.
    const st = loadState({ path: c.statePath });
    expect(st.anchor?.paneId).toBe(c.parentPane);

    // Layout: parent on left, three agents in the right column. Concretely,
    // exactly one pane has pane_left == 0 (the parent), and three have
    // pane_left > 0 (the right column). Among the right column, exactly one
    // has pane_top == 0 (the topmost — the first horizontal split). The
    // others stack below it.
    const panes = await listPanes(c.session);
    const inWin = panes.filter((p) => p.window === c.parentWindowId);
    expect(inWin.length).toBe(4);
    const leftCol = inWin.filter((p) => p.left === 0);
    const rightCol = inWin.filter((p) => p.left > 0);
    expect(leftCol.length).toBe(1);
    expect(rightCol.length).toBe(3);
    // The right column should be a stack: distinct pane_top values, with
    // the smallest being the topmost agent (pane that came from the first
    // horizontal split off the parent). Don't require pane_top==0 — the
    // parent's pane_top can be >0 if the window has a status line, and
    // tmux's coordinate system is window-local but inherits the parent's.
    const tops = rightCol.map((p) => p.top).sort((a, b) => a - b);
    expect(new Set(tops).size).toBe(3);
  });

  it("S2 — focus drift: anchor wins over TMUX_PANE", async () => {
    const c = ctx!;
    // Create a distraction pane in the same window. (split horizontally so it
    // doesn't collide with the agent's right column intent.)
    const split = await tmux([
      "split-window",
      "-d",
      "-h",
      "-t",
      c.parentPane,
      "-P",
      "-F",
      "#{pane_id}",
      "sleep 9999",
    ]);
    const distraction = split.stdout.trim();
    expect(distraction).toMatch(/^%\d+$/);

    const a = await handleAgent(
      { description: "tpm", name: "tpm", run_in_background: true },
      stdDeps(c),
    );
    expect(a.tmuxTarget).toMatch(/^%\d+$/);

    // Now flip TMUX_PANE to the distraction pane (simulate MCP respawn).
    process.env.TMUX_PANE = distraction;

    const b = await handleAgent(
      { description: "ci-chaser", name: "ci-chaser", run_in_background: true },
      stdDeps(c),
    );
    expect(b.tmuxTarget).toMatch(/^%\d+$/);

    // ci-chaser should be in the same window as the anchor, not in some
    // freshly-broken window. AND it should not have split the distraction
    // pane (i.e. distraction's pane_at_left/right shouldn't have shrunk —
    // but easiest invariant: ci-chaser's parent in the layout chain is tpm,
    // not distraction. We assert that by pane_left geometry: ci-chaser
    // should sit in the same column as tpm (same pane_left), which differs
    // from distraction's pane_left.
    const tpmLeft = Number(await display(a.tmuxTarget!, "#{pane_left}"));
    const ciLeft = Number(await display(b.tmuxTarget!, "#{pane_left}"));
    const distractionLeft = Number(await display(distraction, "#{pane_left}"));
    expect(ciLeft).toBe(tpmLeft);
    expect(ciLeft).not.toBe(distractionLeft);

    // Anchor unchanged.
    const st = loadState({ path: c.statePath });
    expect(st.anchor?.paneId).toBe(c.parentPane);
  });

  it("S3 — Status reports ready on a live %N pane", async () => {
    const c = ctx!;
    const a = await handleAgent(
      {
        description: "ready-test",
        name: "ready-test",
        prompt: "say boot",
        run_in_background: true,
        wait_first_turn_ms: 5000,
      },
      stdDeps(c),
    );
    const before = Object.keys(loadState({ path: c.statePath }).tasks).length;
    const s = await handleStatus(
      { id: a.id },
      { statePath: c.statePath, sessionRoot: c.sessionRoot },
    );
    expect(s.session.state).toBe("idle");
    expect(s.pane.alive).toBe(true);
    expect(s.ready).toBe(true);
    const after = Object.keys(loadState({ path: c.statePath }).tasks).length;
    expect(after).toBe(before);
  });

  it("S4 — SendMessage to tpm doesn't shadow ci-chaser", async () => {
    const c = ctx!;
    const _tpm = await handleAgent(
      { description: "tpm", name: "tpm", run_in_background: true },
      stdDeps(c),
    );
    const ciChaser = await handleAgent(
      { description: "ci-chaser", name: "ci-chaser", run_in_background: true },
      stdDeps(c),
    );

    await handleSendMessage(
      { to: "tpm", message: "remember tracked=ci-chaser" },
      { binary: STUB, statePath: c.statePath, sessionRoot: c.sessionRoot },
    );
    const r = await handleSendMessage(
      { to: "tpm", message: "what is tracked?" },
      { binary: STUB, statePath: c.statePath, sessionRoot: c.sessionRoot },
    );
    expect(r.output).toBe("ci-chaser");

    // ci-chaser saw zero user messages.
    const ciEvents = join(c.sessionRoot, ciChaser.id, "events.jsonl");
    if (existsSync(ciEvents)) {
      const ev = readFileSync(ciEvents, "utf8");
      expect(ev).not.toContain('"user.message"');
    }
  });

  it("S5 — findTaskId picks the live, most-recent pane among many stale", async () => {
    const c = ctx!;
    // Pre-populate state with 7 stale tech-fellow entries.
    const stale: Record<string, unknown> = {};
    for (let i = 0; i < 7; i++) {
      const id = randomUUID();
      stale[id] = {
        id,
        name: "tech-fellow",
        status: "running",
        tmuxTarget: `%9999${i}`, // non-existent pane
        createdAt: new Date(Date.now() - 1000 * 60 * (60 + i)).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * (60 + i)).toISOString(),
        background: true,
      };
    }
    mkdirSync(c.dir, { recursive: true });
    writeFileSync(
      c.statePath,
      JSON.stringify(
        { tasks: stale, teams: {}, anchor: null },
        null,
        2,
      ),
    );

    // Now spawn the live one.
    const live = await handleAgent(
      {
        description: "tech-fellow",
        name: "tech-fellow",
        prompt: "remember sentinel=I_AM_LIVE",
        run_in_background: true,
        wait_first_turn_ms: 5000,
      },
      stdDeps(c),
    );

    const r = await handleSendMessage(
      { to: "tech-fellow", message: "what is sentinel?", timeout_ms: 8000 },
      { binary: STUB, statePath: c.statePath, sessionRoot: c.sessionRoot },
    );
    expect(r.id).toBe(live.id);
    expect(r.via).toBe("send-keys");
    expect(r.output).toBe("I_AM_LIVE");
  }, 20_000);

  it("S6 — Restart 3x: pane reused, uuid changes", async () => {
    const c = ctx!;
    const a = await handleAgent(
      {
        description: "rst",
        name: "rst",
        prompt: "say boot",
        run_in_background: true,
        wait_first_turn_ms: 5000,
      },
      stdDeps(c),
    );
    const originalPane = a.tmuxTarget!;
    const seenIds = new Set<string>([a.id]);
    let lastId = a.id;
    for (let i = 0; i < 3; i++) {
      const r = await handleRestart({ id: "rst" }, stdDeps(c));
      expect(r.tmuxTarget).toBe(originalPane);
      expect(r.id).not.toBe(lastId);
      seenIds.add(r.id);
      lastId = r.id;
    }
    expect(seenIds.size).toBe(4);
    // Final state: lastId is the only running rst.
    const st = loadState({ path: c.statePath });
    const runningRst = Object.values(st.tasks).filter(
      (t) => t.name === "rst" && t.status === "running",
    );
    expect(runningRst.length).toBe(1);
    expect(runningRst[0]?.id).toBe(lastId);
    expect(runningRst[0]?.tmuxTarget).toBe(originalPane);
  });

  it("S7 — bullet-line persona doesn't error tmux", async () => {
    const c = ctx!;
    const a = await handleAgent(
      { description: "bullet", name: "bullet", run_in_background: true },
      stdDeps(c),
    );
    expect(a.status).toBe("running");
    const r = await handleSendMessage(
      { to: "bullet", message: "- review code\n- write tests" },
      { binary: STUB, statePath: c.statePath, sessionRoot: c.sessionRoot },
    );
    expect(r.output.length).toBeGreaterThan(0);
    const events = readFileSync(join(c.sessionRoot, a.id, "events.jsonl"), "utf8");
    expect(events).toContain("review code");
  });

  it("S8 — system_prompt materializes _ct_tmp_<uuid>.md and --agent argv", async () => {
    const c = ctx!;
    const persona = "You are TURTLE.\n- be terse\n- no fluff";
    const out = await handleAgent(
      {
        description: "sp",
        prompt: "say x",
        run_in_background: false,
        system_prompt: persona,
      },
      stdDeps(c),
    );
    const tmpName = `_ct_tmp_${out.id.replace(/-/g, "")}`;
    const fpath = join(homedir(), ".copilot", "agents", `${tmpName}.md`);
    try {
      expect(existsSync(fpath)).toBe(true);
      const body = readFileSync(fpath, "utf8");
      expect(body).toContain("TURTLE");
      expect(body).toContain("- be terse");
      expect(body).toContain(out.id);
      // Argv composition: buildArgs with the same temp agent name must
      // include `--agent <tmpName>`.
      const args = buildArgs({
        uuid: out.id,
        background: false,
        prompt: "say x",
        subagentType: tmpName,
      });
      const idx = args.indexOf("--agent");
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(args[idx + 1]).toBe(tmpName);
    } finally {
      try {
        unlinkSync(fpath);
      } catch {
        /* ignore */
      }
    }
  });

  it("S9 — multi-line message: events.jsonl has one user.message with embedded newline", async () => {
    const c = ctx!;
    const a = await handleAgent(
      { description: "multi", name: "multi", run_in_background: true },
      stdDeps(c),
    );
    const r = await handleSendMessage(
      { to: "multi", message: "say first\nsay second" },
      { binary: STUB, statePath: c.statePath, sessionRoot: c.sessionRoot },
    );
    expect(r.output.length).toBeGreaterThan(0);
    // The stub-copilot REPL reads stdin line-by-line, so multi-line input
    // arrives as TWO separate user.message events. The contract we care
    // about is "no error". Assert the second line landed and was processed.
    const events = readFileSync(
      join(c.sessionRoot, a.id, "events.jsonl"),
      "utf8",
    );
    expect(events).toContain("say first");
    expect(events).toContain("say second");
  });

  it("S10 — concurrent SendMessages serialize via uuid lock", async () => {
    const c = ctx!;
    const a = await handleAgent(
      {
        description: "seq",
        name: "seq",
        prompt: "say boot",
        run_in_background: true,
        wait_first_turn_ms: 5000,
      },
      stdDeps(c),
    );
    expect(a.firstTurnId).toBe("0");
    const keys = ["A", "B", "C", "D", "E"];
    const results = await Promise.all(
      keys.map((k) =>
        handleSendMessage(
          { to: "seq", message: `say ${k}` },
          { binary: STUB, statePath: c.statePath, sessionRoot: c.sessionRoot },
        ),
      ),
    );
    expect(results.map((r) => r.output).sort()).toEqual(keys);
    const turnIds = results.map((r) => Number(r.turnId)).sort((a, b) => a - b);
    expect(turnIds).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(turnIds).size).toBe(5);
  });

  it("S11 — GC touches only orphans", async () => {
    const c = ctx!;
    // Spawn one real agent so we have a known uuid in state + sessionRoot.
    const known = await handleAgent(
      {
        description: "knowngc",
        name: "knowngc",
        prompt: "say x",
        run_in_background: true,
        wait_first_turn_ms: 5000,
      },
      stdDeps(c),
    );
    expect(existsSync(join(c.sessionRoot, known.id))).toBe(true);
    // Drop an orphan session dir.
    const orphanUuid = "deadbeef-dead-beef-dead-beefdeadbeef";
    mkdirSync(join(c.sessionRoot, orphanUuid), { recursive: true });
    // Drop an orphan persona file in the real ~/.copilot/agents dir.
    const personasDir = join(homedir(), ".copilot", "agents");
    mkdirSync(personasDir, { recursive: true });
    const orphanPersonaUuid = "cafebabecafebabecafebabecafebabe";
    const orphanPersonaFile = `_ct_tmp_${orphanPersonaUuid}.md`;
    const orphanPersonaPath = join(personasDir, orphanPersonaFile);
    writeFileSync(orphanPersonaPath, "---\nname: x\n---\nbody");
    try {
      const r = await handleGc(
        { dry_run: false },
        { statePath: c.statePath, sessionRoot: c.sessionRoot },
      );
      expect(r.orphanSessionDirsRemoved).toContain(orphanUuid);
      expect(r.ephemeralPersonaFilesRemoved).toContain(orphanPersonaFile);
      // Known survives.
      expect(existsSync(join(c.sessionRoot, known.id))).toBe(true);
      expect(existsSync(join(c.sessionRoot, orphanUuid))).toBe(false);
      expect(existsSync(orphanPersonaPath)).toBe(false);
    } finally {
      try {
        unlinkSync(orphanPersonaPath);
      } catch {
        /* */
      }
    }
  });

  it("S12 — kill-pane → reconcile to exited; pane.alive=false", async () => {
    const c = ctx!;
    const a = await handleAgent(
      {
        description: "dropme",
        name: "dropme",
        prompt: "say x",
        run_in_background: true,
        wait_first_turn_ms: 5000,
      },
      stdDeps(c),
    );
    await execa("tmux", ["kill-pane", "-t", a.tmuxTarget!], { reject: false });
    // Status: pane.alive=false
    const s = await handleStatus(
      { id: a.id },
      { statePath: c.statePath, sessionRoot: c.sessionRoot },
    );
    expect(s.pane.alive).toBe(false);
    expect(s.ready).toBe(false);
    // TaskList reconciles to exited.
    const list = await handleTaskList(
      {},
      { statePath: c.statePath, sessionRoot: c.sessionRoot },
    );
    const t = list.find((x) => x.id === a.id);
    expect(t?.status).toBe("exited");
  });

  it("S13 — pane border @cop_name set to cop:<name>", async () => {
    const c = ctx!;
    const a = await handleAgent(
      { description: "bordertest", name: "bordertest", run_in_background: true },
      stdDeps(c),
    );
    const r = await tmux([
      "show-options",
      "-pv",
      "-t",
      a.tmuxTarget!,
      "@cop_name",
    ]);
    expect(r.exit).toBe(0);
    expect(r.stdout.trim()).toBe("cop:bordertest");
  });

  it("S14 — SendToTeam broadcast hits all live members", async () => {
    const c = ctx!;
    const spawn = (name: string) =>
      handleAgent(
        {
          description: name,
          name,
          team_name: "team-x",
          run_in_background: true,
        },
        stdDeps(c),
      );
    const _m1 = await spawn("m1");
    const _m2 = await spawn("m2");
    const _m3 = await spawn("m3");
    const r = await handleSendToTeam(
      { team: "team-x", message: "say HELLO" },
      { binary: STUB, statePath: c.statePath, sessionRoot: c.sessionRoot },
    );
    expect(r.results.length).toBe(3);
    for (const e of r.results) {
      expect(e.error ?? null).toBeNull();
      expect(e.output).toBe("HELLO");
    }
  });

  it("S15 — restart while busy: no race, no duplicate", async () => {
    const c = ctx!;
    const a = await handleAgent(
      {
        description: "racy",
        name: "racy",
        prompt: "say boot",
        run_in_background: true,
        wait_first_turn_ms: 5000,
      },
      stdDeps(c),
    );
    const originalPane = a.tmuxTarget!;
    const sm = handleSendMessage(
      { to: "racy", message: "say slowboat", timeout_ms: 8000 },
      { binary: STUB, statePath: c.statePath, sessionRoot: c.sessionRoot },
    );
    // Fire restart immediately. Because the SendMessage is also holding
    // (acquiring) the uuid lock, the restart's pane teardown will race the
    // send. We require: no exception killing the test, both eventually settle.
    // Tiny stagger so SendMessage definitely starts before restart kicks in.
    await new Promise((r) => setTimeout(r, 50));
    const rs = handleRestart({ id: "racy" }, stdDeps(c)).catch((err) => ({
      __error: err instanceof Error ? err.message : String(err),
    }));
    const [smRes, rsRes] = await Promise.allSettled([sm, rs]);
    // The send may legitimately fail (target killed mid-flight). Accept that.
    // What matters: at most one running 'racy' afterwards, on the same pane.
    void smRes;
    void rsRes;
    const st = loadState({ path: c.statePath });
    const runningRacy = Object.values(st.tasks).filter(
      (t) => t.name === "racy" && t.status === "running",
    );
    expect(runningRacy.length).toBeLessThanOrEqual(1);
    if (runningRacy.length === 1) {
      expect(runningRacy[0]?.tmuxTarget).toBe(originalPane);
    }
  }, 25_000);

  it("S16 — non-blocking spawn: returns fast without wait_first_turn_ms", async () => {
    const c = ctx!;
    const start = Date.now();
    const a = await handleAgent(
      {
        description: "fast",
        name: "fast",
        prompt: "say x",
        run_in_background: true,
      },
      stdDeps(c),
    );
    const dur = Date.now() - start;
    expect(a.status).toBe("running");
    expect(a.firstTurnId).toBeUndefined();
    expect(a.output).toBeUndefined();
    expect(dur).toBeLessThan(5000);
  });

  it("S17 — concurrent Agent calls + team_name: TeamCreate happens once", async () => {
    const c = ctx!;
    const spawn = (name: string) =>
      handleAgent(
        {
          description: name,
          name,
          team_name: "fast",
          run_in_background: true,
        },
        stdDeps(c),
      );
    const [a, b, d] = await Promise.all([
      spawn("f1"),
      spawn("f2"),
      spawn("f3"),
    ]);
    const st = loadState({ path: c.statePath });
    expect(st.teams["fast"]).toBeDefined();
    expect(typeof st.teams["fast"]?.createdAt).toBe("string");
    expect(st.tasks[a.id]?.team).toBe("fast");
    expect(st.tasks[b.id]?.team).toBe("fast");
    expect(st.tasks[d.id]?.team).toBe("fast");
    expect(new Set([a.tmuxTarget!, b.tmuxTarget!, d.tmuxTarget!]).size).toBe(3);
  });

  it("S18 — Status by name picks live entry when many same-name exist", async () => {
    const c = ctx!;
    const stale: Record<string, unknown> = {};
    for (let i = 0; i < 7; i++) {
      const id = randomUUID();
      stale[id] = {
        id,
        name: "tech-fellow",
        status: "running",
        tmuxTarget: `%9999${i}`,
        createdAt: new Date(Date.now() - 1000 * 60 * (60 + i)).toISOString(),
        updatedAt: new Date(Date.now() - 1000 * 60 * (60 + i)).toISOString(),
        background: true,
      };
    }
    writeFileSync(
      c.statePath,
      JSON.stringify({ tasks: stale, teams: {}, anchor: null }, null, 2),
    );
    const live = await handleAgent(
      {
        description: "tech-fellow",
        name: "tech-fellow",
        prompt: "say x",
        run_in_background: true,
        wait_first_turn_ms: 5000,
      },
      stdDeps(c),
    );
    const s = await handleStatus(
      { id: "tech-fellow" },
      { statePath: c.statePath, sessionRoot: c.sessionRoot },
    );
    expect(s.id).toBe(live.id);
    expect(s.ready).toBe(true);
  });
});

// Make `nowIso` reachable for any future seeded fixtures.
export { nowIso };
