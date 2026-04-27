import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadState,
  saveState,
  withState,
  StateSchema,
  nowIso,
  type State,
} from "../../src/state.js";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ct-state-"));
  path = join(dir, "state.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadState", () => {
  it("creates an empty state file when none exists", () => {
    const s = loadState({ path });
    expect(s).toEqual({ tasks: {}, teams: {}, anchor: null });
    expect(existsSync(path)).toBe(true);
  });

  it("parses valid JSON", () => {
    const seed: State = {
      tasks: {
        "u1": {
          id: "u1",
          status: "running",
          createdAt: nowIso(),
          updatedAt: nowIso(),
        },
      },
      teams: { rev: { name: "rev", createdAt: nowIso() } },
    };
    writeFileSync(path, JSON.stringify(seed));
    const s = loadState({ path });
    expect(s.tasks["u1"]?.status).toBe("running");
    expect(s.teams["rev"]?.name).toBe("rev");
  });

  it("backs up and resets on corrupt JSON", () => {
    writeFileSync(path, "{not valid json");
    const s = loadState({ path });
    expect(s).toEqual({ tasks: {}, teams: {}, anchor: null });
    const backups = readdirSync(dir).filter((f) => f.includes(".corrupt-"));
    expect(backups.length).toBeGreaterThan(0);
  });

  it("rejects unknown task status by treating file as corrupt", () => {
    writeFileSync(
      path,
      JSON.stringify({
        tasks: { x: { id: "x", status: "weird", createdAt: "n", updatedAt: "n" } },
        teams: {},
      }),
    );
    const s = loadState({ path });
    expect(s.tasks).toEqual({});
  });
});

describe("saveState", () => {
  it("validates with schema and writes atomically", () => {
    const s: State = {
      tasks: {},
      teams: { x: { name: "x", createdAt: nowIso() } },
    };
    saveState(s, { path });
    const onDisk = JSON.parse(readFileSync(path, "utf8"));
    expect(StateSchema.parse(onDisk).teams["x"]?.name).toBe("x");
  });

  it("rejects malformed state", () => {
    expect(() =>
      // @ts-expect-error testing runtime validation
      saveState({ tasks: { bad: { status: "running" } }, teams: {} }, { path }),
    ).toThrow();
  });
});

describe("withState", () => {
  it("serializes concurrent mutations under a lock", async () => {
    const N = 30;
    saveState({ tasks: {}, teams: {}, anchor: null }, { path });
    let calls = 0;
    await Promise.all(
      Array.from({ length: N }).map(() =>
        withState((s) => {
          calls++;
          const id = `t${Object.keys(s.tasks).length}`;
          s.tasks[id] = {
            id,
            status: "todo",
            createdAt: nowIso(),
            updatedAt: nowIso(),
          };
          return s;
        }, { path, lockRetries: 200 }),
      ),
    );
    expect(calls).toBe(N);
    const final = loadState({ path });
    expect(Object.keys(final.tasks)).toHaveLength(N);
  });

  it("does not write if mutator throws", async () => {
    saveState({ tasks: {}, teams: {}, anchor: null }, { path });
    await expect(
      withState(() => {
        throw new Error("boom");
      }, { path }),
    ).rejects.toThrow("boom");
    const after = loadState({ path });
    expect(after).toEqual({ tasks: {}, teams: {}, anchor: null });
  });

  it("returns result from {state, result} return shape", async () => {
    saveState({ tasks: {}, teams: {}, anchor: null }, { path });
    const out = await withState((s) => {
      const id = "u";
      s.tasks[id] = {
        id,
        status: "todo",
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      return { state: s, result: id };
    }, { path });
    expect(out).toBe("u");
  });
});
