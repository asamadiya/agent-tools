const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

const hasCommand = (cmd) => spawnSync("bash", ["-lc", `command -v ${cmd}`], { stdio: "ignore" }).status === 0;

if (!hasCommand("tmux") || !hasCommand("copilot")) {
  console.log("inline footer UAT skipped: tmux or copilot is not available");
  process.exit(0);
}

const session = `cw-inline-uat-${process.pid}-${Date.now()}`;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cw-inline-root-"));
const copilotSessionId = `00000000-0000-4000-8000-${String(process.pid).padStart(12, "0").slice(-12)}`;
let seedOrder = 0;

const cleanup = () => {
  spawnSync("tmux", ["kill-session", "-t", session], { stdio: "ignore" });
  fs.rmSync(root, { recursive: true, force: true });
};

process.on("exit", cleanup);

const send = (key) => {
  run("tmux", ["send-keys", "-t", session, key]);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
};
const sendLiteral = (text) => {
  run("tmux", ["send-keys", "-t", session, "-l", text]);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
};
const submitPrompt = (text) => {
  sendLiteral(text);
  send("Enter");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
};
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const capture = () => run("tmux", ["capture-pane", "-p", "-t", session]);
const maxLineLength = (text) => Math.max(...text.split(/\r?\n/).map((line) => line.length));
const tableLines = (text) => text.split(/\r?\n/).filter((line) => /^[╭│╰]/.test(line.trimStart()));
const maxTableLineLength = (text) => Math.max(...tableLines(text).map((line) => line.trimStart().length));
const activePromptLine = (text) =>
  text
    .split(/\r?\n/)
    .filter((line) => line.trimStart() === "❯" || line.trimStart().startsWith("❯ "))
    .at(-1) ?? "";

const waitFor = (predicate, label) => {
  for (let i = 0; i < 80; i++) {
    const out = capture();
    if (predicate(out)) return out;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  assert.fail(`timed out waiting for ${label}\n\n${capture()}`);
};

const agent = (index, label, prompt, tool, activity, outcome, dependsOn = []) => ({
  type: "workflow_agent",
  index,
  stepId: `step-${index}`,
  label,
  phaseIndex: 2,
  phaseTitle: "Execute",
  agentId: `agent-${index}`,
  dagTaskId: label,
  model: "gpt-5.5",
  effort: "xhigh",
  contextWindow: 1100000,
  state: "done",
  promptPreview: prompt,
  lastToolName: tool,
  lastToolSummary: activity,
  resultPreview: outcome,
  ...(dependsOn.length ? { dependsOn } : {}),
  recentToolCalls: [
    { name: "Read", summary: `file-${index}.md` },
    { name: "Bash", summary: `cmd-${index}` },
    { name: "StructuredOutput", summary: label },
  ],
  updatedAt: 1,
  completedAt: 2,
  durationMs: 1,
  attempt: 1,
  tokens: 1,
  toolCalls: 1,
  retries: 0,
});

const runningAgent = () => ({
  ...agent(3, "task-c", ["running prompt 1", "running prompt 2", "running prompt 3"].join("\n"), "Bash", "still working", "", ["task-b"]),
  state: "running",
  updatedAt: Date.now() - 116_000,
  tokens: 112_100,
  toolCalls: 34,
  durationMs: undefined,
  resultPreview: undefined,
  recentToolCalls: [
    { name: "Bash", summary: "POD=appinstance NS=irp" },
    { name: "Read", summary: "/tmp/src/gr_servicer.py" },
    { name: "Read", summary: "/tmp/src/mcr/recorder_grpc_interceptor.py" },
  ],
});

const seedRun = (owner, name, runId) => {
  const nowDate = new Date(1_700_000_000_000 + seedOrder++ * 1000);
  const now = nowDate.toISOString();
  const runRecord = {
    runId,
    taskId: `${runId}-task`,
    workflowName: name,
    status: "completed",
    script: "",
    scriptPath: path.join(root, "scripts", `${name}.js`),
    transcriptDir: path.join(root, "transcripts", runId),
    owner,
    args: {},
    defaultModel: "gpt-5.5",
    defaultEffort: "xhigh",
    defaultContextWindow: 1100000,
    phases: [{ title: "Plan" }, { title: "Execute" }],
    workflowProgress: [
      { type: "workflow_phase", index: 1, title: "Plan" },
      { type: "workflow_phase", index: 2, title: "Execute" },
      agent(1, "task-a", "prompt A", "ToolA", "activity A", "outcome A"),
      agent(2, "task-b", ["prompt B line 1", "prompt B line 2", "prompt B line 3", "prompt B line 4"].join("\n"), "ToolB", "activity B", "outcome B", ["task-a"]),
      runningAgent(),
    ],
    cacheResults: [],
    result: null,
    error: null,
    agentCount: 2,
    totalTokens: 2,
    totalToolCalls: 2,
    durationMs: 1000,
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    completedAt: now,
  };
  fs.mkdirSync(path.dirname(runRecord.scriptPath), { recursive: true });
  fs.mkdirSync(runRecord.transcriptDir, { recursive: true });
  fs.writeFileSync(runRecord.scriptPath, "");
  const runPath = path.join(root, "runs", `${runId}.json`);
  fs.writeFileSync(runPath, `${JSON.stringify(runRecord, null, 2)}\n`);
  fs.utimesSync(runPath, nowDate, nowDate);
};

const updateAgent = (runId, label, update) => {
  const file = path.join(root, "runs", `${runId}.json`);
  const runRecord = JSON.parse(fs.readFileSync(file, "utf8"));
  runRecord.workflowProgress = runRecord.workflowProgress.map((entry) =>
    entry.type === "workflow_agent" && entry.label === label ? { ...entry, ...update(entry) } : entry,
  );
  runRecord.updatedAt = new Date().toISOString();
  fs.writeFileSync(file, `${JSON.stringify(runRecord, null, 2)}\n`);
};

fs.mkdirSync(path.join(root, "runs"), { recursive: true });
run("tmux", ["new-session", "-d", "-s", session, "-x", "200", "-y", "36", "bash --noprofile --norc"]);
const pane = run("tmux", ["display-message", "-p", "-t", session, "#{pane_id}"]).trim();
seedRun({ copilotAgentSessionId: copilotSessionId }, "session-uat-workflow", "wf_session_uat");
seedRun({ tmuxPane: pane }, "inline-uat-workflow", "wf_inline_uat");
seedRun({ copilotAgentSessionId: "11111111-1111-4111-8111-111111111111" }, "foreign-session-uat-workflow", "wf_foreign_session_uat");
seedRun({ tmuxPane: "%foreign-pane" }, "foreign-uat-workflow", "wf_foreign_uat");
for (let i = 0; i < 30; i++) {
  seedRun({ tmuxPane: `%foreign-pane-${i}` }, `foreign-flood-${i}`, `wf_foreign_flood_${i}`);
}

run("tmux", ["send-keys", "-t", session, `cd ${repoRoot} && COPILOT_WORKFLOWS_ROOT=${root} copilot --session-id ${copilotSessionId}`, "Enter"]);

const initial = waitFor(
  (out) => out.includes("↑/↓ to select · Enter to view") && out.includes("inline-uat-workflow"),
  "inline workflow footer",
);
assert(initial.includes("↑/↓ to select · Enter to view"));
assert(initial.includes("session-uat-workflow"), "matching session workflow did not appear");
assert(!initial.includes("foreign-uat-workflow"), "foreign pane workflow leaked into inline footer");
assert(!initial.includes("foreign-session-uat-workflow"), "foreign session workflow leaked into inline footer");

sleep(1000);
submitPrompt("Reply exactly: HISTORY_SENTINEL");
waitFor((out) => out.includes("HISTORY_SENTINEL"), "history sentinel prompt");
sleep(1000);
send("Up");
waitFor((out) => activePromptLine(out).includes("HISTORY_SENTINEL"), "history sentinel recalled into prompt");
send("Down");
sleep(800);
const afterHistoryDown = capture();
assert(
  !afterHistoryDown.includes("Workflows · ↑↓ select · → phases · Esc prompt"),
  `first Down from history should return to latest prompt before focusing workflows\n\n${afterHistoryDown}`,
);
assert(
  !activePromptLine(afterHistoryDown).includes("HISTORY_SENTINEL"),
  `first Down from history did not leave previous prompt history\n\n${afterHistoryDown}`,
);
send("Down");
waitFor((out) => out.includes("Workflows · ↑↓ select · → phases · Esc prompt"), "workflow focus");
sendLiteral("Z");
sleep(800);
const afterFocusedPrintable = capture();
assert(!activePromptLine(afterFocusedPrintable).includes("Z"), "printable key leaked into prompt while workflow was focused");
send("Up");
sleep(800);
const afterFocusedUp = capture();
assert(
  !activePromptLine(afterFocusedUp).includes("HISTORY_SENTINEL"),
  `workflow Up arrow replaced active prompt with history\n\n${afterFocusedUp}`,
);
send("Right");
waitFor((out) => out.includes("╭ Phases") && out.includes("Plan"), "phase table before arrow isolation check");
send("Left");
send("Escape");
sleep(1000);
sendLiteral("X");
sleep(800);
const afterFocusedArrow = capture();
assert(
  activePromptLine(afterFocusedArrow).includes("X"),
  `prompt cursor did not remain at end after workflow arrow navigation\n\n${afterFocusedArrow}`,
);
assert(!activePromptLine(afterFocusedArrow).includes("HISTORY_SENTINEL"), "workflow Left arrow leaked into prompt history movement");
send("C-u");
waitFor((out) => activePromptLine(out).trim() === "❯", "prompt cleared before refocusing workflow");
send("Down");
send("Right");
const phases = waitFor(
  (out) =>
    out.includes("╭ Phases") &&
    out.includes("┬") &&
    out.includes("Plan") &&
    out.includes("Execute"),
  "bordered phase table",
);
assert(phases.includes("╰"));
assert(
  maxTableLineLength(phases) >= 170,
  `workflow table should use most of the pane width; max table line was ${maxTableLineLength(phases)}`,
);
assert(tableLines(phases).length >= 14, `workflow table should reserve useful height; got ${tableLines(phases).length} table lines`);
assert(!phases.includes("> right"), "workflow Right arrow leaked into prompt text");
assert(!phases.includes("> down"), "workflow Down arrow leaked into prompt text");
send("Down");
send("Right");
send("Down");
let tasks = waitFor(
  (out) =>
    out.includes("╭ Execute") &&
    out.includes("task-b") &&
    out.includes("Prompt · 4 lines"),
  "bordered task selection",
);
assert(tasks.includes("Prompt · 4 lines"));
assert(maxTableLineLength(tasks) >= 170, "task table should use most of the pane width");

send("Right");
let details = waitFor(
  (out) =>
    out.includes("╭ Execute") &&
    out.includes("┬ task-b") &&
    out.includes("Task id: task-b") &&
    out.includes("Depends on: task-a"),
  "agent dependency details",
);
assert(details.includes("Workflows · details"));
assert(details.includes("✔ Completed · gpt-5.5 (1.1M context)"));
assert(details.includes("Task id: task-b"));
assert(details.includes("Depends on: task-a"));
assert(details.includes("Prompt · 4 lines"));
send("Down");
send("Down");
send("Down");
send("Down");
send("Down");
details = waitFor((out) => out.includes("Activity · last 3 of 1 tool call") && out.includes("Outcome: outcome B"), "scrolled agent details");
assert(details.includes("Activity · last 3 of 1 tool call"));
assert(details.includes("StructuredOutput(task-b)"));
assert(details.includes("Outcome: outcome B"));
assert(!details.includes("foreign-uat-workflow"), "foreign pane workflow leaked after navigation");

send("Left");
send("Down");
send("Right");
const running = waitFor(
  (out) =>
    out.includes("╭ Execute") &&
    out.includes("┬ task-c") &&
    out.includes("● Running · gpt-5.5 (1.1M context)") &&
    out.includes("Prompt · 3 lines"),
  "running agent details",
);
assert(running.includes("112.1k tok · 34 tool calls"));
assert(running.includes("Prompt · 3 lines"));
send("Down");
send("Down");
send("Down");
send("Down");
send("Down");
const runningScrolled = waitFor(
  (out) =>
    out.includes("Activity · last 3 of 34 tool calls") &&
    out.includes("Read(/tmp/src/mcr/recorder_grpc_interceptor.py)") &&
    out.includes("Outcome: Still running…"),
  "scrolled running agent details",
);
assert(runningScrolled.includes("Outcome: Still running…"));
updateAgent("wf_inline_uat", "task-c", () => ({
  tokens: 113_400,
  toolCalls: 35,
  updatedAt: Date.now() - 1000,
  lastToolName: "Write",
  lastToolSummary: "/tmp/live-update.md",
  recentToolCalls: [
    { name: "Read", summary: "/tmp/src/gr_servicer.py" },
    { name: "Bash", summary: "pytest tests/test_live.py" },
    { name: "Write", summary: "/tmp/live-update.md" },
  ],
}));
const liveUpdate = waitFor(
  (out) => out.includes("Activity · last 3 of 35 tool calls") && out.includes("Write(/tmp/live-update.md)"),
  "live running agent detail update",
);
assert(liveUpdate.includes("Outcome: Still running…"));

console.log("inline workflow footer UAT passed");
