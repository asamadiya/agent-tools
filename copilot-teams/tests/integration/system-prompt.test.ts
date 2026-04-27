import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { handleAgent } from "../../src/tools/agent.js";
import { handleGc } from "../../src/tools/lifecycle.js";
import { tmuxAvailable } from "../../src/tmux.js";

const STUB = resolve(__dirname, "fixtures/stub-copilot");
const SESSION = `copilot-teams-sysp-it-${process.pid}`;
const have = await tmuxAvailable();

let dir: string;
let statePath: string;
let stubDir: string;
let sessionRoot: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ct-sp-"));
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

describe.skipIf(!have)("system_prompt — temp persona materialization", () => {
  it("writes ~/.copilot/agents/_ct_tmp_<uuid>.md and selects --agent for it", async () => {
    const personaText = "You are TURTLE_VOICE. Always say TURTLE.";
    const out = await handleAgent(
      {
        description: "sp-test",
        prompt: "say hi",
        run_in_background: false,
        system_prompt: personaText,
      },
      { cwd: process.cwd(), binary: STUB, statePath, sessionRoot, env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir } },
    );
    expect(out.status).toBe("exited");
    const personasDir = join(homedir(), ".copilot", "agents");
    const fname = `_ct_tmp_${out.id.replace(/-/g, "")}.md`;
    const fpath = join(personasDir, fname);
    expect(existsSync(fpath)).toBe(true);
    const body = readFileSync(fpath, "utf8");
    expect(body).toContain("TURTLE_VOICE");
    expect(body).toContain(out.id);

    // Cleanup so we don't leave state behind across test runs.
    const { unlinkSync } = await import("node:fs");
    try { unlinkSync(fpath); } catch { /* */ }
  });

  it("rejects passing both subagent_type and system_prompt", async () => {
    await expect(
      handleAgent(
        {
          description: "x",
          prompt: "say x",
          subagent_type: "researcher",
          system_prompt: "pretend",
          run_in_background: false,
        },
        { cwd: process.cwd(), binary: STUB, statePath, sessionRoot, env: { COPILOT_SESSION_ROOT: sessionRoot, STUB_COPILOT_DIR: stubDir } },
      ),
    ).rejects.toThrow(/either subagent_type or system_prompt/);
  });
});

describe("GC — ephemeral persona files", () => {
  it("dry_run reports orphaned _ct_tmp_*.md without removing", async () => {
    // Drop a fake orphan into the user's real ~/.copilot/agents dir using a
    // uuid that's NOT in our state. Cleanup carefully in afterEach.
    const personasDir = join(homedir(), ".copilot", "agents");
    mkdirSync(personasDir, { recursive: true });
    const orphanUuid = "11111111111111111111111111111111";
    const fname = `_ct_tmp_${orphanUuid}.md`;
    const fpath = join(personasDir, fname);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(fpath, "---\nname: x\n---\nbody");

    try {
      const r = await handleGc({ dry_run: true }, { statePath, sessionRoot });
      expect(r.ephemeralPersonaFilesRemoved).toContain(fname);
      expect(existsSync(fpath)).toBe(true);

      const r2 = await handleGc({ dry_run: false }, { statePath, sessionRoot });
      expect(r2.ephemeralPersonaFilesRemoved).toContain(fname);
      expect(existsSync(fpath)).toBe(false);
    } finally {
      try { (await import("node:fs")).unlinkSync(fpath); } catch { /* */ }
    }
  });
});
