# Workflow Outcome Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make workflow task outcomes Claude-like: contract-driven, status-first, evidence-rich, and useful in the inline footer, terminal renderer, and canvas/browser UI.

**Architecture:** Preserve raw agent output, but add a longer outcome field plus parsing/rendering helpers that detect planner/executor/reviewer/verifier/researcher/synthesizer outcomes. Update generated workflow prompts so new agents emit a consistent `## OUTCOME` contract, and keep token count plus elapsed time visible in every details view.

**Tech Stack:** TypeScript/Node (`copilot-workflows`), Zod schemas, native Copilot bundle patcher (`lib/workflow-ui-patch.js`), project extension HTML/JS, Vitest, black-box tmux UAT.

## Global Constraints

- Use TDD for every behavior change.
- Keep raw agent text available; do not replace transcripts with parsed summaries.
- Do not add new runtime dependencies.
- Keep token count and agent elapsed time visible in the agent detail/outcome view.
- Inline footer must stay session/pane-local and must not leak keyboard input to the prompt/TUI while focused.
- Update black-box UATs for every reported UX behavior.

---

## File Structure

- `copilot-workflows/src/types.ts`: add persisted long outcome field on workflow-agent progress entries.
- `copilot-workflows/src/script.ts`: store longer outcome text and add prompt-contract instructions to generated/planner/synthesizer prompts.
- `copilot-workflows/src/visibility.ts`: create reusable outcome-kind parsing/rendering for terminal status output.
- `.github/extensions/workflow-ui/extension.mjs`: mirror structured outcome rendering in browser/canvas UI.
- `lib/workflow-ui-patch.js`: mirror structured outcome rendering in native inline footer patch.
- `copilot-workflows/tests/unit/visibility.test.ts`: unit coverage for outcome parsing/rendering.
- `copilot-workflows/tests/unit/script.test.ts`: persistence and prompt-contract coverage.
- `tests/copilot-workflow-inline-footer-uat.test.js`: black-box UX coverage for reviewer/executor/verifier/synthesizer outcomes.
- `tests/copilot-workflow-ui-patch.test.js`: patch-marker coverage for outcome renderer in injected bundle.

---

### Task 1: Persist long outcome text and prompt-contract instructions

**Files:**
- Modify: `copilot-workflows/src/types.ts`
- Modify: `copilot-workflows/src/script.ts`
- Test: `copilot-workflows/tests/unit/script.test.ts`

**Interfaces:**
- Produces: optional `outcomeText?: string` on workflow-agent progress entries.
- Produces: generated task prompts that contain a `## OUTCOME` contract.
- Consumers: Task 2/3 renderers use `agent.outcomeText ?? agent.resultPreview ?? agent.error`.

- [ ] **Step 1: Write failing persistence test**

Add to `copilot-workflows/tests/unit/script.test.ts`:

```ts
it("persists long outcomeText while keeping resultPreview compact", async () => {
  const long = [
    "## OUTCOME",
    "Status: completed",
    "Summary: Implemented the requested change.",
    "Evidence:",
    "- npm test passed",
    "Artifacts:",
    "- src/example.ts",
    "Next: none",
    "Details: " + "x".repeat(600),
  ].join("\n");
  const out = await executeWorkflowScript(
    "return await agent('do useful work', { label: 'executor' })",
    { backend: new StubAgentBackend([{ text: long, tokens: 10, toolCalls: 2 }]) },
  );
  const entry = out.progress.find((p) => p.type === "workflow_agent");
  if (entry?.type !== "workflow_agent") throw new Error("missing agent entry");
  expect(entry.outcomeText).toContain("## OUTCOME");
  expect(entry.outcomeText).toContain("Details: " + "x".repeat(100));
  expect(entry.resultPreview.length).toBeLessThanOrEqual(200);
});
```

- [ ] **Step 2: Run failing persistence test**

Run: `cd copilot-workflows && npm test -- tests/unit/script.test.ts -t "persists long outcomeText"`

Expected: FAIL because `outcomeText` is not in the schema/progress entry.

- [ ] **Step 3: Implement `outcomeText` schema and persistence**

In `copilot-workflows/src/types.ts`, add `outcomeText: z.string().optional()` to `WorkflowAgentProgressSchema`.

In `copilot-workflows/src/script.ts`, update completed fields:

```ts
const resultText =
  typeof out.result === "string" ? out.result : JSON.stringify(out.result);
const completedFields = {
  updatedAt: now,
  completedAt: now,
  durationMs: now - startedAt,
  tokens: out.tokens,
  toolCalls: out.toolCalls,
  retries: out.retries,
  ...(out.lastToolName ? { lastToolName: out.lastToolName } : {}),
  ...(out.lastToolSummary ? { lastToolSummary: out.lastToolSummary } : {}),
  ...(out.recentToolCalls ? { recentToolCalls: out.recentToolCalls } : {}),
  outcomeText: resultText.slice(0, 8_000),
  resultPreview: resultText.slice(0, 200),
};
```

- [ ] **Step 4: Verify persistence test passes**

Run: `cd copilot-workflows && npm test -- tests/unit/script.test.ts -t "persists long outcomeText"`

Expected: PASS.

- [ ] **Step 5: Write failing prompt-contract tests**

Add tests that inspect generated workflow/planner prompts where this repo builds agent prompts. If prompt generation is centralized in `planner.ts`, assert generated prompts contain:

```ts
expect(prompt).toContain("## OUTCOME");
expect(prompt).toContain("Status:");
expect(prompt).toContain("Summary:");
expect(prompt).toContain("Evidence:");
expect(prompt).toContain("Artifacts:");
expect(prompt).toContain("Next:");
```

For reviewer prompts, assert:

```ts
expect(prompt).toContain("Verdict: LGTM | BLOCKERS");
```

For verifier prompts, assert:

```ts
expect(prompt).toContain("Checks:");
```

- [ ] **Step 6: Run failing prompt-contract tests**

Run the smallest relevant test command, e.g. `cd copilot-workflows && npm test -- tests/unit/planner.test.ts tests/unit/script.test.ts -t "OUTCOME"`

Expected: FAIL because prompts do not contain the contract.

- [ ] **Step 7: Add prompt contract text**

Add this exact reusable contract string near workflow prompt construction:

```ts
const OUTCOME_CONTRACT = [
  "Return a final section named exactly `## OUTCOME`.",
  "Use these fields when applicable:",
  "Status: completed | blocked | failed | LGTM | needs_changes",
  "Summary: one sentence describing the terminal result",
  "Evidence: commands, files, PRs, metrics, or sources checked",
  "Artifacts: files, PRs, reports, or durable outputs created/touched; use none if none",
  "Next: required follow-up, or none",
  "Reviewer agents: include `Verdict: LGTM | BLOCKERS` and concrete blockers only.",
  "Verifier agents: include `Checks:` with pass/fail evidence.",
  "Executor agents: include `Changed:` and `Tests:` when changes were made.",
].join("\\n");
```

Append it to generated planner, executor, reviewer, verifier, and synthesizer prompts.

- [ ] **Step 8: Verify prompt-contract tests pass**

Run: `cd copilot-workflows && npm test -- tests/unit/planner.test.ts tests/unit/script.test.ts -t "OUTCOME"`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add copilot-workflows/src/types.ts copilot-workflows/src/script.ts copilot-workflows/tests/unit/script.test.ts copilot-workflows/tests/unit/planner.test.ts
git commit -m "feat(workflows): persist structured outcome text"
```

---

### Task 2: Add structured outcome parsing/rendering to terminal visibility

**Files:**
- Modify: `copilot-workflows/src/visibility.ts`
- Test: `copilot-workflows/tests/unit/visibility.test.ts`

**Interfaces:**
- Consumes: `AgentEntry.outcomeText?: string`.
- Produces: `detailBlock(agent)` output lines containing `Outcome · <kind>`, `Status`/`Verdict`, `Summary`, `Evidence`, `Artifacts`, `Next`, with token/elapsed line preserved.

- [ ] **Step 1: Write failing renderer tests**

Add cases:

```ts
it("renders reviewer blockers as verdict-first outcome", () => {
  const run = sampleRun({ status: "completed" });
  const agent = run.workflowProgress.find((p) => p.type === "workflow_agent");
  if (agent?.type !== "workflow_agent") throw new Error("not an agent");
  agent.label = "review:code";
  agent.outcomeText = [
    "## OUTCOME",
    "Verdict: BLOCKERS",
    "Status: needs_changes",
    "Summary: Two correctness blockers remain.",
    "Evidence:",
    "- Read src/a.ts",
    "Blockers:",
    "1. Missing retry on transient failure",
    "Artifacts: none",
    "Next: fix blockers and rerun review",
  ].join("\n");
  const detail = renderWorkflowDetail(run, { workflowId: "WF1" });
  expect(detail).toContain("Outcome · reviewer");
  expect(detail).toContain("Verdict: BLOCKERS");
  expect(detail).toContain("Status: needs_changes");
  expect(detail).toContain("Summary: Two correctness blockers remain.");
  expect(detail).toContain("Evidence:");
  expect(detail).toContain("Next: fix blockers and rerun review");
});
```

Add executor/verifier/synthesizer cases asserting `Changed:`, `Tests:`, `Checks:`, and final status render.

- [ ] **Step 2: Run failing renderer tests**

Run: `cd copilot-workflows && npm test -- tests/unit/visibility.test.ts -t "Outcome"`

Expected: FAIL because current output is a plain `Outcome:` blob.

- [ ] **Step 3: Implement parser helpers**

In `visibility.ts`, add:

```ts
const outcomeSource = (agent: AgentEntry): string =>
  agent.error ?? agent.outcomeText ?? agent.resultPreview ?? "";

const outcomeKind = (agent: AgentEntry): string => {
  const haystack = `${agent.phaseTitle ?? ""} ${agent.label} ${agent.promptPreview ?? ""}`.toLowerCase();
  if (haystack.includes("review") || haystack.includes("lgtm") || haystack.includes("blocker")) return "reviewer";
  if (haystack.includes("verify") || haystack.includes("test") || haystack.includes("checks:")) return "verifier";
  if (haystack.includes("synth") || haystack.includes("final")) return "synthesizer";
  if (haystack.includes("plan")) return "planner";
  if (haystack.includes("research")) return "researcher";
  if (haystack.includes("execute") || haystack.includes("implement") || haystack.includes("changed:")) return "executor";
  return "generic";
};

const fieldNames = ["Verdict", "Status", "Summary", "Evidence", "Blockers", "Checks", "Changed", "Tests", "Artifacts", "Next"];

const structuredOutcomeLines = (agent: AgentEntry): string[] => {
  if (agent.state === "running") return ["Outcome · running", "Status: running", "Summary: Still running…"];
  const source = outcomeSource(agent).trim();
  if (!source) return [`Outcome · ${outcomeKind(agent)}`, "Status: none", "Summary: no outcome yet"];
  const normalized = source.replace(/^## OUTCOME\\s*/i, "").trim();
  const lines = normalized.split(/\\r?\\n/).map((line) => line.trimEnd()).filter(Boolean);
  const picked: string[] = [];
  for (const name of fieldNames) {
    const idx = lines.findIndex((line) => line.toLowerCase().startsWith(`${name.toLowerCase()}:`));
    if (idx >= 0) {
      picked.push(lines[idx]);
      for (let i = idx + 1; i < lines.length && picked.length < 10; i++) {
        if (fieldNames.some((field) => lines[i].toLowerCase().startsWith(`${field.toLowerCase()}:`))) break;
        picked.push(`  ${truncate(lines[i], 180)}`);
      }
    }
  }
  const fallback = picked.length ? picked : lines.slice(0, 8).map((line) => truncate(line, 180));
  return [`Outcome · ${outcomeKind(agent)}`, ...fallback];
};
```

Replace `outcomeBlock` in `detailBlock` with `structuredOutcomeLines(agent)`.

- [ ] **Step 4: Verify renderer tests pass**

Run: `cd copilot-workflows && npm test -- tests/unit/visibility.test.ts -t "Outcome"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add copilot-workflows/src/visibility.ts copilot-workflows/tests/unit/visibility.test.ts
git commit -m "feat(workflows): render structured task outcomes"
```

---

### Task 3: Mirror structured outcomes in inline footer and canvas/browser UI

**Files:**
- Modify: `lib/workflow-ui-patch.js`
- Modify: `.github/extensions/workflow-ui/extension.mjs`
- Test: `tests/copilot-workflow-ui-patch.test.js`
- Test: `tests/copilot-workflow-inline-footer-uat.test.js`
- Test: `copilot-workflows/tests/unit/extension-ui.test.ts`

**Interfaces:**
- Consumes: `outcomeText` from run JSON.
- Produces: inline footer lines matching terminal renderer fields.
- Produces: browser/canvas HTML with status-first outcome sections.

- [ ] **Step 1: Write failing inline UAT outcome cases**

In `tests/copilot-workflow-inline-footer-uat.test.js`, seed four agents:

```js
agent(4, "review:code", "Review diff. Return either LGTM or blockers.", "Read", "src/a.ts", [
  "## OUTCOME",
  "Verdict: BLOCKERS",
  "Status: needs_changes",
  "Summary: Retry logic is missing.",
  "Evidence:",
  "- Read src/a.ts",
  "Blockers:",
  "1. Missing retry on transient failure",
  "Artifacts: none",
  "Next: fix retry",
].join("\n"))
```

Also add verifier with `Checks:`, executor with `Changed:`/`Tests:`, synthesizer with `Status:`/`Summary:`/`Next:`.

Assert visible agent detail contains `Outcome · reviewer`, `Verdict: BLOCKERS`, `Outcome · verifier`, `Checks:`, and token/elapsed line (`tok ·`, `tool call`) still appears.

- [ ] **Step 2: Run failing inline UAT**

Run: `node tests/copilot-workflow-inline-footer-uat.test.js`

Expected: FAIL because inline footer renders `Outcome:` blob.

- [ ] **Step 3: Write failing patch marker tests**

In `tests/copilot-workflow-ui-patch.test.js`, assert:

```js
assert(patched.includes("Outcome · "));
assert(patched.includes("outcomeText"));
assert(patched.includes("Verdict"));
assert(patched.includes("Checks"));
assert(patched.includes("Changed"));
assert(patched.includes("Tests"));
```

- [ ] **Step 4: Implement inline outcome helpers**

In `lib/workflow-ui-patch.js`, add minified/readable equivalents of:

```js
function outcomeSource(agent){return agent.error||agent.outcomeText||agent.resultPreview||""}
function outcomeKind(agent){let h=((agent.phaseTitle||"")+" "+agent.label+" "+(agent.promptPreview||"")).toLowerCase();if(h.includes("review")||h.includes("lgtm")||h.includes("blocker"))return"reviewer";if(h.includes("verify")||h.includes("test")||h.includes("checks:"))return"verifier";if(h.includes("synth")||h.includes("final"))return"synthesizer";if(h.includes("plan"))return"planner";if(h.includes("research"))return"researcher";if(h.includes("execute")||h.includes("implement")||h.includes("changed:"))return"executor";return"generic"}
function outcomeLines(agent){if(agent.state==="running")return["Outcome · running","Status: running","Summary: Still running…"];let src=outcomeSource(agent).trim();if(!src)return["Outcome · "+outcomeKind(agent),"Status: none","Summary: no outcome yet"];let fields=["Verdict","Status","Summary","Evidence","Blockers","Checks","Changed","Tests","Artifacts","Next"],lines=src.replace(/^## OUTCOME\\s*/i,"").split(/\\r?\\n/).map(line=>line.trimEnd()).filter(Boolean),out=[];for(let f of fields){let idx=lines.findIndex(line=>line.toLowerCase().startsWith(f.toLowerCase()+":"));if(idx>=0){out.push(lines[idx]);for(let i=idx+1;i<lines.length&&out.length<10;i++){if(fields.some(field=>lines[i].toLowerCase().startsWith(field.toLowerCase()+":")))break;out.push("  "+truncate(lines[i],180))}}}return["Outcome · "+outcomeKind(agent),...(out.length?out:lines.slice(0,8).map(line=>truncate(line,180)))]}
```

Replace existing `outcomeLines(agent)` in `detailLines()`.

- [ ] **Step 5: Implement browser/canvas outcome rendering**

In `.github/extensions/workflow-ui/extension.mjs`, update detail rendering from:

```js
'<b>Outcome</b><pre>' + trunc(selected?.error || selected?.resultPreview || 'none', 2000) + '</pre>'
```

to render parsed fields from `selected.outcomeText || selected.resultPreview`.

- [ ] **Step 6: Verify inline/canvas tests**

Run:

```bash
node tests/copilot-workflow-ui-patch.test.js
node bin/copilot-workflow-ui-patch --revert
node bin/copilot-workflow-ui-patch
node --check ~/.cache/copilot/pkg/linux-x64/1.0.63/app.js
node tests/copilot-workflow-inline-footer-uat.test.js
cd copilot-workflows && npm test -- tests/unit/extension-ui.test.ts
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/workflow-ui-patch.js .github/extensions/workflow-ui/extension.mjs tests/copilot-workflow-ui-patch.test.js tests/copilot-workflow-inline-footer-uat.test.js copilot-workflows/tests/unit/extension-ui.test.ts
git commit -m "feat(workflows): show structured outcomes in workflow UI"
```

---

### Task 4: Full verification and docs

**Files:**
- Modify: `copilot-workflows/README.md`

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: documented outcome contract and final verified patch.

- [ ] **Step 1: Update README**

Add a section:

```md
### Outcome contract

Workflow agents are prompted to end with `## OUTCOME` so task details can render status-first outcomes:

- `Status:` completed | blocked | failed | LGTM | needs_changes
- `Summary:` one sentence terminal result
- `Evidence:` commands/files/PRs/metrics/sources checked
- `Artifacts:` files/PRs/reports created or touched, or `none`
- `Next:` required follow-up, or `none`

Review agents add `Verdict: LGTM | BLOCKERS`; verifier agents add `Checks:`; executor agents add `Changed:` and `Tests:`. The UI keeps raw transcripts available and shows token count plus elapsed time in task details.
```

- [ ] **Step 2: Run full verification**

Run:

```bash
node --check ~/.cache/copilot/pkg/linux-x64/1.0.63/app.js
node tests/copilot-workflow-ui-patch.test.js
node tests/copilot-workflow-inline-footer-uat.test.js
cd copilot-workflows
npm run typecheck
npm test
npm run build
```

Expected: `workflow-ui-patch tests passed`, `inline workflow footer UAT passed`, 15 Vitest files pass, build exits 0.

- [ ] **Step 3: Request code review**

Use an Opus code-review agent with the current diff. Require review focus on:

- outcome contract completeness,
- parser false positives,
- inline patch safety,
- input isolation regressions,
- UAT coverage.

- [ ] **Step 4: Apply review feedback**

For any Critical/Important finding, write a failing test first, implement, and rerun targeted verification.

- [ ] **Step 5: Commit**

```bash
git add copilot-workflows/README.md
git commit -m "docs(workflows): document task outcome contract"
```

---

## Self-Review

- Spec coverage: plan covers prompt contract, long outcome persistence, terminal renderer, inline footer, canvas/browser UI, UATs, token count, and elapsed time.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: `outcomeText?: string` is the persisted field used by all renderers; existing `resultPreview` remains compact/backward-compatible.
- Scope: single cohesive feature focused on outcome display quality.
