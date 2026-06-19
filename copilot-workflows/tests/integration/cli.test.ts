import { execa } from "execa";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let root: string;
let scriptPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cw-cli-"));
  scriptPath = join(root, "demo.js");
  writeFileSync(scriptPath, "export const meta = { name: 'cli-demo', description: 'CLI demo' }\nreturn 'ok'\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("copilot-workflow CLI", () => {
  it("inspects a script", async () => {
    await execa("npm", ["run", "build"], { cwd: process.cwd() });
    const r = await execa("node", ["dist/cli.js", "inspect", scriptPath], {
      cwd: process.cwd(),
      env: { ...process.env, COPILOT_WORKFLOWS_ROOT: root },
      reject: false,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("cli-demo");
  });

  it("resume command runs to completion with resumeFromRunId set", async () => {
    await execa("npm", ["run", "build"], { cwd: process.cwd() });

    // First: launch a prior run to get a run ID
    const prior = await execa("node", ["dist/cli.js", "run", scriptPath], {
      cwd: process.cwd(),
      env: { ...process.env, COPILOT_WORKFLOWS_ROOT: root },
      reject: false,
    });
    expect(prior.exitCode).toBe(0);
    const priorLaunch = JSON.parse(prior.stdout) as { runId: string; status: string };
    expect(priorLaunch.status).toBe("completed");

    // Then: resume from that run ID
    const r = await execa("node", ["dist/cli.js", "resume", priorLaunch.runId, scriptPath], {
      cwd: process.cwd(),
      env: { ...process.env, COPILOT_WORKFLOWS_ROOT: root },
      reject: false,
    });
    expect(r.exitCode).toBe(0);
    const launch = JSON.parse(r.stdout) as { runId: string; status: string };
    expect(launch.status).toBe("completed");

    // Inspect persisted state: resumeFromRunId must equal the prior run ID
    const runFile = join(root, "runs", `${launch.runId}.json`);
    const persisted = JSON.parse(readFileSync(runFile, "utf8")) as { resumeFromRunId?: string };
    expect(persisted.resumeFromRunId).toBe(priorLaunch.runId);
  });

  it("run --resume-from runs to completion with resumeFromRunId set", async () => {
    await execa("npm", ["run", "build"], { cwd: process.cwd() });

    // First: launch a prior run to get a run ID
    const prior = await execa("node", ["dist/cli.js", "run", scriptPath], {
      cwd: process.cwd(),
      env: { ...process.env, COPILOT_WORKFLOWS_ROOT: root },
      reject: false,
    });
    expect(prior.exitCode).toBe(0);
    const priorLaunch = JSON.parse(prior.stdout) as { runId: string; status: string };

    // Then: run with --resume-from flag
    const r = await execa("node", ["dist/cli.js", "run", scriptPath, "--resume-from", priorLaunch.runId], {
      cwd: process.cwd(),
      env: { ...process.env, COPILOT_WORKFLOWS_ROOT: root },
      reject: false,
    });
    expect(r.exitCode).toBe(0);
    const launch = JSON.parse(r.stdout) as { runId: string; status: string };
    expect(launch.status).toBe("completed");

    // Inspect persisted state: resumeFromRunId must equal the prior run ID
    const runFile = join(root, "runs", `${launch.runId}.json`);
    const persisted = JSON.parse(readFileSync(runFile, "utf8")) as { resumeFromRunId?: string };
    expect(persisted.resumeFromRunId).toBe(priorLaunch.runId);
  });

  it("ui --once prints the interactive workflow list snapshot", async () => {
    await execa("npm", ["run", "build"], { cwd: process.cwd() });

    const prior = await execa("node", ["dist/cli.js", "run", scriptPath], {
      cwd: process.cwd(),
      env: { ...process.env, COPILOT_WORKFLOWS_ROOT: root },
      reject: false,
    });
    expect(prior.exitCode).toBe(0);

    const r = await execa("node", ["dist/cli.js", "ui", "--once"], {
      cwd: process.cwd(),
      env: { ...process.env, COPILOT_WORKFLOWS_ROOT: root },
      reject: false,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Workflows");
    expect(r.stdout).toContain("WF1");
    expect(r.stdout).toContain("cli-demo");
  });
});
