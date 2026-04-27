import { z } from "zod";
import { isUuid, runForeground } from "../copilot.js";
import { loadState, nowIso, withState, type State } from "../state.js";
import { sendLine } from "../tmux.js";
import { awaitTurnEnd, sessionLiveness } from "../session-state.js";
import { withUuidLock } from "../uuid-lock.js";
import { logger } from "../logger.js";
import { type ProgressReporter, noopProgress } from "../progress.js";

export const SendMessageInputSchema = z.object({
  to: z.string().min(1),
  message: z.string().min(1),
  /** Force subprocess mode (always use copilot --resume=<uuid> -p, even if
   *  the target has a live pane). Required for per-turn config overrides
   *  since the REPL's model/tools are fixed at spawn. */
  subprocess: z.boolean().optional(),
  /** Override model just for this turn (forces subprocess mode). */
  model: z.string().optional(),
  /** Override mode just for this turn (forces subprocess mode). */
  mode: z.string().optional(),
  /** Allowed-tools override (forces subprocess mode). */
  allowed_tools: z.array(z.string()).optional(),
  /** Denied-tools override (forces subprocess mode). */
  denied_tools: z.array(z.string()).optional(),
  /** Max ms to wait for the resulting assistant.turn_end. Default 5 minutes. */
  timeout_ms: z.number().int().positive().optional(),
});

export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;

export interface SendMessageOutput {
  id: string;
  output: string;
  turnId?: string;
  via: "send-keys" | "subprocess";
  durationMs: number;
}

export interface SendMessageDeps {
  binary?: string;
  cwd?: string;
  statePath?: string;
  sessionRoot?: string;
}

const findTaskId = (s: State, to: string): string | null => {
  if (s.tasks[to]) return to;
  for (const [id, t] of Object.entries(s.tasks)) {
    if (t.name === to) return id;
  }
  return null;
};

export const handleSendMessage = async (
  raw: unknown,
  deps: SendMessageDeps,
  progress: ProgressReporter = noopProgress,
): Promise<SendMessageOutput> => {
  const input = SendMessageInputSchema.parse(raw);
  const stateOpts = deps.statePath ? { path: deps.statePath } : {};
  const s = loadState(stateOpts);
  const id = findTaskId(s, input.to);
  if (!id) {
    throw new Error(`SendMessage: no task addressable as ${JSON.stringify(input.to)}`);
  }
  if (!isUuid(id)) {
    throw new Error(`SendMessage: resolved id ${id} is not a uuid`);
  }
  const t = s.tasks[id]!;

  const overrideRequested =
    Boolean(input.subprocess) ||
    typeof input.model === "string" ||
    typeof input.mode === "string" ||
    (input.allowed_tools && input.allowed_tools.length > 0) ||
    (input.denied_tools && input.denied_tools.length > 0);
  const haveLivePane = Boolean(t.tmuxTarget) && t.status === "running";
  const via: "send-keys" | "subprocess" = haveLivePane && !overrideRequested ? "send-keys" : "subprocess";

  const start = Date.now();

  const result = await withUuidLock(id, async () => {
    await progress(1, undefined, "uuid lock acquired");
    if (via === "send-keys") {
      const sessionRoot = deps.sessionRoot;
      const baselineCount = sessionLiveness(id, sessionRoot).turnCount;
      await sendLine(t.tmuxTarget!, input.message);
      await progress(2, undefined, "message sent into pane; awaiting turn_end");
      const r = await awaitTurnEnd(id, {
        baselineTurnCount: baselineCount,
        timeoutMs: input.timeout_ms ?? 5 * 60_000,
        ...(sessionRoot ? { root: sessionRoot } : {}),
      });
      await progress(3, undefined, `turn ${r.turnId} ended`);
      return { content: r.content, turnId: r.turnId };
    }
    const fr = await runForeground({
      uuid: id,
      prompt: input.message,
      background: false,
      binary: deps.binary ?? "copilot",
      ...(deps.cwd ? { cwd: deps.cwd } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.allowed_tools ? { allowedTools: input.allowed_tools } : {}),
      ...(input.denied_tools ? { deniedTools: input.denied_tools } : {}),
    });
    return { content: fr.stdout, turnId: undefined };
  });

  await withState((cur) => {
    const c = cur.tasks[id];
    if (c) cur.tasks[id] = { ...c, updatedAt: nowIso() };
    return cur;
  }, stateOpts);

  logger.info(
    { event: "send-message", id, via, ms: Date.now() - start, turnId: result.turnId },
    "send-message complete",
  );

  return {
    id,
    output: result.content,
    ...(result.turnId ? { turnId: result.turnId } : {}),
    via,
    durationMs: Date.now() - start,
  };
};
