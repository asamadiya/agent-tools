import { z } from "zod";

export const DEFAULT_MODEL_CONFIG = {
  model: "gpt-5.5",
  effort: "xhigh",
  contextWindow: 1_100_000,
} as const;

export const ModelConfigSchema = z.object({
  model: z.string().default(DEFAULT_MODEL_CONFIG.model),
  effort: z.string().default(DEFAULT_MODEL_CONFIG.effort),
  contextWindow: z.number().int().positive().default(DEFAULT_MODEL_CONFIG.contextWindow),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const WorkflowPhaseSchema = z.object({
  title: z.string().min(1),
  detail: z.string().optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
  contextWindow: z.number().int().positive().optional(),
});
export type WorkflowPhase = z.infer<typeof WorkflowPhaseSchema>;

export const WorkflowMetaSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  phases: z.array(WorkflowPhaseSchema).default([]),
  whenToUse: z.string().optional(),
});
export type WorkflowMeta = z.infer<typeof WorkflowMetaSchema>;

export const JsonSchemaSchema: z.ZodType<Record<string, unknown>> = z.record(
  z.string(),
  z.unknown(),
);

export const AgentStepOptionsSchema = z.object({
  label: z.string().min(1).optional(),
  phase: z.string().min(1).optional(),
  schema: JsonSchemaSchema.optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
  contextWindow: z.number().int().positive().optional(),
  systemPrompt: z.string().optional(),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  permissions: z
    .enum(["default", "auto", "plan", "dontAsk", "bypassPermissions"])
    .optional(),
  allowedTools: z.array(z.string()).optional(),
  deniedTools: z.array(z.string()).optional(),
  isolation: z.enum(["none", "worktree"]).default("none"),
});
export type AgentStepOptions = z.infer<typeof AgentStepOptionsSchema>;

export const WorkflowStatusSchema = z.enum([
  "preview",
  "queued",
  "running",
  "completed",
  "failed",
  "stopped",
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const AgentStepStateSchema = z.enum([
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
  "cached",
]);
export type AgentStepState = z.infer<typeof AgentStepStateSchema>;

export const WorkflowProgressEntrySchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("workflow_phase"),
    index: z.number().int().positive(),
    title: z.string().min(1),
    detail: z.string().optional(),
  }),
  z.object({
    type: z.literal("workflow_log"),
    index: z.number().int().nonnegative(),
    message: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("workflow_agent"),
    index: z.number().int().positive(),
    stepId: z.string().min(1),
    label: z.string().min(1),
    phaseIndex: z.number().int().positive().optional(),
    phaseTitle: z.string().optional(),
    agentId: z.string().min(1),
    model: z.string(),
    effort: z.string(),
    contextWindow: z.number().int().positive(),
    state: AgentStepStateSchema,
    queuedAt: z.number().optional(),
    startedAt: z.number().optional(),
    updatedAt: z.number(),
    completedAt: z.number().optional(),
    durationMs: z.number().int().nonnegative().optional(),
    attempt: z.number().int().positive(),
    tokens: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    retries: z.number().int().nonnegative(),
    lastToolName: z.string().optional(),
    lastToolSummary: z.string().optional(),
    resultPreview: z.string().optional(),
    error: z.string().optional(),
    cacheKey: z.string().optional(),
  }),
]);
export type WorkflowProgressEntry = z.infer<typeof WorkflowProgressEntrySchema>;

export const WorkflowRunSchema = z.object({
  runId: z.string().min(1),
  taskId: z.string().min(1),
  workflowName: z.string().min(1),
  status: WorkflowStatusSchema,
  script: z.string(),
  scriptPath: z.string(),
  transcriptDir: z.string(),
  args: z.unknown().optional(),
  resumeFromRunId: z.string().optional(),
  budgetTokens: z.number().int().positive().optional(),
  defaultModel: z.string(),
  defaultEffort: z.string(),
  defaultContextWindow: z.number().int().positive(),
  phases: z.array(WorkflowPhaseSchema),
  workflowProgress: z.array(WorkflowProgressEntrySchema),
  cacheResults: z
    .array(
      z.object({
        cacheKey: z.string(),
        result: z.unknown(),
        progress: WorkflowProgressEntrySchema,
      }),
    )
    .default([]),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  agentCount: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  totalToolCalls: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

export type ProgressReporter = (
  progress: number,
  total?: number,
  message?: string,
) => Promise<void>;

export const noopProgress: ProgressReporter = async () => {};
