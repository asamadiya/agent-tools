import { execa } from "execa";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
});
