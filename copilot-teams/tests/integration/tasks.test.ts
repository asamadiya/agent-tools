import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { handleAgent } from "../../src/tools/agent.js";
import {
  handleTaskCreate,
  handleTaskGet,
  handleTaskList,
  handleTaskOutput,
  handleTaskStop,
  handleTaskUpdate,
} from "../../src/tools/tasks.js";
import { tmuxAvailable } from "../../src/tmux.js";

const STUB = resolve(__dirname, "fixtures/stub-copilot");
const SESSION = `copilot-teams-tasks-it-${process.pid}`;
const have = await tmuxAvailable();

let dir: string;
let statePath: string;
let stubDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ct-tasks-"));
  statePath = join(dir, "state.json");
  stubDir = mkdtempSync(join(tmpdir(), "ct-stub-"));
  process.env.STUB_COPILOT_DIR = stubDir;
  process.env.TMUX_SESSION = SESSION;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(stubDir, { recursive: true, force: true });
});

afterAll(async () => {
  await execa("tmux", ["kill-session", "-t", SESSION], { reject: false });
});

const spawnBg = async (name: string) =>
  handleAgent(
    { description: name, prompt: `say hi-${name}`, name, run_in_background: true },
    { cwd: process.cwd(), binary: STUB, statePath, env: { STUB_COPILOT_DIR: stubDir } },
  );

describe("Task* — todo flavor", () => {
  it("TaskCreate / TaskUpdate / TaskGet round-trip", async () => {
    const t = await handleTaskCreate(
      { content: "write README", status: "todo" },
      { statePath },
    );
    expect(t.status).toBe("todo");
    expect(t.description).toBe("write README");

    const u = await handleTaskUpdate(
      { id: t.id, status: "in_progress" },
      { statePath },
    );
    expect(u.status).toBe("in_progress");

    const g = await handleTaskGet({ id: t.id }, { statePath });
    expect(g?.status).toBe("in_progress");
  });

  it("TaskList filters by status", async () => {
    const a = await handleTaskCreate({ content: "A", status: "todo" }, { statePath });
    const b = await handleTaskCreate({ content: "B", status: "completed" }, { statePath });
    const todos = await handleTaskList({ status: "todo" }, { statePath });
    expect(todos.map((t) => t.id)).toContain(a.id);
    expect(todos.map((t) => t.id)).not.toContain(b.id);
  });

  it("TaskUpdate rejects unknown id", async () => {
    await expect(
      handleTaskUpdate({ id: "nope", status: "completed" }, { statePath }),
    ).rejects.toThrow();
  });
});

describe.skipIf(!have)("Task* — running-agent flavor", () => {
  it("TaskList returns running spawned agents and reconciles dead ones", async () => {
    const a = await spawnBg("alpha");
    const b = await spawnBg("bravo");
    const all = await handleTaskList({}, { statePath });
    expect(all.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    expect(all.every((t) => t.status === "running")).toBe(true);

    // Kill alpha's window directly, list should reconcile.
    await execa("tmux", ["kill-window", "-t", a.tmuxTarget!], { reject: false });
    const reconciled = await handleTaskList({}, { statePath });
    const alphaT = reconciled.find((t) => t.id === a.id);
    expect(alphaT?.status).toBe("exited");

    if (b.tmuxTarget) {
      await execa("tmux", ["kill-window", "-t", b.tmuxTarget], { reject: false });
    }
  });

  it("TaskOutput pulls scrollback from tmux when running", async () => {
    const a = await spawnBg("outtest");
    // Wait for the wrapper + stub to print into the pane.
    let content = "";
    for (let i = 0; i < 30; i++) {
      const r = await handleTaskOutput({ id: a.id }, { statePath });
      content = r.content;
      if (content.includes("hi-outtest")) break;
      await new Promise((res) => setTimeout(res, 100));
    }
    expect(content).toContain("hi-outtest");
    if (a.tmuxTarget) {
      await execa("tmux", ["kill-window", "-t", a.tmuxTarget], { reject: false });
    }
  });

  it("TaskStop kills tmux window and marks task stopped", async () => {
    const a = await spawnBg("stopme");
    const stopped = await handleTaskStop({ id: a.id }, { statePath });
    expect(stopped.status).toBe("stopped");

    // Window should be gone.
    const r = await execa("tmux", ["list-windows", "-t", SESSION, "-F", "#{window_name}"], { reject: false });
    expect(r.stdout).not.toContain("cop:stopme");
  });
});
