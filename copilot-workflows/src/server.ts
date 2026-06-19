#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { AgentBackend } from "./agent-runtime.js";
import { logger } from "./logger.js";
import {
  WorkflowInputSchema,
  WorkflowInspectInputSchema,
  WorkflowListInputSchema,
  WorkflowRunIdSchema,
  WorkflowSaveInputSchema,
  handleWorkflow,
  handleWorkflowInspect,
  handleWorkflowList,
  handleWorkflowOutput,
  handleWorkflowSave,
  handleWorkflowStatus,
  handleWorkflowStop,
} from "./tools.js";
import type { ProgressReporter } from "./types.js";
import { noopProgress } from "./types.js";

const json = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });

type Extra = any;

const makeProgressReporter = (extra: Extra): ProgressReporter => {
  const token = extra?._meta?.progressToken;
  const send = extra?.sendNotification;
  if (token === undefined || typeof send !== "function") return noopProgress;
  return async (progress, total, message) => {
    await send({
      method: "notifications/progress",
      params: {
        progressToken: token,
        progress,
        ...(typeof total === "number" ? { total } : {}),
        ...(message ? { message } : {}),
      },
    });
  };
};

export const buildServer = (deps: { root?: string; backend?: AgentBackend } = {}): McpServer => {
  const server = new McpServer(
    { name: "copilot-workflows", version: "0.1.0" },
    { capabilities: { tools: {}, logging: {} } },
  );
  const wrap = <T,>(name: string, fn: (args: unknown, extra: Extra) => Promise<T> | T) =>
    async (args: unknown, extra: Extra = {}) => {
      try {
        const progress = makeProgressReporter(extra);
        const out = await fn(args, { ...extra, progress });
        return json(out);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err, name }, "workflow tool failed");
        return { content: [{ type: "text" as const, text: `error: ${message}` }], isError: true };
      }
    };

  server.registerTool("Workflow", {
    description: "Run a dynamic workflow. Pass goal (e.g. 'workflow: <goal>') to auto-generate a script, or provide an explicit JS script.",
    inputSchema: WorkflowInputSchema.shape,
  }, wrap("Workflow", (raw, extra) => handleWorkflow(raw, { ...deps, progress: extra.progress })));

  server.registerTool("WorkflowStatus", {
    description: "Return live progress for a workflow run.",
    inputSchema: WorkflowRunIdSchema.shape,
  }, wrap("WorkflowStatus", (raw) => handleWorkflowStatus(raw, deps)));

  server.registerTool("WorkflowOutput", {
    description: "Return workflow result, journal, and transcript references.",
    inputSchema: WorkflowRunIdSchema.shape,
  }, wrap("WorkflowOutput", (raw) => handleWorkflowOutput(raw, deps)));

  server.registerTool("WorkflowStop", {
    description: "Stop a queued or running workflow.",
    inputSchema: WorkflowRunIdSchema.shape,
  }, wrap("WorkflowStop", (raw) => handleWorkflowStop(raw, deps)));

  server.registerTool("WorkflowInspect", {
    description: "Parse and validate a workflow JS script without running it.",
    inputSchema: WorkflowInspectInputSchema.shape,
  }, wrap("WorkflowInspect", (raw) => handleWorkflowInspect(raw)));

  server.registerTool("WorkflowList", {
    description: "List workflow runs by status/name/time from persisted workflow state.",
    inputSchema: WorkflowListInputSchema.shape,
  }, wrap("WorkflowList", (raw) => handleWorkflowList(raw, deps)));

  server.registerTool("WorkflowSave", {
    description: "Validate and persist a generated workflow script without running it.",
    inputSchema: WorkflowSaveInputSchema.shape,
  }, wrap("WorkflowSave", (raw) => handleWorkflowSave(raw, deps)));

  return server;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
