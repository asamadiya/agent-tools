# copilot-workflows

Dynamic workflow runner for GitHub Copilot CLI agents.

Use this when a prompt says `workflow: <goal>` or when a task benefits from multiple isolated agents with visible phases, transcripts, and resumable JS orchestration.

## Tools

- `Workflow` runs a generated or persisted workflow JS file. By default (`wait:false`) it launches the run in the background and returns immediately with `runId`/`scriptPath`/`transcriptDir`; poll `WorkflowStatus` for completion or pass `wait:true` to run synchronously. Requires `confirm:false` to launch.
- `WorkflowStatus` shows live phase and agent progress.
- `WorkflowOutput` returns the final result, journal, and per-agent transcripts.
- `WorkflowStop` cancels a run.
- `WorkflowInspect` validates a script without running it.
- `WorkflowList` lists runs, optionally filtered by status or workflow name.
- `WorkflowSave` validates and persists a script as a queued run without executing it.

## Workflow UX

Workflow responses include Claude Code-style terminal views:

- `workflowListText` shows numbered workflow rows (`WF1`, `WF2`, ...) so multiple runs can be distinguished.
- `detailView` shows a split view: phases on the left, agent/task rows on the right, plus the selected task's prompt, current activity, and outcome.
- `WorkflowStatus` accepts optional `selectedPhase` and `selectedAgent` fields to render a focused detail view for a specific phase or task.

For an actual interactive terminal view, run:

```sh
copilot-workflow ui
```

Use ↑/↓ to select a workflow, Enter to open the detail table, Esc to return to the list, `r` to refresh, and `q` to quit. Use `copilot-workflow ui --once` for a non-interactive snapshot.

Inside Copilot CLI, the project extension registers `/workflows`. With the local bundle patch below, workflows render inline under the normal footer/status area in the current Copilot session and pane. Press ↓ from the prompt to focus the workflow list, Enter or → to drill into phases/tasks/task details, ← to back out, and ↑/↓ to scroll task detail text. The extension no longer opens tmux popups, so workflow UI does not leak into other panes. Inline filtering uses run owner metadata (`sessionId`, `COPILOT_AGENT_SESSION_ID`, `TMUX_PANE`, or loader pid), so runs created before owner metadata existed may not appear in the inline footer.

Apply the local bundle patch and restart/resume Copilot:

```sh
bin/copilot-workflow-ui-patch
```

The patch is idempotent, validates `app.js` with `node --check`, and can be reverted with `bin/copilot-workflow-ui-patch --revert`. The black-box inline footer UAT is:

```sh
node ../tests/copilot-workflow-inline-footer-uat.test.js
```

Default agent config is GPT-5.5, xhigh effort, 1.1M context. Override globally, per workflow, per phase, or per agent.

## DAG workflows

Workflow scripts can use `dag([...])` for first-class dependency-aware task graphs. Each task has a unique `id`, optional `dependsOn`, and either a `prompt` (auto-runs `agent(prompt, options)`) or a custom `run(results)` function. The runtime validates missing dependencies and cycles before running any work, then executes ready tasks in topological levels with siblings in the same level running in parallel. The return value is an object keyed by task id, and task details include `Task id:` / `Depends on:` metadata in the UI.

`prompt` tasks use dependencies for ordering only. Use `run(results)` when a task needs upstream outputs. DAG task-level agent options (`model`, `effort`, `schema`, `permissions`, `isolation`, etc.) become defaults for nested `agent()` calls inside that task; nested agent options can still override them. If a task fails, the DAG fails instead of silently continuing dependents.

```js
export const meta = {
  name: "dag-demo",
  description: "Dependency-aware workflow",
  phases: [{ title: "Build" }],
}

phase("Build")
return await dag([
  { id: "plan", prompt: "Create an implementation plan", label: "plan" },
  { id: "api", dependsOn: ["plan"], run: ({ plan }) => agent(`Build API from ${plan}`, { label: "api" }) },
  { id: "ui", dependsOn: ["plan"], run: ({ plan }) => agent(`Build UI from ${plan}`, { label: "ui" }) },
  { id: "review", dependsOn: ["api", "ui"], run: ({ api, ui }) => agent(`Review ${api} and ${ui}`, { label: "review" }) },
])
```

### Agent `permissions`

An `agent()` step's `permissions` option maps to the copilot CLI `--mode` flag, which only supports `interactive|plan|autopilot`:

- `default` → omits `--mode` (copilot's interactive default)
- `auto` → `autopilot`
- `plan` → `plan`
- `dontAsk` / `bypassPermissions` → unsupported; the run fails fast instead of forwarding an invalid flag.

## Test

```sh
npm test
npm run typecheck
npm run build
```

Real-model smoke tests are opt-in only; normal tests use deterministic stub agents.
