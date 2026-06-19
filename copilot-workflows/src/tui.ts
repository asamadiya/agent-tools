import { listRuns, type StateOptions } from "./state.js";
import type { WorkflowRun } from "./types.js";
import {
  renderWorkflowDetail,
  renderWorkflowList,
  workflowIdForRun,
} from "./visibility.js";

export interface WorkflowUiState {
  view: "list" | "workflow" | "tasks" | "agent";
  selectedRunIndex: number;
  selectedPhaseIndex: number;
  selectedAgentIndex: number;
  detailScroll: number;
  quit: boolean;
}

export type WorkflowUiKey = "up" | "down" | "left" | "right" | "enter" | "escape" | "j" | "k" | "q" | "refresh";

export const createWorkflowUiState = (runs: WorkflowRun[]): WorkflowUiState => ({
  view: "list",
  selectedRunIndex: runs.length > 0 ? 0 : -1,
  selectedPhaseIndex: 0,
  selectedAgentIndex: 0,
  detailScroll: 0,
  quit: false,
});

const clampRunIndex = (idx: number, runs: WorkflowRun[]): number => {
  if (runs.length === 0) return -1;
  return Math.max(0, Math.min(idx, runs.length - 1));
};

type AgentEntry = Extract<WorkflowRun["workflowProgress"][number], { type: "workflow_agent" }>;
type PhaseEntry = Extract<WorkflowRun["workflowProgress"][number], { type: "workflow_phase" }>;

const agents = (run: WorkflowRun | undefined): AgentEntry[] =>
  run?.workflowProgress.filter((p): p is AgentEntry => p.type === "workflow_agent") ?? [];

const phases = (run: WorkflowRun | undefined): PhaseEntry[] => {
  if (!run) return [];
  const entries = run.workflowProgress.filter((p): p is PhaseEntry => p.type === "workflow_phase");
  const seen = new Set(entries.map((p) => p.title));
  for (const agent of agents(run)) {
    const title = agent.phaseTitle ?? "Tasks";
    if (!seen.has(title)) {
      entries.push({ type: "workflow_phase", index: entries.length + 1, title });
      seen.add(title);
    }
  }
  return entries.length ? entries : [{ type: "workflow_phase", index: 1, title: "Tasks" }];
};

const agentsForSelectedPhase = (run: WorkflowRun | undefined, phaseIndex: number): AgentEntry[] => {
  const phase = phases(run)[phaseIndex];
  if (!run || !phase) return [];
  return agents(run).filter((a) => (a.phaseTitle ?? "Tasks") === phase.title);
};

const clampSelection = (state: WorkflowUiState, runs: WorkflowRun[]): WorkflowUiState => {
  const selectedRunIndex = clampRunIndex(state.selectedRunIndex, runs);
  const run = runs[selectedRunIndex];
  const selectedPhaseIndex = Math.max(0, Math.min(state.selectedPhaseIndex, Math.max(0, phases(run).length - 1)));
  const selectedAgentIndex = Math.max(0, Math.min(state.selectedAgentIndex, Math.max(0, agentsForSelectedPhase(run, selectedPhaseIndex).length - 1)));
  return { ...state, selectedRunIndex, selectedPhaseIndex, selectedAgentIndex };
};

export const handleWorkflowUiKey = (
  state: WorkflowUiState,
  runs: WorkflowRun[],
  key: WorkflowUiKey,
): WorkflowUiState => {
  state = clampSelection(state, runs);
  const run = runs[state.selectedRunIndex];
  if (key === "q") return { ...state, quit: true };
  if (key === "refresh") return clampSelection(state, runs);
  if (key === "escape") return { ...state, view: "list" };
  if ((key === "enter" || key === "right") && state.selectedRunIndex >= 0) {
    if (state.view === "list") return { ...state, view: "workflow", selectedPhaseIndex: 0, selectedAgentIndex: 0, detailScroll: 0 };
    if (state.view === "workflow") return { ...state, view: "tasks", selectedAgentIndex: 0, detailScroll: 0 };
    if (state.view === "tasks") return { ...state, view: "agent", detailScroll: 0 };
  }
  if (key === "left") {
    if (state.view === "agent") return { ...state, view: "tasks", detailScroll: 0 };
    if (state.view === "tasks") return { ...state, view: "workflow", selectedAgentIndex: 0, detailScroll: 0 };
    if (state.view === "workflow") return { ...state, view: "list", detailScroll: 0 };
  }
  if (state.view === "agent") {
    if (key === "j" || key === "down") return { ...state, detailScroll: state.detailScroll + 1 };
    if (key === "k" || key === "up") return { ...state, detailScroll: Math.max(0, state.detailScroll - 1) };
    return state;
  }
  if (state.view === "workflow") {
    if (key === "up") return { ...state, selectedPhaseIndex: Math.max(0, state.selectedPhaseIndex - 1), selectedAgentIndex: 0 };
    if (key === "down") return { ...state, selectedPhaseIndex: Math.min(phases(run).length - 1, state.selectedPhaseIndex + 1), selectedAgentIndex: 0 };
    return state;
  }
  if (state.view === "tasks") {
    const phaseAgents = agentsForSelectedPhase(run, state.selectedPhaseIndex);
    if (key === "up") return { ...state, selectedAgentIndex: Math.max(0, state.selectedAgentIndex - 1) };
    if (key === "down") return { ...state, selectedAgentIndex: Math.min(Math.max(0, phaseAgents.length - 1), state.selectedAgentIndex + 1) };
    return state;
  }
  if (key === "up") return { ...state, selectedRunIndex: clampRunIndex(state.selectedRunIndex - 1, runs) };
  if (key === "down") return { ...state, selectedRunIndex: clampRunIndex(state.selectedRunIndex + 1, runs) };
  return state;
};

export const renderWorkflowUi = (runs: WorkflowRun[], state: WorkflowUiState): string => {
  const selected = runs[state.selectedRunIndex];
  if ((state.view === "workflow" || state.view === "tasks" || state.view === "agent") && selected) {
    const phase = phases(selected)[state.selectedPhaseIndex];
    const agent = agentsForSelectedPhase(selected, state.selectedPhaseIndex)[state.selectedAgentIndex];
    const detail = renderWorkflowDetail(selected, {
      workflowId: workflowIdForRun(selected, runs),
      selectedPhase: phase?.title,
      selectedAgent: agent?.label ?? agent?.stepId,
      mode: state.view,
    });
    if (state.view === "tasks") {
      return [
        "Tasks (↑/↓ select task · → details · ← phases)",
        detail,
      ].join("\n");
    }
    if (state.view === "workflow") return detail;
    const lines = detail.split("\n");
    const scroll = Math.min(state.detailScroll, Math.max(0, lines.length - 1));
    return [
      "Agent details (j/k or ↑/↓ scroll · ← back)",
      ...lines.slice(scroll),
    ].join("\n");
  }
  return renderWorkflowList(runs, selected?.runId);
};

const keyFromBuffer = (buf: Buffer): WorkflowUiKey | null => {
  const s = buf.toString("utf8");
  if (s === "\u0003" || s === "q") return "q";
  if (s === "\r" || s === "\n") return "enter";
  if (s === "\u001b") return "escape";
  if (s === "\u001b[A") return "up";
  if (s === "\u001b[B") return "down";
  if (s === "\u001b[C") return "right";
  if (s === "\u001b[D") return "left";
  if (s === "j") return "j";
  if (s === "k") return "k";
  if (s === "r") return "refresh";
  return null;
};

export const runWorkflowTui = async (
  opts: StateOptions & { once?: boolean; input?: NodeJS.ReadStream; output?: NodeJS.WriteStream } = {},
): Promise<void> => {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  let runs = listRuns(opts);
  let state = createWorkflowUiState(runs);
  const render = () => {
    runs = listRuns(opts);
    state = handleWorkflowUiKey(state, runs, "refresh");
    output.write("\x1b[2J\x1b[H");
    output.write(`${renderWorkflowUi(runs, state)}\n`);
  };

  if (opts.once || !input.isTTY || !output.isTTY) {
    output.write(`${renderWorkflowUi(runs, state)}\n`);
    return;
  }

  input.setRawMode(true);
  input.resume();
  render();
  await new Promise<void>((resolve) => {
    const onData = (buf: Buffer) => {
      const key = keyFromBuffer(buf);
      if (!key) return;
      state = handleWorkflowUiKey(state, runs, key);
      if (state.quit) {
        input.setRawMode(false);
        input.pause();
        input.off("data", onData);
        output.write("\n");
        resolve();
        return;
      }
      render();
    };
    input.on("data", onData);
  });
};
