import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execa } from "execa";
import {
  capturePane,
  ensureSession,
  killWindow,
  listWindows,
  sendLine,
  spawnWindow,
  tmuxAvailable,
} from "../../src/tmux.js";

const SESSION = `copilot-teams-it-${process.pid}`;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const haveTmux = await tmuxAvailable();

describe.skipIf(!haveTmux)("tmux integration", () => {
  beforeAll(async () => {
    await ensureSession(SESSION);
  });

  afterAll(async () => {
    await execa("tmux", ["kill-session", "-t", SESSION], { reject: false });
  });

  it("spawns a window, captures output, kills it", async () => {
    const w = await spawnWindow({
      session: SESSION,
      windowName: `cop:probe-${Math.random().toString(36).slice(2, 8)}`,
      command: "printf 'HELLO\\n'; sleep 30",
    });
    expect(w.target).toBe(`${SESSION}:${w.windowName}`);
    expect(w.panePid).toBeGreaterThan(0);

    // Wait for printf to land
    await wait(150);
    const captured = await capturePane(w.target, { joinWrapped: true });
    expect(captured).toContain("HELLO");

    const rows = await listWindows(SESSION);
    expect(rows.find((r) => r.windowName === w.windowName)).toBeDefined();

    await killWindow(w.target);
    const after = await listWindows(SESSION);
    expect(after.find((r) => r.windowName === w.windowName)).toBeUndefined();
  });

  it("sendLine sends text and Enter", async () => {
    const name = `cop:keys-${Math.random().toString(36).slice(2, 8)}`;
    const w = await spawnWindow({
      session: SESSION,
      windowName: name,
      command: "cat", // echoes whatever is sent
    });
    await wait(120);
    await sendLine(w.target, "PING");
    await wait(120);
    const captured = await capturePane(w.target);
    expect(captured).toContain("PING");
    await killWindow(w.target);
  });

  it("sendLine fans out multi-line content via sendBlock", async () => {
    const name = `cop:multi-${Math.random().toString(36).slice(2, 8)}`;
    const w = await spawnWindow({ session: SESSION, windowName: name, command: "cat" });
    await wait(120);
    await sendLine(w.target, "first\nsecond\nthird");
    await wait(150);
    const captured = await capturePane(w.target);
    expect(captured).toContain("first");
    expect(captured).toContain("second");
    expect(captured).toContain("third");
    await killWindow(w.target);
  });

  it("listWindows on missing session returns []", async () => {
    expect(await listWindows("definitely-missing-session-xyz-123")).toEqual([]);
  });
});
