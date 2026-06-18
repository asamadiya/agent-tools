# Dynamic Workflows Design

## Goal

Support Claude Code ultracode-style dynamic workflows for this repository's agent tooling with a user experience that feels the same from the model's perspective: during a normal prompt, the user can say `workflow: <goal or name>`, the assistant can create a dynamic workflow, show progress for every step, and use the workflow to complete the job.

The first implementation should be a separate workflow runner, not an extension of `copilot-teams`. It should expose MCP tools first and a CLI wrapper after that, but those are implementation surfaces. The user-facing behavior is inline orchestration from the assistant.

## Observed Claude Code behavior

In Claude Code, `/effort ultracode` is shown as `xhigh + dynamic workflow orchestration`. A generated workflow run creates a persisted JavaScript file and a run record:

- Script path: `.../workflows/scripts/<workflow-name>-<run-id>.js`
- Run record: `.../workflows/<run-id>.json`
- Transcript directory: `.../subagents/workflows/<run-id>/`
- Journal: `.../subagents/workflows/<run-id>/journal.jsonl`
- Subagent transcripts: `.../subagents/workflows/<run-id>/agent-<id>.jsonl`

The generated JavaScript file starts with a statically parseable `export const meta = { name, description, phases }`, then uses runner-provided globals such as `phase()`, `agent()`, `parallel()`, and `pipeline()`. Each `agent()` has its own context. Data moves between steps only when the workflow script explicitly passes a prior step's return value into a later prompt.

The run record stores `runId`, `taskId`, `script`, `scriptPath`, `result`, `agentCount`, `durationMs`, `summary`, `workflowName`, `status`, `phases`, `defaultModel`, `workflowProgress`, `totalTokens`, and `totalToolCalls`.

## User experience

The assistant should be able to treat `workflow:` in a prompt as a request to use dynamic orchestration. The flow should be:

1. Detect that the user asked for a workflow, or decide a dynamic workflow is useful for a complex multi-agent task.
2. Generate a deterministic workflow JS file.
3. Show a concise pre-run preview with workflow name, phases, agent count estimate, model/effort, permissions, and expected cost/risk level.
4. If confirmation is required by config or policy, ask before launching.
5. Launch the workflow in the background and immediately return `taskId`, `runId`, `scriptPath`, and `transcriptDir`.
6. Stream or expose progress for every phase and agent step.
7. On completion, surface a concise result and retain the full result and transcripts for inspection.

The default model for workflow agents is GPT-5.5, xhigh effort, 1.1M context. It must be configurable globally, per workflow, per phase, and per agent.

## Architecture

Create a separate package, `copilot-workflows`, with two entrypoints:

- `copilot-workflows-server`: MCP server exposing workflow tools.
- `copilot-workflow`: CLI wrapper for running, inspecting, stopping, and resuming workflows from a shell.

The MCP server is the primary integration point. The CLI wrapper is a thin client over the same runner library and state files so behavior stays identical.

Core modules:

- `server`: registers MCP tools and wraps errors/progress consistently.
- `runner`: owns workflow launch, execution, cancellation, resume, and completion.
- `script`: parses and validates workflow JS, extracts `meta`, and executes deterministic scripts in a restricted runtime.
- `planner`: turns `workflow: <goal>` natural language into a workflow JS file.
- `agent-runtime`: spawns isolated Copilot agent contexts for each `agent()` step.
- `state`: persists run records, script files, journals, progress, transcripts, and task indexes.
- `visibility`: formats live progress and returns status/output to MCP and CLI callers.

The runner owns lifecycle. It must not rely on `copilot-teams` state, pane anchoring, or team layout. It may share low-level patterns such as atomic state writes, locks, test stubs, and transcript readers where appropriate.

## Workflow JavaScript contract

The persisted JS file is the canonical workflow artifact. It is dynamic and editable, but deterministic.

Required header:

```js
export const meta = {
  name: 'short-stable-name',
  description: 'One-line purpose shown in previews',
  phases: [
    { title: 'Discover', detail: 'fan out readers' },
    { title: 'Synthesize', detail: 'merge findings' },
  ],
}
```

Rules:

- `meta` must be a pure object literal. Reject variables, spreads, function calls, and template strings before any agent starts.
- Top-level `await` is allowed.
- Node APIs are not available by default.
- Nondeterministic APIs such as `Date.now()`, `Math.random()`, and argless `new Date()` are rejected unless explicitly supplied through `args`.
- The script returns the final workflow result.

Globals:

- `agent(prompt, opts)`: starts one isolated agent context. Options include `label`, `phase`, `schema`, `model`, `effort`, `contextWindow`, `systemPrompt`, `cwd`, `env`, `permissions`, and `isolation`.
- `parallel(thunks)`: runs thunks concurrently as a barrier and preserves input order in results.
- `pipeline(items, ...stages)`: runs item-oriented staged work without a global barrier between stages.
- `phase(title)`: marks the current progress phase.
- `log(message)`: adds a visible progress/journal note.
- `args`: caller-provided JSON value.
- `budget`: token/cost budget helper with `spent()` and `remaining()`.
- `workflow(nameOrPath, args)`: optional nested workflow support, limited to one level.

Each `agent()` has its own context. No step receives implicit memory from another step. The only cross-step channel is explicit JS data flow.

## Agent execution

Each `agent()` step creates a fresh Copilot context. The runner chooses one-shot or persistent subprocess execution based on workflow needs, but the default should be one-shot isolated execution because workflows are easier to reason about when each step is bounded.

Agent inputs:

- Prompt text.
- Model config, defaulting to GPT-5.5 xhigh with 1.1M context.
- Optional JSON Schema for structured output.
- Optional cwd, environment, permission mode, allowed tools, denied tools, and isolation.

Agent outputs:

- Plain text when no schema is supplied.
- A validated object when schema is supplied.
- `null` for user skip, cancellation, or terminal agent death when the failure is configured as non-fatal.

Schema validation should retry malformed structured output and then fail cleanly with an inspectable error when retries are exhausted.

## State and visibility

Workflow state lives under a dedicated directory such as `~/.copilot/workflows/` by default, with test overrides.

Suggested layout:

```text
~/.copilot/workflows/
  index.json
  runs/<run-id>.json
  scripts/<workflow-name>-<run-id>.js
  transcripts/<run-id>/journal.jsonl
  transcripts/<run-id>/agent-<id>.jsonl
  transcripts/<run-id>/agent-<id>.meta.json
```

Every run record should include:

- `runId`, `taskId`, `workflowName`, `status`
- `script`, `scriptPath`, `transcriptDir`
- `args`, `defaultModel`, `defaultEffort`, `defaultContextWindow`
- `phases`
- `workflowProgress`
- `result`, `error`
- `agentCount`, `totalTokens`, `totalToolCalls`, `durationMs`
- timestamps for creation, start, update, and completion

Visibility requirements:

- Every phase and every agent step must be addressable by stable id and human label.
- `WorkflowStatus` must show phase, label, state, model, effort, start time, duration, last tool, token count, retry count, and result/error preview.
- `WorkflowOutput` must return full result, journal, and per-agent transcript references.
- Progress notifications should be emitted when the client provides an MCP progress token.
- The CLI should render the same progress tree as text.
- Stopping and resuming must be visible in state and journal, not just process state.

## Resume and caching

Support `scriptPath` and `resumeFromRunId` like Claude Code:

- `scriptPath` says what to run.
- `resumeFromRunId` says which prior run cache to use.

Cache keys are based on the ordered sequence of `agent()` calls and their serialized `(prompt, opts, args-derived values)`. Same script plus same args plus `resumeFromRunId` should produce a full cache hit with no new agents. Editing the prompt or options for stage N should replay stages before N from cache and run stage N onward live.

Parallel and pipeline runs cache individual `agent()` calls, not entire batches. Reordering steps busts the prefix at the swap point. Cross-session resume is out of scope for the first version unless the state format already makes it safe.

## Failure handling

Failures must be explicit and inspectable:

- Parse or meta validation errors fail before any agent starts.
- A failed schema validation retries, then records a structured failure.
- `parallel()` should isolate thrown thunks into `null` slots while allowing siblings to finish.
- `pipeline()` should drop only the failed item and skip its remaining stages.
- Budget overflow should throw unless caught by the workflow script.
- Hard limits should fail loudly, not truncate silently.
- Cancellation should stop spawning new agents, mark in-flight steps as cancelled/null, write the journal, and leave a resumable run where possible.

Because `null` can otherwise hide failure, generated scripts must filter or explicitly handle `null` before downstream prompts. The planner should emit `log()` lines for dropped counts.

## MCP tools

Initial MCP tools:

- `Workflow`: run a workflow from `script`, `scriptPath`, `name`, or generated `goal`. Supports `args`, `resumeFromRunId`, model defaults, confirmation mode, dry-run preview, and timeout/budget.
- `WorkflowStatus`: return live progress for a run.
- `WorkflowOutput`: return result, journal, transcript refs, and optionally per-agent transcript content.
- `WorkflowStop`: cancel a run.
- `WorkflowList`: list runs by status/name/time.
- `WorkflowInspect`: parse a script and return meta, phases, estimated steps, and validation errors without running it.
- `WorkflowSave`: persist a generated script without running it.

Generated workflows should default to confirmation required. Policies can allow bypass for trusted automation.

## CLI wrapper

The CLI should mirror MCP behavior:

```sh
copilot-workflow run --script path/to/workflow.js --args args.json
copilot-workflow run --goal "workflow: compare README and package metadata"
copilot-workflow status <run-id>
copilot-workflow output <run-id>
copilot-workflow stop <run-id>
copilot-workflow inspect path/to/workflow.js
copilot-workflow resume <run-id> --script path/to/edited.js
```

The CLI should print `taskId`, `runId`, `scriptPath`, and `transcriptDir` immediately, then optionally follow progress.

## Exhaustive test plan

Unit tests:

- Meta parser accepts minimal valid literal metadata.
- Meta parser rejects variables, spreads, calls, template strings, and syntax errors before any agent starts.
- Determinism guard rejects `Date.now()`, `Math.random()`, and argless `new Date()`.
- `args` passes objects and arrays as real values, not JSON strings.
- `agent()` returns string without schema, validated object with schema, and `null` for configured skip/death.
- Schema validation retries malformed output and fails cleanly after retry exhaustion.
- Budget math and budget overflow behavior.
- Cache key serialization includes prompt, schema, model, effort, label, phase, and args-derived values.

Integration tests:

- `parallel()` runs all thunks, preserves result order, waits for all, and isolates one thrown thunk to one `null` slot.
- `pipeline()` allows item A to reach later stages while item B is still early, passes `(prev, original, index)`, and drops only failed items.
- Cross-step data only flows through explicit returned values.
- One-level nested `workflow()` works; second-level nesting fails clearly.
- Persisted script and run record are written on launch.
- Journal and per-agent transcripts are written for every step.
- `WorkflowStatus` reports live phase/agent progress, tokens, retries, last tool, and previews.
- `WorkflowOutput` returns full final result and transcript references without truncating persisted data.

Lifecycle and reliability tests:

- Launch returns `taskId`, `runId`, `scriptPath`, and `transcriptDir` synchronously.
- Progress notifications are emitted with MCP progress tokens.
- Completion updates status, result, duration, token totals, and agent count.
- `WorkflowStop` during fanout stops new work, marks in-flight work, writes a resumable journal, and avoids orphan processes.
- Repeated stop is idempotent.
- Runner restart can recover run state from disk and report terminal/in-progress state accurately.
- Corrupt state files are backed up and surfaced as errors consistent with repository patterns.
- Locking prevents two writers from corrupting the same run.
- Large outputs are persisted and summarized instead of blowing up tool responses.

Resume/cache tests:

- Same script + same args + `resumeFromRunId` spawns zero new agents.
- Editing stage N reuses stages before N and reruns stage N onward.
- Changing schema/model/effort/label busts that call's cache key.
- Reordering parallel items busts the prefix at the swap point.
- Omitting `resumeFromRunId` creates a cold run.
- Resume after stop uses cached completed steps and reruns incomplete ones.

Visibility/user-story tests:

- User says `workflow: compare README and package metadata`; planner generates a script, preview shows phases/agent labels, and runner launches after confirmation.
- User asks to view raw script before running; `WorkflowInspect` returns the persisted JS.
- User asks what each step is doing; `WorkflowStatus` shows stable labels and progress.
- User asks for one agent transcript; `WorkflowOutput` returns that transcript.
- User asks to stop; workflow stops and state is inspectable.
- User edits the JS and resumes; cached vs rerun steps are visible.
- User changes default model/effort/context globally and per agent; effective config is reflected in progress and run JSON.

Viability tests:

- Stub Copilot agents make deterministic structured outputs for CI.
- Tests run without real model calls by default.
- Real-model smoke tests are opt-in and bounded to one tiny read-only workflow.
- The runner handles high fanout within configured concurrency and agent-count limits.
- The runner enforces hard limits as errors: too many items, too many agents, over budget, invalid script, and invalid schema.

## Viability

This is viable. The repository already has the core building blocks needed for an MCP server, state persistence, locks, tmux/process lifecycle, Copilot invocation, progress notifications, and integration tests with a stub Copilot binary. The main new work is the deterministic JS workflow runtime, planner, cache/resume model, and richer progress/result state.

The highest-risk areas are secure JS execution, deterministic replay, cancellation correctness, and making progress visible enough to match Claude's experience. The safest first implementation should use a restricted runtime, a stub agent backend for tests, and a narrow set of globals. The CLI wrapper should reuse the same runner library so it does not become a second behavior surface.
