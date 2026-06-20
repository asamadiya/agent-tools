import { execa } from "execa";
import type { AgentStepOptions, JsonSchema, RecentToolCall } from "./types.js";

export interface AgentRunInput {
  prompt: string;
  stepId: string;
  agentId: string;
  model: string;
  effort: string;
  contextWindow: number;
  schema?: JsonSchema;
  cwd?: string;
  env?: Record<string, string>;
  systemPrompt?: string;
  permissions?: AgentStepOptions["permissions"];
  allowedTools?: string[];
  deniedTools?: string[];
  isolation?: AgentStepOptions["isolation"];
}

export interface AgentRunOutput {
  result: unknown;
  text: string;
  tokens: number;
  toolCalls: number;
  retries: number;
  lastToolName?: string;
  lastToolSummary?: string;
  recentToolCalls?: RecentToolCall[];
  transcript: unknown[];
}

export interface BackendRawOutput {
  text: string;
  tokens?: number;
  toolCalls?: number;
  lastToolName?: string;
  lastToolSummary?: string;
  recentToolCalls?: RecentToolCall[];
}

export interface AgentBackend {
  run(input: AgentRunInput): Promise<BackendRawOutput>;
}

type JsonObject = Record<string, unknown>;
const HIDDEN_ACTIVITY_TOOLS = new Set(["report_intent"]);

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const summarizeToolArguments = (
  toolName: string,
  args: unknown,
  intentionSummary?: unknown,
): string | undefined => {
  if (!isObject(args)) {
    return typeof intentionSummary === "string" ? intentionSummary : undefined;
  }
  const candidates =
    toolName === "bash"
      ? [args.command, args.description, intentionSummary]
      : [args.path, args.file_path, args.filename, args.description, intentionSummary];
  const value = candidates.find((candidate) => typeof candidate === "string" && candidate.trim());
  if (typeof value === "string") return value;
  const json = JSON.stringify(args);
  return json === "{}" ? undefined : json;
};

export const parseCopilotJsonOutput = (stdout: string): BackendRawOutput => {
  let tokens = 0;
  let finalText = "";
  let lastDeltaMessageId: string | undefined;
  const deltas = new Map<string, string>();
  const toolRequests = new Map<
    string,
    { name?: string; arguments?: unknown; intentionSummary?: unknown }
  >();
  const recentToolCalls: RecentToolCall[] = [];
  let parsedEvents = 0;
  let firstParseError: Error | undefined;

  const lines = stdout.split(/\r?\n/).filter((line) => line.trim());
  for (const [index, line] of lines.entries()) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch (err) {
      firstParseError ??= new Error(
        `copilot JSON output parse failed on line ${index + 1}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      continue;
    }
    parsedEvents += 1;
    if (!isObject(event) || typeof event.type !== "string") continue;
    const data = isObject(event.data) ? event.data : {};

    if (event.type === "assistant.message") {
      if (typeof data.outputTokens === "number" && Number.isFinite(data.outputTokens)) {
        tokens += data.outputTokens;
      }
      if (typeof data.content === "string" && data.content.length > 0) {
        finalText = data.content;
      }
      if (Array.isArray(data.toolRequests)) {
        for (const request of data.toolRequests) {
          if (!isObject(request) || typeof request.toolCallId !== "string") continue;
          toolRequests.set(request.toolCallId, {
            name: typeof request.name === "string" ? request.name : undefined,
            arguments: request.arguments,
            intentionSummary: request.intentionSummary,
          });
        }
      }
    } else if (event.type === "assistant.message_delta") {
      if (typeof data.messageId === "string" && typeof data.deltaContent === "string") {
        deltas.set(data.messageId, `${deltas.get(data.messageId) ?? ""}${data.deltaContent}`);
        lastDeltaMessageId = data.messageId;
      }
    } else if (event.type === "tool.execution_start") {
      const toolCallId = typeof data.toolCallId === "string" ? data.toolCallId : undefined;
      const request = toolCallId ? toolRequests.get(toolCallId) : undefined;
      const name =
        (typeof data.toolName === "string" && data.toolName) ||
        request?.name ||
        "tool";
      if (HIDDEN_ACTIVITY_TOOLS.has(name)) continue;
      const summary = summarizeToolArguments(
        name,
        data.arguments ?? request?.arguments,
        request?.intentionSummary,
      );
      recentToolCalls.push({
        name,
        ...(summary ? { summary } : {}),
      });
    }
  }
  if (parsedEvents === 0 && firstParseError) throw firstParseError;

  if (!finalText && lastDeltaMessageId) {
    finalText = deltas.get(lastDeltaMessageId) ?? "";
  }
  const lastTool = recentToolCalls.at(-1);
  return {
    text: finalText,
    tokens,
    toolCalls: recentToolCalls.length,
    ...(lastTool ? { lastToolName: lastTool.name } : {}),
    ...(lastTool?.summary ? { lastToolSummary: lastTool.summary } : {}),
    ...(recentToolCalls.length ? { recentToolCalls: recentToolCalls.slice(-3) } : {}),
  };
};

// Thrown when structured-output schema validation fails after all retries.
// Carries the malformed attempts so the failed agent's transcript can persist.
export class SchemaRetryError extends Error {
  readonly transcript: unknown[];

  constructor(message: string, transcript: unknown[]) {
    super(message);
    this.name = "SchemaRetryError";
    this.transcript = transcript;
  }
}

export class StubAgentBackend implements AgentBackend {
  private index = 0;

  constructor(private readonly outputs: BackendRawOutput[]) {}

  async run(): Promise<BackendRawOutput> {
    const out = this.outputs[this.index];
    this.index += 1;
    if (!out) throw new Error("StubAgentBackend: no output queued");
    return out;
  }
}

const typeName = (v: unknown): string => (Array.isArray(v) ? "array" : typeof v);

export const validateJsonSchemaResult = (result: unknown, schema: JsonSchema): unknown => {
  if (schema.type === "object") {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error(`schema validation failed: expected object, got ${typeName(result)}`);
    }
    const obj = result as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (typeof key === "string" && !(key in obj)) {
        throw new Error(`schema validation failed: missing required property ${key}`);
      }
    }
    const props =
      schema.properties && typeof schema.properties === "object"
        ? (schema.properties as Record<string, Record<string, unknown>>)
        : {};
    for (const [key, prop] of Object.entries(props)) {
      if (!(key in obj)) continue;
      if (prop.type && typeName(obj[key]) !== prop.type) {
        throw new Error(
          `schema validation failed: property ${key} expected ${prop.type}, got ${typeName(obj[key])}`,
        );
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in props)) throw new Error(`schema validation failed: additional property ${key}`);
      }
    }
  }
  return result;
};

export const runAgentWithSchemaRetry = async (
  input: AgentRunInput,
  backend: AgentBackend,
  opts: { maxRetries: number },
): Promise<AgentRunOutput> => {
  let lastError: Error | null = null;
  const attempts: unknown[] = [];
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    const raw = await backend.run(input);
    if (!input.schema) {
      return {
        result: raw.text,
        text: raw.text,
        tokens: raw.tokens ?? 0,
        toolCalls: raw.toolCalls ?? 0,
        retries: attempt,
        ...(raw.lastToolName ? { lastToolName: raw.lastToolName } : {}),
        ...(raw.lastToolSummary ? { lastToolSummary: raw.lastToolSummary } : {}),
        ...(raw.recentToolCalls ? { recentToolCalls: raw.recentToolCalls } : {}),
        transcript: [{ role: "assistant", content: raw.text }],
      };
    }
    attempts.push({ role: "assistant", content: raw.text, attempt: attempt + 1 });
    try {
      const parsed = JSON.parse(raw.text) as unknown;
      const result = validateJsonSchemaResult(parsed, input.schema);
      return {
        result,
        text: raw.text,
        tokens: raw.tokens ?? 0,
        toolCalls: raw.toolCalls ?? 0,
        retries: attempt,
        lastToolName: raw.lastToolName ?? "StructuredOutput",
        lastToolSummary: raw.lastToolSummary ?? raw.text.slice(0, 120),
        ...(raw.recentToolCalls ? { recentToolCalls: raw.recentToolCalls } : {}),
        transcript: [{ role: "assistant", content: raw.text }],
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw new SchemaRetryError(
    `schema validation failed after ${opts.maxRetries + 1} attempt(s): ${lastError?.message ?? "unknown error"}`,
    attempts,
  );
};

// Maps the workflow `permissions` option to a copilot CLI `--mode` value.
// The copilot CLI only supports interactive|plan|autopilot, so values that have
// no safe equivalent hard-fail instead of forwarding an invalid flag. Returns
// undefined to mean "omit --mode" (copilot defaults to interactive).
export const mapPermissionsToMode = (
  permissions: AgentStepOptions["permissions"] | undefined,
): string | undefined => {
  switch (permissions) {
    case undefined:
    case "default":
      return undefined;
    case "auto":
      return "autopilot";
    case "plan":
      return "plan";
    default:
      throw new Error(
        `CopilotPrintBackend does not support permissions:'${permissions}'; ` +
          `copilot --mode only supports interactive|plan|autopilot (use default, auto, or plan)`,
      );
  }
};

export class CopilotPrintBackend implements AgentBackend {
  constructor(private readonly binary = "copilot") {}

  buildArgs(input: AgentRunInput): string[] {
    if (input.systemPrompt) {
      throw new Error("CopilotPrintBackend does not support systemPrompt yet");
    }
    if (input.isolation === "worktree") {
      throw new Error("CopilotPrintBackend does not support isolation:'worktree' yet");
    }
    const args = ["--model", input.model, "--effort", input.effort, "--output-format", "json"];
    const mode = mapPermissionsToMode(input.permissions);
    if (mode) args.push("--mode", mode);
    for (const tool of input.allowedTools ?? []) args.push(`--allow-tool=${tool}`);
    for (const tool of input.deniedTools ?? []) args.push(`--deny-tool=${tool}`);
    args.push("-p", input.prompt);
    return args;
  }

  async run(input: AgentRunInput): Promise<BackendRawOutput> {
    const result = await execa(this.binary, this.buildArgs(input), {
      cwd: input.cwd,
      env: input.env ? { ...process.env, ...input.env } : process.env,
      reject: false,
      stripFinalNewline: false,
    });
    if ((result.exitCode ?? 1) !== 0) {
      throw new Error(`copilot agent failed: ${result.stderr || result.stdout}`);
    }
    return parseCopilotJsonOutput(result.stdout?.toString() ?? "");
  }
}
