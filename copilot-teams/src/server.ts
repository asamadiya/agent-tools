#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { logger, newCorrelationId } from "./logger.js";
import {
  AgentInputSchema,
  handleAgent,
} from "./tools/agent.js";
import {
  SendMessageInputSchema,
  handleSendMessage,
} from "./tools/send-message.js";
import {
  GetTranscriptInputSchema,
  TaskCreateInputSchema,
  TaskGetInputSchema,
  TaskListInputSchema,
  TaskOutputInputSchema,
  TaskStopInputSchema,
  TaskUpdateInputSchema,
  handleGetTranscript,
  handleTaskCreate,
  handleTaskGet,
  handleTaskList,
  handleTaskOutput,
  handleTaskStop,
  handleTaskUpdate,
} from "./tools/tasks.js";
import {
  TeamCreateInputSchema,
  TeamDeleteInputSchema,
  handleTeamCreate,
  handleTeamDelete,
} from "./tools/teams.js";
import {
  AttachInputSchema,
  WhoOwnsInputSchema,
  handleAttach,
  handleWhoOwns,
} from "./tools/attach.js";
import { StatusInputSchema, handleStatus } from "./tools/status.js";
import {
  PaneBreakInputSchema,
  PaneFocusInputSchema,
  PaneJoinInputSchema,
  PaneResizeInputSchema,
  PaneSwapInputSchema,
  handlePaneBreak,
  handlePaneFocus,
  handlePaneJoin,
  handlePaneResize,
  handlePaneSwap,
} from "./tools/panes.js";
import {
  GcInputSchema,
  PauseInputSchema,
  RestartInputSchema,
  ResumeInputSchema,
  SendToTeamInputSchema,
  handleGc,
  handlePause,
  handleRestart,
  handleResume,
  handleSendToTeam,
} from "./tools/lifecycle.js";

const VERSION = "0.1.0";

const json = (v: unknown): { content: { type: "text"; text: string }[] } => ({
  content: [{ type: "text", text: JSON.stringify(v, null, 2) }],
});

import { type ProgressReporter, noopProgress } from "./progress.js";

// Loosely typed; the MCP SDK's RequestHandlerExtra is intentionally
// over-narrow for our needs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Extra = any;

const makeProgressReporter = (extra: Extra): ProgressReporter => {
  const token = extra?._meta?.progressToken;
  const send = extra?.sendNotification;
  if (token === undefined || typeof send !== "function") return noopProgress;
  return async (progress, total, message) => {
    try {
      await send({
        method: "notifications/progress",
        params: {
          progressToken: token,
          progress,
          ...(typeof total === "number" ? { total } : {}),
          ...(message ? { message } : {}),
        },
      });
    } catch {
      // Best-effort; never let a notification failure abort the tool.
    }
  };
};

type ToolFn<T> = (raw: unknown, progress: ProgressReporter) => Promise<T>;

const wrap =
  <T,>(name: string, fn: ToolFn<T>) =>
  async (args: unknown, extra: Extra = {}) => {
    const cid = newCorrelationId();
    logger.info({ event: "tool.call", name, cid, args }, "tool invoked");
    const progress = makeProgressReporter(extra ?? {});
    try {
      const out = await fn(args, progress);
      logger.info({ event: "tool.ok", name, cid }, "tool ok");
      return json(out);
    } catch (err) {
      logger.error({ event: "tool.err", name, cid, err }, "tool failed");
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `error: ${message}` }],
        isError: true,
      };
    }
  };

const buildServer = (
  deps: {
    cwd?: string;
    binary?: string;
    statePath?: string;
    sessionRoot?: string;
    env?: Record<string, string>;
  } = {},
): McpServer => {
  const server = new McpServer(
    { name: "copilot-teams", version: VERSION },
    { capabilities: { tools: {}, logging: {} } },
  );

  const cwd = deps.cwd ?? process.cwd();
  const taskDeps = {
    ...(deps.statePath ? { statePath: deps.statePath } : {}),
    ...(deps.sessionRoot ? { sessionRoot: deps.sessionRoot } : {}),
  };
  const agentDeps = {
    cwd,
    ...(deps.binary ? { binary: deps.binary } : {}),
    ...(deps.statePath ? { statePath: deps.statePath } : {}),
    ...(deps.sessionRoot ? { sessionRoot: deps.sessionRoot } : {}),
    ...(deps.env ? { env: deps.env } : {}),
  };
  const sendDeps = {
    cwd,
    ...(deps.binary ? { binary: deps.binary } : {}),
    ...(deps.statePath ? { statePath: deps.statePath } : {}),
    ...(deps.sessionRoot ? { sessionRoot: deps.sessionRoot } : {}),
  };

  server.registerTool(
    "Agent",
    {
      description:
        "Spawn a sub-Copilot. Foreground returns its stdout; run_in_background:true puts it in a tmux window named cop:<name|short-uuid>. Optional team_name groups it; isolation:'worktree' runs it in a detached git worktree.",
      inputSchema: AgentInputSchema.shape,
    },
    wrap("Agent", (raw, progress) => handleAgent(raw, agentDeps, progress)),
  );

  server.registerTool(
    "SendMessage",
    {
      description:
        "Send a follow-up message to a previously spawned agent (by name or uuid). Resumes the same Copilot session via --resume=<uuid> so prior context is preserved.",
      inputSchema: SendMessageInputSchema.shape,
    },
    wrap("SendMessage", (raw, progress) => handleSendMessage(raw, sendDeps, progress)),
  );

  server.registerTool(
    "TaskList",
    {
      description:
        "List tasks. Reconciles running agents against tmux+pid liveness before returning. Filter by status or team_name.",
      inputSchema: TaskListInputSchema.shape,
    },
    wrap("TaskList", (raw) => handleTaskList(raw, taskDeps)),
  );

  server.registerTool(
    "TaskGet",
    {
      description: "Fetch a single task by id (uuid).",
      inputSchema: TaskGetInputSchema.shape,
    },
    wrap("TaskGet", (raw) => handleTaskGet(raw, taskDeps)),
  );

  server.registerTool(
    "TaskOutput",
    {
      description:
        "Get a running agent's tmux scrollback or an exited agent's log file. Optional tail_bytes truncates the head.",
      inputSchema: TaskOutputInputSchema.shape,
    },
    wrap("TaskOutput", (raw) => handleTaskOutput(raw, taskDeps)),
  );

  server.registerTool(
    "TaskStop",
    {
      description:
        "Stop a running agent: kill its tmux window and SIGTERM its pid, then mark stopped.",
      inputSchema: TaskStopInputSchema.shape,
    },
    wrap("TaskStop", (raw) => handleTaskStop(raw, taskDeps)),
  );

  server.registerTool(
    "TaskCreate",
    {
      description:
        "Create a plain todo (status: todo / in_progress / completed). Not a sub-Copilot — purely a tracking record.",
      inputSchema: TaskCreateInputSchema.shape,
    },
    wrap("TaskCreate", (raw) => handleTaskCreate(raw, taskDeps)),
  );

  server.registerTool(
    "TaskUpdate",
    {
      description: "Update a task's status or content. Fails if id unknown.",
      inputSchema: TaskUpdateInputSchema.shape,
    },
    wrap("TaskUpdate", (raw) => handleTaskUpdate(raw, taskDeps)),
  );

  server.registerTool(
    "TeamCreate",
    {
      description: "Create a team (idempotent).",
      inputSchema: TeamCreateInputSchema.shape,
    },
    wrap("TeamCreate", (raw) => handleTeamCreate(raw, taskDeps)),
  );

  server.registerTool(
    "TeamDelete",
    {
      description:
        "Delete a team. Refuses if any member is running unless force:true is passed (then stops them first).",
      inputSchema: TeamDeleteInputSchema.shape,
    },
    wrap("TeamDelete", (raw) => handleTeamDelete(raw, taskDeps)),
  );

  server.registerTool(
    "Status",
    {
      description:
        "Deep liveness check: pane existence + current_command + session-state events.jsonl analysis. Returns whether the agent is ready for SendMessage.",
      inputSchema: StatusInputSchema.shape,
    },
    wrap("Status", (raw) => handleStatus(raw, taskDeps)),
  );

  server.registerTool(
    "Attach",
    {
      description:
        "Open the agent's tmux pane. mode: 'switch' (default) brings the pane to current client; 'split'/'join' moves the pane into the current window; 'info' returns the tmux commands without executing.",
      inputSchema: AttachInputSchema.shape,
    },
    wrap("Attach", (raw) => handleAttach(raw, taskDeps)),
  );

  server.registerTool(
    "WhoOwns",
    {
      description:
        "Reverse lookup. Given any one of pane id, uuid, name, or tmux_target, return the owning task record (or null).",
      inputSchema: WhoOwnsInputSchema._def.schema.shape,
    },
    wrap("WhoOwns", (raw) => handleWhoOwns(raw, taskDeps)),
  );

  server.registerTool(
    "GetTranscript",
    {
      description:
        "Structured transcript from the session's events.jsonl: ordered user/assistant/system turns with turnId and timestamp. Optional since_turn filters.",
      inputSchema: GetTranscriptInputSchema.shape,
    },
    wrap("GetTranscript", (raw) => handleGetTranscript(raw, taskDeps)),
  );

  server.registerTool(
    "PaneJoin",
    {
      description:
        "Move an agent's tmux pane into another window (or the current one). Optional layout/size_percent/horizontal flags.",
      inputSchema: PaneJoinInputSchema.shape,
    },
    wrap("PaneJoin", (raw) => handlePaneJoin(raw, taskDeps)),
  );
  server.registerTool(
    "PaneBreak",
    {
      description: "Break an agent's pane back out into its own window (inverse of PaneJoin).",
      inputSchema: PaneBreakInputSchema.shape,
    },
    wrap("PaneBreak", (raw) => handlePaneBreak(raw, taskDeps)),
  );
  server.registerTool(
    "PaneFocus",
    {
      description: "Focus an agent's tmux window/pane in the current client.",
      inputSchema: PaneFocusInputSchema.shape,
    },
    wrap("PaneFocus", (raw) => handlePaneFocus(raw, taskDeps)),
  );
  server.registerTool(
    "PaneResize",
    {
      description: "Resize an agent's pane: direction U/D/L/R + cells, or absolute percent.",
      inputSchema: PaneResizeInputSchema.shape,
    },
    wrap("PaneResize", (raw) => handlePaneResize(raw, taskDeps)),
  );
  server.registerTool(
    "PaneSwap",
    {
      description: "Swap two agents' visible panes.",
      inputSchema: PaneSwapInputSchema.shape,
    },
    wrap("PaneSwap", (raw) => handlePaneSwap(raw, taskDeps)),
  );

  server.registerTool(
    "SendToTeam",
    {
      description:
        "Broadcast a message to every running member of a team and aggregate their replies. mode='first' races and returns the first reply.",
      inputSchema: SendToTeamInputSchema.shape,
    },
    wrap("SendToTeam", (raw, progress) => handleSendToTeam(raw, sendDeps, progress)),
  );

  server.registerTool(
    "Restart",
    {
      description:
        "Stop and respawn an agent with the same config (name, team, model, subagent_type). Optional prompt override.",
      inputSchema: RestartInputSchema.shape,
    },
    wrap("Restart", (raw) => handleRestart(raw, agentDeps)),
  );

  server.registerTool(
    "Pause",
    {
      description: "SIGSTOP the agent's process so it stops consuming CPU. Resume later with the Resume tool.",
      inputSchema: PauseInputSchema.shape,
    },
    wrap("Pause", (raw) => handlePause(raw, taskDeps)),
  );

  server.registerTool(
    "Resume",
    {
      description: "SIGCONT a previously Paused agent.",
      inputSchema: ResumeInputSchema.shape,
    },
    wrap("Resume", (raw) => handleResume(raw, taskDeps)),
  );

  server.registerTool(
    "GC",
    {
      description:
        "Garbage-collect orphaned ~/.copilot/session-state/ dirs (UUIDs not in our state) and optionally prune exited tasks older than N hours. dry_run:true returns what would be removed.",
      inputSchema: GcInputSchema.shape,
    },
    wrap("GC", (raw) => handleGc(raw, taskDeps)),
  );

  return server;
};

export { buildServer };

const __isMain = (() => {
  try {
    const url = new URL(import.meta.url);
    return url.pathname === process.argv[1];
  } catch {
    return false;
  }
})();

if (__isMain) {
  const server = buildServer({
    ...(process.env.COPILOT_TEAMS_BINARY ? { binary: process.env.COPILOT_TEAMS_BINARY } : {}),
    ...(process.env.COPILOT_TEAMS_STATE_PATH ? { statePath: process.env.COPILOT_TEAMS_STATE_PATH } : {}),
    ...(process.env.COPILOT_SESSION_ROOT ? { sessionRoot: process.env.COPILOT_SESSION_ROOT } : {}),
  });
  const transport = new StdioServerTransport();
  server.connect(transport).then(
    () => logger.info({ event: "ready", version: VERSION }, "copilot-teams MCP server ready"),
    (err: unknown) => {
      logger.fatal({ err }, "fatal startup error");
      process.exit(1);
    },
  );
}

void z; // keep import for future schema use
