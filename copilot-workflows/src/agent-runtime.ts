import { execa } from "execa";
import type { JsonSchema } from "./types.js";

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
}

export interface AgentRunOutput {
  result: unknown;
  text: string;
  tokens: number;
  toolCalls: number;
  retries: number;
  lastToolName?: string;
  lastToolSummary?: string;
  transcript: unknown[];
}

export interface BackendRawOutput {
  text: string;
  tokens?: number;
  toolCalls?: number;
  lastToolName?: string;
  lastToolSummary?: string;
}

export interface AgentBackend {
  run(input: AgentRunInput): Promise<BackendRawOutput>;
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
        transcript: [{ role: "assistant", content: raw.text }],
      };
    }
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
        transcript: [{ role: "assistant", content: raw.text }],
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw new Error(
    `schema validation failed after ${opts.maxRetries + 1} attempt(s): ${lastError?.message ?? "unknown error"}`,
  );
};

export class CopilotPrintBackend implements AgentBackend {
  constructor(private readonly binary = "copilot") {}

  async run(input: AgentRunInput): Promise<BackendRawOutput> {
    const result = await execa(
      this.binary,
      ["--model", input.model, "--effort", input.effort, "-p", input.prompt, "-s"],
      {
        cwd: input.cwd,
        env: input.env ? { ...process.env, ...input.env } : process.env,
        reject: false,
        stripFinalNewline: false,
      },
    );
    if ((result.exitCode ?? 1) !== 0) {
      throw new Error(`copilot agent failed: ${result.stderr || result.stdout}`);
    }
    return { text: result.stdout?.toString() ?? "", tokens: 0, toolCalls: 0 };
  }
}
