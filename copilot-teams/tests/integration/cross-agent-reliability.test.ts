/**
 * Cross-agent + reliability scenarios (S19-S22).
 *
 * Pins real-world failure modes the user has hit in production but which
 * the original 18-scenario suite did not cover:
 *
 *   S19 worker → worker SendMessage resolves to the correct sibling uuid
 *       (a child copilot session addressing another sibling without
 *       re-spawning it).
 *   S20 SendMessage resolves the right uuid even after the task has been
 *       idle for >30s (stale updatedAt timestamps).
 *   S21 Stress: 20 sequential + 20 parallel SendMessages all land in
 *       events.jsonl with no drops; uuid lock serializes the parallel set.
 *   S22 Pane buffer audit: after SendMessage, the literal message text is
 *       not still waiting at the input prompt (i.e. Enter actually fired).
 *
 * Conventions match `se-team-scenarios.test.ts`: ephemeral tmux session
 * `ct-se-<pid>-<short-uuid>`, isolated statePath/sessionRoot, stub-copilot
 * binary. Tests never touch any tmux session not created here.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execa } from "execa";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { handleAgent } from "../../src/tools/agent.js";
import { handleSendMessage } from "../../src/tools/send-message.js";
import { loadState } from "../../src/state.js";
import { capturePane, tmuxAvailable } from "../../src/tmux.js";

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
}

const setupCtx = async (): Promise<Ctx> => {
  const session = `ct-se-${process.pid}-${randomUUID().slice(0, 8)}`;
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
  if (!process.env.TMUX) process.env.TMUX = "/tmp/fake-tmux,0,0";
  return { session, parentPane, parentWindowId, dir, statePath, stubDir, sessionRoot };
};

const teardownCtx = async (ctx: Ctx | null): Promise<void> => {
  if (!ctx) return;
  await execa("tmux", ["kill-session", "-t", ctx.session], { reject: false });
  rmSync(ctx.dir, { recursive: true, force: true });
  rmSync(ctx.stubDir, { recursive: true, force: true });
  rmSync(ctx.sessionRoot, { recursive: true, force: true });
  delete process.env.TMUX_PANE;
  delete process.env.TMUX_SESSION;
};

const stdDeps = (ctx: Ctx) => ({
  cwd: process.cwd(),
  binary: STUB,
  statePath: ctx.statePath,
  sessionRoot: ctx.sessionRoot,
  env: {
    COPILOT_SESSION_ROOT: ctx.sessionRoot,
    STUB_COPILOT_DIR: ctx.stubDir,
  },
});

const sendDeps = (ctx: Ctx) => ({
  binary: STUB,
  statePath: ctx.statePath,
  sessionRoot: ctx.sessionRoot,
});

const countAssistantMessages = (eventsPath: string, content: string): number => {
  if (!existsSync(eventsPath)) return 0;
  const raw = readFileSync(eventsPath, "utf8");
  let count = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as {
        type: string;
        data: { content?: string };
      };
      if (
        e.type === "assistant.message" &&
        typeof e.data?.content === "string" &&
        e.data.content === content
      ) {
        count += 1;
      }
    } catch {
      /* ignore */
    }
  }
  return count;
};

const collectAssistantMessages = (eventsPath: string): string[] => {
  if (!existsSync(eventsPath)) return [];
  const out: string[] = [];
  for (const line of readFileSync(eventsPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as {
        type: string;
        data: { content?: string };
      };
      if (e.type === "assistant.message" && typeof e.data?.content === "string") {
        out.push(e.data.content);
      }
    } catch {
      /* ignore */
    }
  }
  return out;
};

describe.skipIf(!have)("Cross-agent + reliability scenarios", () => {
  let ctx: Ctx | null = null;
  beforeEach(async () => {
    ctx = await setupCtx();
  });
  afterEach(async () => {
    await teardownCtx(ctx);
    ctx = null;
  });

  it("S19 — worker→worker SendMessage resolves the live sibling, no respawn", async () => {
    const c = ctx!;
    // Spawn two siblings (e.g. tpm and ci-chaser). Both written into the
    // shared state.json. A child MCP server (running in tpm's session) would
    // load THIS SAME state.json and call handleSendMessage to address
    // ci-chaser. We simulate that by making a second handleSendMessage call
    // against the same statePath/sessionRoot — the deps look identical to
    // both parent-MCP and child-MCP, which is exactly the contract.
    const tpm = await handleAgent(
      { description: "tpm", name: "tpm", run_in_background: true },
      stdDeps(c),
    );
    const ciChaser = await handleAgent(
      { description: "ci-chaser", name: "ci-chaser", run_in_background: true },
      stdDeps(c),
    );

    // Snapshot state task count BEFORE the worker→worker call. If the
    // resolver respawns instead of resolving, the count grows.
    const beforeTaskCount = Object.keys(loadState({ path: c.statePath }).tasks).length;
    expect(beforeTaskCount).toBe(2);

    // Worker (tpm) addresses sibling (ci-chaser) by name. Same deps a child
    // MCP would have: same statePath + sessionRoot.
    const r = await handleSendMessage(
      { to: "ci-chaser", message: "say WORKER_TO_WORKER" },
      sendDeps(c),
    );

    // Must resolve to the LIVE ci-chaser uuid, not tpm, not a brand-new spawn.
    expect(r.id).toBe(ciChaser.id);
    expect(r.id).not.toBe(tpm.id);
    expect(r.via).toBe("send-keys");
    expect(r.output).toBe("WORKER_TO_WORKER");

    // No new tasks created.
    const afterTaskCount = Object.keys(loadState({ path: c.statePath }).tasks).length;
    expect(afterTaskCount).toBe(beforeTaskCount);

    // tpm's events.jsonl must NOT have received the user message.
    const tpmEvents = join(c.sessionRoot, tpm.id, "events.jsonl");
    if (existsSync(tpmEvents)) {
      const ev = readFileSync(tpmEvents, "utf8");
      expect(ev).not.toContain("WORKER_TO_WORKER");
    }
    // ci-chaser's events.jsonl SHOULD contain it.
    const ciEvents = join(c.sessionRoot, ciChaser.id, "events.jsonl");
    expect(existsSync(ciEvents)).toBe(true);
    expect(readFileSync(ciEvents, "utf8")).toContain("WORKER_TO_WORKER");
  }, 15_000);

  it("S20 — find-by-name after extended idle resolves the live pane", async () => {
    const c = ctx!;
    // Spawn the agent fresh, then rewrite state.json so its updatedAt looks
    // like the spawn happened 60s ago (simulating idle without sleeping).
    // Resolver must still pick this entry — it's the only one and it's live.
    const a = await handleAgent(
      {
        description: "tpm",
        name: "tpm",
        prompt: "say boot",
        run_in_background: true,
        wait_first_turn_ms: 5000,
      },
      stdDeps(c),
    );
    const ciChaser = await handleAgent(
      {
        description: "ci-chaser",
        name: "ci-chaser",
        prompt: "say boot",
        run_in_background: true,
        wait_first_turn_ms: 5000,
      },
      stdDeps(c),
    );

    // Push every task's updatedAt into the past by 60s. This mirrors what
    // happens to a long-running agent that nobody's spoken to in a while —
    // the resolver should NOT use age as a disqualifier; it should still
    // pick the live, running entry.
    const past = new Date(Date.now() - 60_000).toISOString();
    const st = loadState({ path: c.statePath });
    for (const id of Object.keys(st.tasks)) {
      st.tasks[id]!.updatedAt = past;
    }
    writeFileSync(c.statePath, JSON.stringify(st, null, 2));

    // Now SendMessage by name ci-chaser. Must resolve to ciChaser.id.
    const r = await handleSendMessage(
      { to: "ci-chaser", message: "say AFTER_IDLE" },
      sendDeps(c),
    );
    expect(r.id).toBe(ciChaser.id);
    expect(r.id).not.toBe(a.id);
    expect(r.via).toBe("send-keys");
    expect(r.output).toBe("AFTER_IDLE");
  }, 15_000);

  it("S21a — 20 sequential SendMessages: every payload lands in events.jsonl in order", async () => {
    const c = ctx!;
    const a = await handleAgent(
      {
        description: "stress",
        name: "stress",
        prompt: "say boot",
        run_in_background: true,
        wait_first_turn_ms: 5000,
      },
      stdDeps(c),
    );

    const N = 20;
    const payloads = Array.from({ length: N }, (_, i) => `SEQ_${i.toString().padStart(2, "0")}`);
    for (const p of payloads) {
      const r = await handleSendMessage(
        { to: "stress", message: `say ${p}`, timeout_ms: 8000 },
        sendDeps(c),
      );
      expect(r.output).toBe(p);
      expect(r.via).toBe("send-keys");
    }

    // Every payload must appear in events.jsonl as an assistant.message,
    // in order. Each payload must appear exactly once (no drops, no dupes
    // beyond the boot turn).
    const events = join(c.sessionRoot, a.id, "events.jsonl");
    const replies = collectAssistantMessages(events);
    // Drop the first reply (the spawn-prompt "boot").
    const stripped = replies.filter((r) => r !== "boot");
    expect(stripped).toEqual(payloads);
  }, 30_000);

  it("S21b — 20 parallel SendMessages: uuid lock serializes; all 20 land", async () => {
    const c = ctx!;
    const a = await handleAgent(
      {
        description: "para",
        name: "para",
        prompt: "say boot",
        run_in_background: true,
        wait_first_turn_ms: 5000,
      },
      stdDeps(c),
    );

    const N = 20;
    const payloads = Array.from({ length: N }, (_, i) => `PAR_${i.toString().padStart(2, "0")}`);
    const results = await Promise.all(
      payloads.map((p) =>
        handleSendMessage(
          { to: "para", message: `say ${p}`, timeout_ms: 15_000 },
          sendDeps(c),
        ),
      ),
    );

    // Every send must have produced its own reply.
    expect(results.length).toBe(N);
    expect(new Set(results.map((r) => r.output))).toEqual(new Set(payloads));
    // turnIds must be unique and form a permutation of [1..N].
    const turnIds = results.map((r) => Number(r.turnId)).sort((a, b) => a - b);
    expect(new Set(turnIds).size).toBe(N);
    expect(turnIds).toEqual(Array.from({ length: N }, (_, i) => i + 1));

    // events.jsonl must contain each payload exactly once.
    const events = join(c.sessionRoot, a.id, "events.jsonl");
    for (const p of payloads) {
      expect(countAssistantMessages(events, p)).toBe(1);
    }
  }, 60_000);

  it("S22 — pane buffer audit: literal sent message is not stuck at the prompt", async () => {
    const c = ctx!;
    const a = await handleAgent(
      {
        description: "audit",
        name: "audit",
        prompt: "say boot",
        run_in_background: true,
        wait_first_turn_ms: 5000,
      },
      stdDeps(c),
    );

    // For each of N distinct payloads, send and then capture the pane.
    // After the turn settles, the literal "say HELLO_<i>" must NOT appear
    // as an unsubmitted prompt. Since the stub echoes the payload as the
    // assistant reply, the payload itself WILL appear in pane history (as
    // both the user-line echo AND the assistant reply). What we assert is
    // narrower: there is no LAST line of the pane buffer that is exactly
    // the literal "say HELLO_<i>" sitting un-submitted (no Enter fired).
    //
    // This is the canonical symptom the user reported: "messages sometimes
    // sit there on the prompt, not sent to the agent". If sendLine somehow
    // skipped the trailing Enter, capture-pane would show the input line
    // verbatim at the end of the buffer.
    const N = 5;
    for (let i = 0; i < N; i++) {
      const payload = `HELLO_${i}`;
      const r = await handleSendMessage(
        { to: "audit", message: `say ${payload}`, timeout_ms: 8000 },
        sendDeps(c),
      );
      expect(r.output).toBe(payload);
      // Capture pane after the turn settles.
      const buf = await capturePane(a.tmuxTarget!, { joinWrapped: true });
      const lines = buf.split("\n").map((l) => l.replace(/\s+$/, ""));
      // Drop trailing empty lines.
      while (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }
      // The last non-empty line MUST NOT be exactly "say <payload>" — that
      // would mean the input was typed but Enter never fired.
      const last = lines[lines.length - 1] ?? "";
      expect(last).not.toBe(`say ${payload}`);
      // Belt + suspenders: nor should ANY line be exactly the literal input
      // text and ALSO be the last line (some prompts wrap the cursor; we
      // just want to ensure submission completed). If the stub's echo of
      // the assistant reply is the last visible line, that's fine — it
      // proves a turn was processed.
    }
  }, 30_000);
});
