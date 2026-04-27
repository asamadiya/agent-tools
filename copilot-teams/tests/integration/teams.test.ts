import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { handleAgent } from "../../src/tools/agent.js";
import { handleTaskList } from "../../src/tools/tasks.js";
import {
  handleTeamCreate,
  handleTeamDelete,
} from "../../src/tools/teams.js";
import { tmuxAvailable } from "../../src/tmux.js";
import { loadState } from "../../src/state.js";

const STUB = resolve(__dirname, "fixtures/stub-copilot");
const SESSION = `copilot-teams-teams-it-${process.pid}`;
const have = await tmuxAvailable();

let dir: string;
let statePath: string;
let stubDir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ct-teams-"));
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

describe("TeamCreate / TeamDelete — pure metadata", () => {
  it("create is idempotent", async () => {
    const a = await handleTeamCreate({ name: "review" }, { statePath });
    const b = await handleTeamCreate({ name: "review" }, { statePath });
    expect(a.name).toBe("review");
    expect(b.createdAt).toBe(a.createdAt); // not recreated
  });

  it("delete-empty returns deleted:true", async () => {
    await handleTeamCreate({ name: "x" }, { statePath });
    const r = await handleTeamDelete({ name: "x" }, { statePath });
    expect(r.deleted).toBe(true);
    expect(r.stoppedMembers).toEqual([]);
  });

  it("delete-nonexistent returns deleted:false", async () => {
    const r = await handleTeamDelete({ name: "nope" }, { statePath });
    expect(r.deleted).toBe(false);
  });
});

describe.skipIf(!have)("TeamDelete — with live members", () => {
  it("refuses without force when members are running", async () => {
    await handleTeamCreate({ name: "rev" }, { statePath });
    const a = await handleAgent(
      {
        description: "m1",
        prompt: "say x",
        team_name: "rev",
        run_in_background: true,
        name: "m1",
      },
      { cwd: process.cwd(), binary: STUB, statePath, env: { STUB_COPILOT_DIR: stubDir } },
    );
    await expect(
      handleTeamDelete({ name: "rev" }, { statePath }),
    ).rejects.toThrow(/running member/);
    if (a.tmuxTarget) {
      await execa("tmux", ["kill-window", "-t", a.tmuxTarget], { reject: false });
    }
  });

  it("force:true stops members and removes the team", async () => {
    await handleTeamCreate({ name: "rev2" }, { statePath });
    const a = await handleAgent(
      {
        description: "m1",
        prompt: "say a",
        team_name: "rev2",
        run_in_background: true,
        name: "rev2-m1",
      },
      { cwd: process.cwd(), binary: STUB, statePath, env: { STUB_COPILOT_DIR: stubDir } },
    );
    const b = await handleAgent(
      {
        description: "m2",
        prompt: "say b",
        team_name: "rev2",
        run_in_background: true,
        name: "rev2-m2",
      },
      { cwd: process.cwd(), binary: STUB, statePath, env: { STUB_COPILOT_DIR: stubDir } },
    );
    const r = await handleTeamDelete({ name: "rev2", force: true }, { statePath });
    expect(r.deleted).toBe(true);
    expect(r.stoppedMembers.sort()).toEqual([a.id, b.id].sort());

    const after = loadState({ path: statePath });
    expect(after.teams["rev2"]).toBeUndefined();
    expect(after.tasks[a.id]?.status).toBe("stopped");
    expect(after.tasks[a.id]?.team).toBeUndefined();
  });

  it("TaskList filters by team_name", async () => {
    await handleTeamCreate({ name: "filt" }, { statePath });
    await handleAgent(
      {
        description: "in",
        prompt: "say x",
        team_name: "filt",
        run_in_background: true,
        name: "filt-in",
      },
      { cwd: process.cwd(), binary: STUB, statePath, env: { STUB_COPILOT_DIR: stubDir } },
    );
    await handleAgent(
      { description: "out", prompt: "say y", run_in_background: true, name: "filt-out" },
      { cwd: process.cwd(), binary: STUB, statePath, env: { STUB_COPILOT_DIR: stubDir } },
    );
    const inFilt = await handleTaskList({ team_name: "filt" }, { statePath });
    expect(inFilt.length).toBe(1);
    expect(inFilt[0]?.name).toBe("filt-in");

    // Cleanup
    await handleTeamDelete({ name: "filt", force: true }, { statePath });
  });
});
