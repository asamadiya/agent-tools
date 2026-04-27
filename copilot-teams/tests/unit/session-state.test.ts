import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  awaitSessionReady,
  awaitTurnEnd,
  getTranscript,
  listAllSessionUuids,
  readEvents,
  removeSession,
  sessionLiveness,
} from "../../src/session-state.js";

const UUID = "11111111-2222-3333-4444-555555555555";

let root: string;

const writeEvents = (uuid: string, lines: object[]) => {
  const dir = join(root, uuid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "events.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
};

const append = (uuid: string, line: object) => {
  const path = join(root, uuid, "events.jsonl");
  writeFileSync(path, JSON.stringify(line) + "\n", { flag: "a" });
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ct-ss-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const ts = () => new Date().toISOString();

describe("readEvents", () => {
  it("returns [] when session missing", () => {
    expect(readEvents(UUID, { root })).toEqual([]);
  });

  it("parses well-formed jsonl, skips junk", () => {
    writeEvents(UUID, [
      { type: "session.start", data: {}, id: "a", timestamp: ts(), parentId: null },
      { type: "session.shutdown", data: {}, id: "b", timestamp: ts(), parentId: "a" },
    ]);
    // Intentional garbage line:
    writeFileSync(join(root, UUID, "events.jsonl"), "{garbage\n", { flag: "a" });
    const events = readEvents(UUID, { root });
    expect(events.map((e) => e.type)).toEqual(["session.start", "session.shutdown"]);
  });

  it("afterId filter returns only events strictly after the cursor", () => {
    writeEvents(UUID, [
      { type: "x", data: {}, id: "a", timestamp: ts(), parentId: null },
      { type: "y", data: {}, id: "b", timestamp: ts(), parentId: null },
      { type: "z", data: {}, id: "c", timestamp: ts(), parentId: null },
    ]);
    expect(readEvents(UUID, { root, afterId: "a" }).map((e) => e.id)).toEqual(["b", "c"]);
    expect(readEvents(UUID, { root, afterId: "c" })).toEqual([]);
  });

  it("tail caps to last N", () => {
    writeEvents(UUID, [1, 2, 3, 4, 5].map((n) => ({
      type: "x", data: { n }, id: `e${n}`, timestamp: ts(), parentId: null,
    })));
    const out = readEvents(UUID, { root, tail: 2 });
    expect(out.map((e) => e.id)).toEqual(["e4", "e5"]);
  });
});

describe("sessionLiveness", () => {
  it("missing for absent session", () => {
    const s = sessionLiveness(UUID, root);
    expect(s.state).toBe("missing");
    expect(s.exists).toBe(false);
  });

  it("starting after session.start with no turns yet", () => {
    writeEvents(UUID, [
      { type: "session.start", data: {}, id: "a", timestamp: ts(), parentId: null },
    ]);
    const s = sessionLiveness(UUID, root);
    expect(s.state).toBe("starting");
    expect(s.turnCount).toBe(0);
  });

  it("busy mid-turn", () => {
    writeEvents(UUID, [
      { type: "session.start", data: {}, id: "a", timestamp: ts(), parentId: null },
      { type: "user.message", data: { content: "hi" }, id: "b", timestamp: ts(), parentId: "a" },
      { type: "assistant.turn_start", data: { turnId: "0" }, id: "c", timestamp: ts(), parentId: "b" },
    ]);
    const s = sessionLiveness(UUID, root);
    expect(s.state).toBe("busy");
    expect(s.lastTurnId).toBe("0");
  });

  it("idle after turn_end", () => {
    writeEvents(UUID, [
      { type: "session.start", data: {}, id: "a", timestamp: ts(), parentId: null },
      { type: "assistant.turn_start", data: { turnId: "0" }, id: "b", timestamp: ts(), parentId: "a" },
      { type: "assistant.turn_end", data: { turnId: "0" }, id: "c", timestamp: ts(), parentId: "b" },
    ]);
    const s = sessionLiveness(UUID, root);
    expect(s.state).toBe("idle");
    expect(s.turnCount).toBe(1);
    expect(s.lastTurnId).toBe("0");
  });

  it("shutdown after session.shutdown", () => {
    writeEvents(UUID, [
      { type: "session.start", data: {}, id: "a", timestamp: ts(), parentId: null },
      { type: "session.shutdown", data: { shutdownType: "routine" }, id: "b", timestamp: ts(), parentId: "a" },
    ]);
    const s = sessionLiveness(UUID, root);
    expect(s.state).toBe("shutdown");
    expect(s.shutdownType).toBe("routine");
  });
});

describe("awaitSessionReady", () => {
  it("resolves once session.start lands", async () => {
    writeEvents(UUID, []);
    const p = awaitSessionReady(UUID, { root, pollMs: 30, timeoutMs: 2000 });
    setTimeout(() => append(UUID, { type: "session.start", data: {}, id: "x", timestamp: ts(), parentId: null }), 80);
    await expect(p).resolves.toBeUndefined();
  });

  it("rejects on timeout", async () => {
    writeEvents(UUID, []);
    await expect(
      awaitSessionReady(UUID, { root, pollMs: 30, timeoutMs: 100 }),
    ).rejects.toThrow(/no session\.start/);
  });
});

describe("awaitTurnEnd", () => {
  it("returns the next turn after baseline", async () => {
    writeEvents(UUID, [
      { type: "session.start", data: {}, id: "a", timestamp: ts(), parentId: null },
      { type: "assistant.turn_start", data: { turnId: "0" }, id: "b", timestamp: ts(), parentId: "a" },
      { type: "assistant.message", data: { content: "first" }, id: "c", timestamp: ts(), parentId: "b" },
      { type: "assistant.turn_end", data: { turnId: "0" }, id: "d", timestamp: ts(), parentId: "c" },
    ]);
    const p = awaitTurnEnd(UUID, { root, baselineTurnCount: 1, pollMs: 30, timeoutMs: 2000 });
    setTimeout(() => {
      append(UUID, { type: "user.message", data: { content: "again" }, id: "e", timestamp: ts(), parentId: "d" });
      append(UUID, { type: "assistant.turn_start", data: { turnId: "1" }, id: "f", timestamp: ts(), parentId: "e" });
      append(UUID, { type: "assistant.message", data: { content: "second" }, id: "g", timestamp: ts(), parentId: "f" });
      append(UUID, { type: "assistant.turn_end", data: { turnId: "1" }, id: "h", timestamp: ts(), parentId: "g" });
    }, 60);
    const out = await p;
    expect(out.turnId).toBe("1");
    expect(out.content).toBe("second");
  });

  it("returns first turn when baseline is null", async () => {
    writeEvents(UUID, [
      { type: "session.start", data: {}, id: "a", timestamp: ts(), parentId: null },
      { type: "assistant.turn_start", data: { turnId: "0" }, id: "b", timestamp: ts(), parentId: "a" },
      { type: "assistant.message", data: { content: "hi" }, id: "c", timestamp: ts(), parentId: "b" },
      { type: "assistant.turn_end", data: { turnId: "0" }, id: "d", timestamp: ts(), parentId: "c" },
    ]);
    const out = await awaitTurnEnd(UUID, { root, baselineTurnCount: 0, pollMs: 30, timeoutMs: 1000 });
    expect(out.turnId).toBe("0");
    expect(out.content).toBe("hi");
  });

  it("times out cleanly", async () => {
    writeEvents(UUID, []);
    await expect(
      awaitTurnEnd(UUID, { root, baselineTurnCount: 0, pollMs: 30, timeoutMs: 80 }),
    ).rejects.toThrow(/timed out/);
  });
});

describe("getTranscript", () => {
  it("returns normalized user/assistant turns in order", () => {
    writeEvents(UUID, [
      { type: "session.start", data: {}, id: "a", timestamp: ts(), parentId: null },
      { type: "assistant.turn_start", data: { turnId: "0" }, id: "b", timestamp: ts(), parentId: "a" },
      { type: "user.message", data: { content: "Q1" }, id: "c", timestamp: ts(), parentId: "b" },
      { type: "assistant.message", data: { content: "A1" }, id: "d", timestamp: ts(), parentId: "c" },
      { type: "assistant.turn_end", data: { turnId: "0" }, id: "e", timestamp: ts(), parentId: "d" },
      { type: "assistant.turn_start", data: { turnId: "1" }, id: "f", timestamp: ts(), parentId: "e" },
      { type: "user.message", data: { content: "Q2" }, id: "g", timestamp: ts(), parentId: "f" },
      { type: "assistant.message", data: { content: "A2" }, id: "h", timestamp: ts(), parentId: "g" },
      { type: "assistant.turn_end", data: { turnId: "1" }, id: "i", timestamp: ts(), parentId: "h" },
    ]);
    const t = getTranscript(UUID, { root });
    expect(t.map((x) => `${x.role}:${x.content}`)).toEqual([
      "user:Q1", "assistant:A1", "user:Q2", "assistant:A2",
    ]);
    expect(t[2]?.turnId).toBe("1");
  });

  it("sinceTurn filters to numerically >= turn", () => {
    writeEvents(UUID, [
      { type: "assistant.turn_start", data: { turnId: "0" }, id: "a", timestamp: ts(), parentId: null },
      { type: "user.message", data: { content: "Q1" }, id: "b", timestamp: ts(), parentId: "a" },
      { type: "assistant.turn_start", data: { turnId: "1" }, id: "c", timestamp: ts(), parentId: "b" },
      { type: "user.message", data: { content: "Q2" }, id: "d", timestamp: ts(), parentId: "c" },
    ]);
    const t = getTranscript(UUID, { root, sinceTurn: 1 });
    expect(t.map((x) => x.content)).toEqual(["Q2"]);
  });
});

describe("listAllSessionUuids / removeSession", () => {
  it("lists only uuid-shaped subdirs", () => {
    mkdirSync(join(root, "11111111-2222-3333-4444-555555555555"));
    mkdirSync(join(root, "not-a-uuid"));
    expect(listAllSessionUuids(root)).toEqual(["11111111-2222-3333-4444-555555555555"]);
  });

  it("removeSession deletes the dir", () => {
    mkdirSync(join(root, UUID));
    expect(listAllSessionUuids(root)).toContain(UUID);
    removeSession(UUID, root);
    expect(listAllSessionUuids(root)).not.toContain(UUID);
  });
});
