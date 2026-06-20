import type { AgentStepState, WorkflowProgressEntry, WorkflowRun } from "./types.js";

type AgentEntry = Extract<WorkflowProgressEntry, { type: "workflow_agent" }>;
type PhaseEntry = Extract<WorkflowProgressEntry, { type: "workflow_phase" }>;

export interface WorkflowListItem {
  workflowId: string;
  runId: string;
  taskId: string;
  name: string;
  status: WorkflowRun["status"];
  doneAgents: number;
  totalAgents: number;
  duration: string;
  tokens: string;
  summary: string;
}

export interface WorkflowRenderOptions {
  workflowId?: string;
  selectedPhase?: string;
  selectedAgent?: string;
  mode?: "workflow" | "tasks" | "agent";
}

const stateIcon = (state: WorkflowRun["status"] | AgentStepState): string => {
  switch (state) {
    case "completed":
    case "done":
      return "✔";
    case "running":
      return "◯";
    case "failed":
      return "✖";
    case "stopped":
    case "cancelled":
      return "⊘";
    case "cached":
      return "↻";
    case "queued":
    case "preview":
    default:
      return "○";
  }
};

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m${rem}s`;
};

const formatLongDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  let s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  return [
    h > 0 ? `${h}h` : "",
    m > 0 ? `${m}m` : "",
    `${s}s`,
  ].filter(Boolean).join(" ");
};

const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M tok`;
  if (n >= 1_000) return `${Number.isInteger(n / 1000) ? n / 1000 : (n / 1000).toFixed(1)}k tok`;
  return `${n} tok`;
};

const formatContext = (n: number): string => {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M context`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}k context`;
  return `${n} context`;
};

const truncate = (s: string | undefined, max = 96): string => {
  if (!s) return "";
  const single = s.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
};

const agents = (run: WorkflowRun): AgentEntry[] =>
  run.workflowProgress.filter((p): p is AgentEntry => p.type === "workflow_agent");

const phases = (run: WorkflowRun): PhaseEntry[] => {
  const explicit = run.workflowProgress.filter((p): p is PhaseEntry => p.type === "workflow_phase");
  const seen = new Set(explicit.map((p) => p.title));
  for (const agent of agents(run)) {
    const title = agent.phaseTitle ?? "Tasks";
    if (!seen.has(title)) {
      explicit.push({ type: "workflow_phase", index: explicit.length + 1, title });
      seen.add(title);
    }
  }
  if (explicit.length === 0) explicit.push({ type: "workflow_phase", index: 1, title: "Tasks" });
  return explicit;
};

const agentsForPhase = (run: WorkflowRun, phaseTitle: string): AgentEntry[] =>
  agents(run).filter((a) => (a.phaseTitle ?? "Tasks") === phaseTitle);

const isAgentDone = (a: AgentEntry): boolean => ["done", "cached"].includes(a.state);

export const workflowListItems = (runs: WorkflowRun[]): WorkflowListItem[] =>
  runs.map((run, i) => {
    const allAgents = agents(run);
    const done = allAgents.filter(isAgentDone).length;
    return {
      workflowId: `WF${i + 1}`,
      runId: run.runId,
      taskId: run.taskId,
      name: run.workflowName,
      status: run.status,
      doneAgents: done,
      totalAgents: allAgents.length,
      duration: formatDuration(run.durationMs),
      tokens: formatTokens(run.totalTokens),
      summary: `${stateIcon(run.status)} ${run.workflowName} ${done}/${allAgents.length} agents · ${formatDuration(run.durationMs)} · ${run.status}`,
    };
  });

export const workflowIdForRun = (run: WorkflowRun, runs: WorkflowRun[]): string => {
  const idx = runs.findIndex((r) => r.runId === run.runId);
  return idx >= 0 ? `WF${idx + 1}` : "WF?";
};

export const renderWorkflowList = (runs: WorkflowRun[], selectedRunId?: string): string => {
  if (runs.length === 0) return "Workflows\n  No workflow runs found";
  const items = workflowListItems(runs);
  return [
    "Workflows",
    ...items.map((item) => {
      const cursor = item.runId === selectedRunId || (!selectedRunId && item.workflowId === "WF1") ? "❯" : " ";
      return `${cursor} ${item.workflowId} ${item.summary}`;
    }),
    "↑↓ select · Enter details · WorkflowStatus { runId }",
  ].join("\n");
};

const phaseStatus = (phaseAgents: AgentEntry[]): AgentStepState => {
  if (phaseAgents.some((a) => a.state === "failed")) return "failed";
  if (phaseAgents.some((a) => a.state === "running")) return "running";
  if (phaseAgents.length > 0 && phaseAgents.every(isAgentDone)) return "done";
  return "queued";
};

const phaseLine = (phase: PhaseEntry, phaseAgents: AgentEntry[], selected: boolean): string => {
  const done = phaseAgents.filter(isAgentDone).length;
  return `${selected ? "❯" : " "} ${stateIcon(phaseStatus(phaseAgents))} ${phase.title} ${done}/${phaseAgents.length}`;
};

const agentLine = (agent: AgentEntry, selected: boolean): string => {
  const bits = [
    `${selected ? "❯ " : "  "}${stateIcon(agent.state)} ${agent.label}`,
    `${agent.model}/${agent.effort}`,
    formatTokens(agent.tokens),
    `${agent.toolCalls} tools`,
    agent.durationMs !== undefined ? formatDuration(agent.durationMs) : agent.state,
  ];
  return bits.join(" · ");
};

const phaseHeader = (phase: PhaseEntry, phaseAgents: AgentEntry[]): string =>
  `${phase.title} · ${plural(phaseAgents.length, "agent")}`;

const detailBlock = (agent: AgentEntry | undefined): string[] => {
  if (!agent) return ["Prompt: (no agent selected)", "Activity: none", "Outcome: none"];
  const activity = agent.lastToolName
    ? `${agent.lastToolName}${agent.lastToolSummary ? ` — ${truncate(agent.lastToolSummary)}` : ""}`
    : agent.state;
  const outcome = agent.error ?? agent.resultPreview ?? "(no outcome yet)";
  const stateLabel = agent.state === "done" || agent.state === "cached"
    ? "Completed"
    : agent.state.charAt(0).toUpperCase() + agent.state.slice(1);
  const statusIcon = agent.state === "running" ? "●" : stateIcon(agent.state);
  const elapsed = agent.state === "running" && agent.updatedAt
    ? `idle ${formatLongDuration(Date.now() - agent.updatedAt)}`
    : agent.durationMs !== undefined
      ? formatLongDuration(agent.durationMs)
      : agent.state;
  const promptLines = (agent.promptPreview ?? "").split(/\r?\n/);
  const hasMultilinePrompt = promptLines.length > 1;
  const promptBlock = hasMultilinePrompt
    ? [
        `Prompt · ${plural(promptLines.length, "line")} · expand`,
        ...promptLines.slice(0, 2).map((line) => `  ${truncate(line, 180)}`),
        ...(promptLines.length > 2 ? [`  … ${promptLines.length - 2} more lines`] : []),
      ]
    : [`Prompt: ${truncate(agent.promptPreview, 140) || "(prompt unavailable)"}`];
  const recentToolCalls = agent.recentToolCalls ?? [];
  const activityBlock = recentToolCalls.length > 0
    ? [
        `Activity · last ${Math.min(3, recentToolCalls.length)} of ${plural(agent.toolCalls, "tool call")}`,
        ...recentToolCalls.slice(-3).map((tool) => `  ${tool.name}${tool.summary ? `(${truncate(tool.summary, 160)})` : ""}`),
      ]
    : [`Activity: ${activity}`];
  const outcomeText = agent.state === "running" ? "Still running…" : outcome;
  const outcomeLines = outcomeText.split(/\r?\n/);
  const outcomeBlock = outcomeLines.length > 1
    ? ["Outcome", ...outcomeLines.map((line) => (line ? `  ${line}` : ""))]
    : [`Outcome: ${truncate(outcomeText, 160)}`];
  return [
    `${statusIcon} ${stateLabel} · ${agent.model} (${formatContext(agent.contextWindow)})`,
    `${formatTokens(agent.tokens)} · ${plural(agent.toolCalls, "tool call")} · ${elapsed}`,
    ...(agent.dagTaskId ? [`Task id: ${agent.dagTaskId}`] : []),
    ...(agent.dependsOn?.length ? [`Depends on: ${agent.dependsOn.join(", ")}`] : []),
    ...promptBlock,
    ...activityBlock,
    ...outcomeBlock,
  ];
};

const phaseSummaryBlock = (phaseTitle: string, phaseAgents: AgentEntry[]): string[] => {
  if (phaseAgents.length === 0) {
    return [`Phase outcome: ${phaseTitle} has no tasks yet`, "Activity: none", "Outcome: none"];
  }
  const outcomes = phaseAgents.map((agent) => {
    const outcome = truncate(agent.error ?? agent.resultPreview ?? agent.lastToolSummary ?? agent.state, 100);
    return `${stateIcon(agent.state)} ${agent.label}: ${outcome || agent.state}`;
  });
  return [
    `Phase outcome: ${phaseTitle} completed ${phaseAgents.filter(isAgentDone).length}/${phaseAgents.length} tasks`,
    "Activity:",
    ...outcomes,
  ];
};

export const renderWorkflowDetail = (run: WorkflowRun, opts: WorkflowRenderOptions = {}): string => {
  const phaseEntries = phases(run);
  const activePhase =
    opts.selectedPhase ??
    phaseEntries.find((p) => agentsForPhase(run, p.title).some((a) => a.state === "running"))?.title ??
    phaseEntries[0]!.title;
  const selectedAgents = agentsForPhase(run, activePhase);
  const selectedAgent =
    (opts.selectedAgent ? selectedAgents.find((a) => a.label === opts.selectedAgent || a.stepId === opts.selectedAgent) : undefined) ??
    selectedAgents[0];

  const left = phaseEntries.map((phase) => phaseLine(phase, agentsForPhase(run, phase.title), phase.title === activePhase));
  const right = [
    phaseHeader({ type: "workflow_phase", index: 1, title: activePhase }, selectedAgents),
    ...selectedAgents.map((agent) => agentLine(agent, agent === selectedAgent)),
  ];
  const widthLeft = Math.max(18, ...left.map((l) => l.length));
  const widthRight = Math.max(48, ...right.map((r) => r.length));
  const rows = Math.max(left.length, right.length);
  const lines = [
    `${opts.workflowId ?? "WF?"} ${run.workflowName}`,
    `${run.status} · ${agents(run).filter(isAgentDone).length}/${agents(run).length} agents · ${formatDuration(run.durationMs)} · ${formatTokens(run.totalTokens)}`,
    `╭ ${"Phases".padEnd(widthLeft + 1, "─")}┬ ${right[0]!.padEnd(widthRight + 1, "─")}╮`,
  ];
  for (let i = 0; i < rows; i++) {
    lines.push(`│ ${(left[i] ?? "").padEnd(widthLeft)} │ ${(right[i + 1] ?? "").padEnd(widthRight)} │`);
  }
  lines.push(`╰${"─".repeat(widthLeft + 2)}┴${"─".repeat(widthRight + 2)}╯`);
  lines.push(...(opts.mode === "workflow" ? phaseSummaryBlock(activePhase, selectedAgents) : detailBlock(selectedAgent)));
  lines.push("↑↓ select workflow/phase · Enter details · WorkflowOutput { runId } for transcripts");
  return lines.join("\n");
};

export const renderProgressTree = (run: WorkflowRun): string => renderWorkflowDetail(run);
