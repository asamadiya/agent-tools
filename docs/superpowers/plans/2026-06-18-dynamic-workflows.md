# Dynamic Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a separate `copilot-workflows` runner that lets the assistant respond to inline `workflow: ...` requests by creating deterministic JS workflow files, launching isolated agents, and showing Claude Code-style progress, transcripts, resume, and output visibility.

**Architecture:** Add a new TypeScript package, `copilot-workflows`, beside `copilot-teams`. The package exposes an MCP server and a CLI wrapper over the same runner library; the runner owns workflow state, deterministic JS execution, isolated agent calls, progress, cancellation, and resume/cache semantics. The user-facing experience is Claude-like inline workflow orchestration; MCP/CLI are implementation surfaces.

**Tech Stack:** TypeScript ES2022, Node.js >=20, Vitest, MCP SDK, `execa`, `zod`, `proper-lockfile`, Node `vm`, JSONL state files, stub Copilot backend for deterministic tests.

## Global Constraints

- Default workflow agent model is GPT-5.5 with xhigh effort and 1.1M context; make this configurable globally, per workflow, per phase, and per agent.
- Workflows are separate from `copilot-teams`; do not reuse `copilot-teams` state, tmux layout, pane anchoring, or task records.
- The persisted workflow JS file is the canonical dynamic artifact and must start with `export const meta = { name, description, phases }`.
- Each `agent()` call gets its own fresh context. No implicit memory crosses workflow steps; only explicit return values do.
- Every workflow step must be visible by stable id, label, phase, state, model, effort, duration, tokens, retries, last tool, and preview.
- Generated workflows require configurable confirmation before execution; trusted automation may bypass by policy/flag.
- Tests must not call real models by default; use a deterministic stub backend. Real-model smoke tests must be opt-in and bounded.
- Do not create or send input to unrelated tmux panes during tests. Keep tests hermetic and clear `TMUX_PANE` like `copilot-teams/tests/setup.ts`.

---

## File Structure

Create a new sibling package:

```text
copilot-workflows/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    agent-runtime.ts
    cache.ts
    cli.ts
    ids.ts
    logger.ts
    planner.ts
    progress.ts
    runner.ts
    script.ts
    server.ts
    state.ts
    tools.ts
    types.ts
    visibility.ts
  tests/
    setup.ts
    unit/
      cache.test.ts
      planner.test.ts
      script.test.ts
      state.test.ts
      visibility.test.ts
    integration/
      runner.test.ts
      server.test.ts
      cli.test.ts
bin/
  copilot-workflow
  copilot-workflows-server
```

Responsibilities:

- `types.ts`: shared zod schemas, TypeScript types, default model config.
- `ids.ts`: deterministic id helpers for `runId`, `taskId`, `agentId`, and safe workflow slugs.
- `state.ts`: workflow state persistence, locks, atomic writes, journal/transcript append helpers.
- `script.ts`: meta extraction, deterministic validation, restricted JS runtime, and workflow globals.
- `agent-runtime.ts`: backend interface plus stub and Copilot subprocess backends.
- `cache.ts`: cache-key serialization and prior-run cache lookup.
- `runner.ts`: orchestration lifecycle: launch, run, status, output, stop, resume.
- `planner.ts`: turns `workflow: <goal>` into a generated JS workflow file when the assistant/tool caller does not provide one.
- `visibility.ts`: status tree/output formatting.
- `tools.ts`: MCP tool input schemas and handlers.
- `server.ts`: MCP server registration.
- `cli.ts`: CLI wrapper over the runner.
- `logger.ts` and `progress.ts`: small copies of the existing patterns in `copilot-teams`.

---

### Task 1: Package Scaffold, Shared Types, and IDs

**Files:**
- Create: `copilot-workflows/package.json`
- Create: `copilot-workflows/tsconfig.json`
- Create: `copilot-workflows/vitest.config.ts`
- Create: `copilot-workflows/tests/setup.ts`
- Create: `copilot-workflows/src/types.ts`
- Create: `copilot-workflows/src/ids.ts`
- Create: `copilot-workflows/src/logger.ts`
- Create: `copilot-workflows/src/progress.ts`
- Create: `bin/copilot-workflow`
- Create: `bin/copilot-workflows-server`

**Interfaces:**
- Produces: `DEFAULT_MODEL_CONFIG`, `WorkflowRunSchema`, `WorkflowProgressEntrySchema`, `AgentStepOptionsSchema`, `WorkflowStatus`, `WorkflowRun`, `WorkflowProgressEntry`, `ModelConfig`.
- Produces: `newRunId(): string`, `newTaskId(): string`, `newAgentId(): string`, `slugifyWorkflowName(name: string): string`.
- Produces: `ProgressReporter = (progress: number, total?: number, message?: string) => Promise<void>`.

- [ ] **Step 1: Write failing type and id tests**

Create `copilot-workflows/tests/unit/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_CONFIG,
  WorkflowProgressEntrySchema,
  WorkflowRunSchema,
} from "../../src/types.js";
import { newAgentId, newRunId, newTaskId, slugifyWorkflowName } from "../../src/ids.js";

describe("workflow shared types", () => {
  it("uses GPT-5.5 xhigh 1.1M as the default model config", () => {
    expect(DEFAULT_MODEL_CONFIG).toEqual({
      model: "gpt-5.5",
      effort: "xhigh",
      contextWindow: 1_100_000,
    });
  });

  it("validates a minimal completed run record", () => {
    const parsed = WorkflowRunSchema.parse({
      runId: "wf_abc123",
      taskId: "w123456789",
      workflowName: "demo",
      status: "completed",
      script: "export const meta = { name: 'demo', description: 'Demo' }",
      scriptPath: "/tmp/demo.js",
      transcriptDir: "/tmp/transcripts",
      args: { topic: "x" },
      resumeFromRunId: "wf_prior",
      budgetTokens: 10_000,
      defaultModel: "gpt-5.5",
      defaultEffort: "xhigh",
      defaultContextWindow: 1_100_000,
      phases: [],
      workflowProgress: [],
      cacheResults: [],
      result: { ok: true },
      error: null,
      agentCount: 0,
      totalTokens: 0,
      totalToolCalls: 0,
      durationMs: 10,
      createdAt: "2026-06-18T00:00:00.000Z",
      startedAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z",
      completedAt: "2026-06-18T00:00:00.010Z",
    });
    expect(parsed.status).toBe("completed");
  });

  it("validates a running agent progress entry", () => {
    expect(
      WorkflowProgressEntrySchema.parse({
        type: "workflow_agent",
        index: 1,
        stepId: "step_1",
        label: "read:README",
        phaseIndex: 1,
        phaseTitle: "Read",
        agentId: "agent-a1",
        model: "gpt-5.5",
        effort: "xhigh",
        contextWindow: 1_100_000,
        state: "running",
        startedAt: 1000,
        updatedAt: 1001,
        attempt: 1,
        tokens: 0,
        toolCalls: 0,
        retries: 0,
      }),
    ).toMatchObject({ label: "read:README", state: "running" });
  });
});

describe("workflow ids", () => {
  it("creates recognizable ids", () => {
    expect(newRunId()).toMatch(/^wf_[a-f0-9]{8}-[a-f0-9]{3}$/);
    expect(newTaskId()).toMatch(/^w[a-z0-9]{8,}$/);
    expect(newAgentId()).toMatch(/^agent-[a-f0-9]{16}$/);
  });

  it("slugifies names for persisted script filenames", () => {
    expect(slugifyWorkflowName("Read README + package.json!")).toBe("read-readme-package-json");
    expect(slugifyWorkflowName("___")).toBe("workflow");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd copilot-workflows && npm test -- tests/unit/types.test.ts`

Expected: FAIL because the package and source files do not exist yet.

- [ ] **Step 3: Create package scaffold**

Create `copilot-workflows/package.json`:

```json
{
  "name": "copilot-workflows",
  "version": "0.1.0",
  "description": "Dynamic workflow runner for GitHub Copilot CLI agents.",
  "type": "module",
  "private": true,
  "engines": {
    "node": ">=20"
  },
  "main": "dist/server.js",
  "bin": {
    "copilot-workflows-server": "dist/server.js",
    "copilot-workflow": "dist/cli.js"
  },
  "scripts": {
    "build": "tsc -p .",
    "start": "node dist/server.js",
    "test": "vitest run",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "typecheck": "tsc -p . --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.4",
    "execa": "^9.5.2",
    "pino": "^9.5.0",
    "proper-lockfile": "^4.1.2",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "@types/proper-lockfile": "^4.1.4",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

Create `copilot-workflows/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": false,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": false,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules", "tests"]
}
```

Create `copilot-workflows/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
```

Create `copilot-workflows/tests/setup.ts`:

```ts
delete process.env.TMUX_PANE;
```

- [ ] **Step 4: Add shared types**

Create `copilot-workflows/src/types.ts`:

```ts
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

export const JsonSchemaSchema: z.ZodType<Record<string, unknown>> = z.record(z.string(), z.unknown());

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
  permissions: z.enum(["default", "auto", "plan", "dontAsk", "bypassPermissions"]).optional(),
  allowedTools: z.array(z.string()).optional(),
  deniedTools: z.array(z.string()).optional(),
  isolation: z.enum(["none", "worktree"]).default("none").optional(),
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
  cacheResults: z.array(z.object({
    cacheKey: z.string(),
    result: z.unknown(),
    progress: WorkflowProgressEntrySchema,
  })).default([]),
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
```

- [ ] **Step 5: Add id, logger, progress, and bin wrappers**

Create `copilot-workflows/src/ids.ts`:

```ts
import { randomBytes } from "node:crypto";

const hex = (bytes: number): string => randomBytes(bytes).toString("hex");

export const newRunId = (): string => `wf_${hex(4)}-${hex(2).slice(0, 3)}`;

export const newTaskId = (): string => `w${randomBytes(6).toString("base64url").toLowerCase()}`;

export const newAgentId = (): string => `agent-${hex(8)}`;

export const slugifyWorkflowName = (name: string): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "workflow";
};
```

Create `copilot-workflows/src/logger.ts`:

```ts
import pino from "pino";

export const logger = pino({
  name: "copilot-workflows",
  level: process.env.COPILOT_WORKFLOWS_LOG_LEVEL ?? "info",
});
```

Create `copilot-workflows/src/progress.ts`:

```ts
export type { ProgressReporter } from "./types.js";
export { noopProgress } from "./types.js";
```

Create `bin/copilot-workflow`:

```sh
#!/usr/bin/env bash
set -euo pipefail
exec node "$(dirname "$0")/../copilot-workflows/dist/cli.js" "$@"
```

Create `bin/copilot-workflows-server`:

```sh
#!/usr/bin/env bash
set -euo pipefail
exec node "$(dirname "$0")/../copilot-workflows/dist/server.js" "$@"
```

Run: `chmod +x bin/copilot-workflow bin/copilot-workflows-server`

- [ ] **Step 6: Install package dependencies**

Run: `cd copilot-workflows && npm install`

Expected: `package-lock.json` is created and install exits 0.

- [ ] **Step 7: Run test to verify it passes**

Run: `cd copilot-workflows && npm test -- tests/unit/types.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add bin/copilot-workflow bin/copilot-workflows-server copilot-workflows
git commit -m "feat: scaffold copilot workflows package"
```

---

### Task 2: State Store, Journals, and Transcript Persistence

**Files:**
- Create: `copilot-workflows/src/state.ts`
- Create: `copilot-workflows/tests/unit/state.test.ts`
- Modify: `copilot-workflows/src/types.ts`

**Interfaces:**
- Consumes: `WorkflowRun`, `WorkflowRunSchema`, `WorkflowProgressEntry`.
- Produces: `workflowPaths(opts): WorkflowPaths`
- Produces: `createInitialRun(input): Promise<WorkflowRun>`
- Produces: `loadRun(runId, opts): WorkflowRun`
- Produces: `saveRun(run, opts): void`
- Produces: `listRuns(opts): WorkflowRun[]`
- Produces: `withRunLock(runId, fn, opts): Promise<T>`
- Produces: `appendJournal(runId, event, opts): void`
- Produces: `writeAgentTranscript(runId, agentId, entries, opts): void`

- [ ] **Step 1: Write failing state tests**

Create `copilot-workflows/tests/unit/state.test.ts`:

```ts
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendJournal,
  createInitialRun,
  listRuns,
  loadRun,
  saveRun,
  withRunLock,
  workflowPaths,
  writeAgentTranscript,
} from "../../src/state.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cw-state-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("workflow state", () => {
  it("creates a run with script, run record, transcript dir, and defaults", async () => {
    const run = await createInitialRun({
      root,
      workflowName: "demo-flow",
      script: "export const meta = { name: 'demo-flow', description: 'Demo' }",
      args: { topic: "readme" },
    });
    const paths = workflowPaths({ root, runId: run.runId, workflowName: run.workflowName });

    expect(run.status).toBe("queued");
    expect(run.defaultModel).toBe("gpt-5.5");
    expect(run.defaultEffort).toBe("xhigh");
    expect(run.defaultContextWindow).toBe(1_100_000);
    expect(run.scriptPath).toBe(paths.scriptPath);
    expect(run.transcriptDir).toBe(paths.transcriptDir);
    expect(readFileSync(paths.scriptPath, "utf8")).toContain("export const meta");
    expect(loadRun(run.runId, { root }).runId).toBe(run.runId);
  });

  it("saves and reloads progress entries", async () => {
    const run = await createInitialRun({
      root,
      workflowName: "progress-flow",
      script: "export const meta = { name: 'progress-flow', description: 'Demo' }",
    });
    run.status = "running";
    run.workflowProgress.push({ type: "workflow_phase", index: 1, title: "Read" });
    saveRun(run, { root });

    expect(loadRun(run.runId, { root }).workflowProgress).toEqual([
      { type: "workflow_phase", index: 1, title: "Read" },
    ]);
  });

  it("lists runs from newest to oldest", async () => {
    const first = await createInitialRun({
      root,
      workflowName: "first-flow",
      script: "export const meta = { name: 'first-flow', description: 'Demo' }",
    });
    const second = await createInitialRun({
      root,
      workflowName: "second-flow",
      script: "export const meta = { name: 'second-flow', description: 'Demo' }",
    });
    expect(listRuns({ root }).map((r) => r.runId)).toEqual([second.runId, first.runId]);
  });

  it("appends journal and transcript JSONL entries", async () => {
    const run = await createInitialRun({
      root,
      workflowName: "journal-flow",
      script: "export const meta = { name: 'journal-flow', description: 'Demo' }",
    });
    appendJournal(run.runId, { type: "started", stepId: "step_1" }, { root });
    writeAgentTranscript(
      run.runId,
      "agent-a",
      [{ role: "assistant", content: "ok" }],
      { root },
    );

    const paths = workflowPaths({ root, runId: run.runId, workflowName: run.workflowName });
    expect(readFileSync(paths.journalPath, "utf8")).toContain("\"started\"");
    expect(readFileSync(join(paths.transcriptDir, "agent-a.jsonl"), "utf8")).toContain("\"ok\"");
  });

  it("serializes concurrent mutations with a per-run lock", async () => {
    const run = await createInitialRun({
      root,
      workflowName: "lock-flow",
      script: "export const meta = { name: 'lock-flow', description: 'Demo' }",
    });
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        withRunLock(
          run.runId,
          async () => {
            const current = loadRun(run.runId, { root });
            current.totalToolCalls += 1;
            appendJournal(run.runId, { type: "increment", index: i }, { root });
            saveRun(current, { root });
          },
          { root },
        ),
      ),
    );
    expect(loadRun(run.runId, { root }).totalToolCalls).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd copilot-workflows && npm test -- tests/unit/state.test.ts`

Expected: FAIL because `src/state.ts` does not exist.

- [ ] **Step 3: Implement state persistence**

Create `copilot-workflows/src/state.ts`:

```ts
import {
  appendFileSync,
  closeSync,
  existsSync,
  readdirSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { newRunId, newTaskId, slugifyWorkflowName } from "./ids.js";
import {
  DEFAULT_MODEL_CONFIG,
  WorkflowRunSchema,
  type WorkflowRun,
} from "./types.js";

const DEFAULT_ROOT = join(homedir(), ".copilot", "workflows");

export interface StateOptions {
  root?: string;
}

export interface WorkflowPathInput {
  root?: string;
  runId: string;
  workflowName: string;
}

export interface WorkflowPaths {
  root: string;
  runsDir: string;
  scriptsDir: string;
  transcriptDir: string;
  runPath: string;
  scriptPath: string;
  journalPath: string;
}

const nowIso = (): string => new Date().toISOString();

const ensureDir = (path: string): void => mkdirSync(path, { recursive: true });

const atomicWrite = (path: string, content: string): void => {
  ensureDir(dirname(path));
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, content);
  const fd = openSync(tmp, "r");
  try {
    // fsyncSync is intentionally avoided for speed; rename is atomic on the same filesystem.
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
};

export const workflowPaths = (input: WorkflowPathInput): WorkflowPaths => {
  const root = input.root ?? DEFAULT_ROOT;
  const runsDir = join(root, "runs");
  const scriptsDir = join(root, "scripts");
  const transcriptDir = join(root, "transcripts", input.runId);
  const slug = slugifyWorkflowName(input.workflowName);
  return {
    root,
    runsDir,
    scriptsDir,
    transcriptDir,
    runPath: join(runsDir, `${input.runId}.json`),
    scriptPath: join(scriptsDir, `${slug}-${input.runId}.js`),
    journalPath: join(transcriptDir, "journal.jsonl"),
  };
};

export interface CreateInitialRunInput extends StateOptions {
  workflowName: string;
  script: string;
  args?: unknown;
  phases?: WorkflowRun["phases"];
  resumeFromRunId?: string;
  budgetTokens?: number;
  defaultModel?: string;
  defaultEffort?: string;
  defaultContextWindow?: number;
}

export const createInitialRun = async (input: CreateInitialRunInput): Promise<WorkflowRun> => {
  const runId = newRunId();
  const paths = workflowPaths({ root: input.root, runId, workflowName: input.workflowName });
  ensureDir(paths.runsDir);
  ensureDir(paths.scriptsDir);
  ensureDir(paths.transcriptDir);
  writeFileSync(paths.scriptPath, input.script);
  const now = nowIso();
  const run: WorkflowRun = {
    runId,
    taskId: newTaskId(),
    workflowName: input.workflowName,
    status: "queued",
    script: input.script,
    scriptPath: paths.scriptPath,
    transcriptDir: paths.transcriptDir,
    ...(input.args !== undefined ? { args: input.args } : {}),
    ...(input.resumeFromRunId ? { resumeFromRunId: input.resumeFromRunId } : {}),
    ...(input.budgetTokens ? { budgetTokens: input.budgetTokens } : {}),
    defaultModel: input.defaultModel ?? DEFAULT_MODEL_CONFIG.model,
    defaultEffort: input.defaultEffort ?? DEFAULT_MODEL_CONFIG.effort,
    defaultContextWindow: input.defaultContextWindow ?? DEFAULT_MODEL_CONFIG.contextWindow,
    phases: input.phases ?? [],
    workflowProgress: [],
    cacheResults: [],
    result: null,
    error: null,
    agentCount: 0,
    totalTokens: 0,
    totalToolCalls: 0,
    durationMs: 0,
    createdAt: now,
    startedAt: null,
    updatedAt: now,
    completedAt: null,
  };
  saveRun(run, { root: input.root });
  return run;
};

export const loadRun = (runId: string, opts: StateOptions = {}): WorkflowRun => {
  const root = opts.root ?? DEFAULT_ROOT;
  const path = join(root, "runs", `${runId}.json`);
  const raw = readFileSync(path, "utf8");
  return WorkflowRunSchema.parse(JSON.parse(raw));
};

export const saveRun = (run: WorkflowRun, opts: StateOptions = {}): void => {
  const paths = workflowPaths({ root: opts.root, runId: run.runId, workflowName: run.workflowName });
  const next = WorkflowRunSchema.parse({ ...run, updatedAt: nowIso() });
  atomicWrite(paths.runPath, `${JSON.stringify(next, null, 2)}\n`);
};

export const listRuns = (opts: StateOptions = {}): WorkflowRun[] => {
  const root = opts.root ?? DEFAULT_ROOT;
  const runsDir = join(root, "runs");
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => WorkflowRunSchema.parse(JSON.parse(readFileSync(join(runsDir, f), "utf8"))))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
};

export const withRunLock = async <T>(
  runId: string,
  fn: () => Promise<T> | T,
  opts: StateOptions = {},
): Promise<T> => {
  const root = opts.root ?? DEFAULT_ROOT;
  const lockDir = join(root, "locks");
  ensureDir(lockDir);
  const lockTarget = join(lockDir, `${runId}.lock`);
  if (!existsSync(lockTarget)) writeFileSync(lockTarget, "");
  const release = await lockfile.lock(lockTarget, {
    stale: 30_000,
    realpath: false,
    retries: { retries: 20, minTimeout: 20, maxTimeout: 250 },
  });
  try {
    return await fn();
  } finally {
    await release();
  }
};

export const appendJournal = (runId: string, event: unknown, opts: StateOptions = {}): void => {
  const run = loadRun(runId, opts);
  const paths = workflowPaths({ root: opts.root, runId, workflowName: run.workflowName });
  ensureDir(paths.transcriptDir);
  appendFileSync(paths.journalPath, `${JSON.stringify(event)}\n`);
};

export const writeAgentTranscript = (
  runId: string,
  agentId: string,
  entries: unknown[],
  opts: StateOptions = {},
): void => {
  const run = loadRun(runId, opts);
  const paths = workflowPaths({ root: opts.root, runId, workflowName: run.workflowName });
  ensureDir(paths.transcriptDir);
  const path = join(paths.transcriptDir, `${agentId}.jsonl`);
  for (const entry of entries) {
    appendFileSync(path, `${JSON.stringify(entry)}\n`);
  }
};
```

- [ ] **Step 4: Run tests**

Run: `cd copilot-workflows && npm test -- tests/unit/state.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add copilot-workflows/src/state.ts copilot-workflows/tests/unit/state.test.ts copilot-workflows/src/types.ts
git commit -m "feat: add workflow state store"
```

---

### Task 3: Workflow Script Meta Parser and Determinism Guard

**Files:**
- Create: `copilot-workflows/src/script.ts`
- Create: `copilot-workflows/tests/unit/script.test.ts`

**Interfaces:**
- Produces: `extractWorkflowMeta(script: string): WorkflowMeta`
- Produces: `stripMetaExport(script: string): string`
- Produces: `validateDeterministicScript(script: string): void`
- Produces: `inspectWorkflowScript(script: string): WorkflowInspection`

- [ ] **Step 1: Write failing script parser tests**

Create `copilot-workflows/tests/unit/script.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  extractWorkflowMeta,
  inspectWorkflowScript,
  stripMetaExport,
  validateDeterministicScript,
} from "../../src/script.js";

const VALID = `
export const meta = {
  name: 'readme-check',
  description: 'Read README and summarize',
  phases: [{ title: 'Read', detail: 'read files' }],
}

phase('Read')
return await agent('read README', { label: 'read:README' })
`;

describe("workflow script parser", () => {
  it("extracts pure literal meta and strips the export", () => {
    expect(extractWorkflowMeta(VALID)).toEqual({
      name: "readme-check",
      description: "Read README and summarize",
      phases: [{ title: "Read", detail: "read files" }],
    });
    expect(stripMetaExport(VALID)).not.toContain("export const meta");
  });

  it("rejects non-literal meta before runtime", () => {
    expect(() =>
      extractWorkflowMeta("const name = 'x'; export const meta = { name, description: 'bad' }"),
    ).toThrow(/pure literal/i);
    expect(() =>
      extractWorkflowMeta("export const meta = { ...x, name: 'x', description: 'bad' }"),
    ).toThrow(/pure literal/i);
    expect(() =>
      extractWorkflowMeta("export const meta = { name: makeName(), description: 'bad' }"),
    ).toThrow(/pure literal/i);
    expect(() =>
      extractWorkflowMeta("export const meta = { name: `x`, description: 'bad' }"),
    ).toThrow(/pure literal/i);
  });

  it("rejects deterministic hazards", () => {
    expect(() => validateDeterministicScript(`${VALID}\nDate.now()`)).toThrow(/Date\.now/);
    expect(() => validateDeterministicScript(`${VALID}\nMath.random()`)).toThrow(/Math\.random/);
    expect(() => validateDeterministicScript(`${VALID}\nnew Date()`)).toThrow(/new Date/);
  });

  it("returns inspection errors without throwing", () => {
    const out = inspectWorkflowScript("export const meta = { name: makeName(), description: 'bad' }");
    expect(out.valid).toBe(false);
    expect(out.errors.join("\n")).toMatch(/pure literal/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd copilot-workflows && npm test -- tests/unit/script.test.ts`

Expected: FAIL because `src/script.ts` does not exist.

- [ ] **Step 3: Implement parser and deterministic validation**

Create `copilot-workflows/src/script.ts` with this implementation:

```ts
import vm from "node:vm";
import { WorkflowMetaSchema, type WorkflowMeta } from "./types.js";

export interface WorkflowInspection {
  valid: boolean;
  meta: WorkflowMeta | null;
  errors: string[];
  warnings: string[];
}

const META_RE = /export\s+const\s+meta\s*=\s*({[\s\S]*?\n})\s*;?/m;

const rejectNonLiteralMeta = (literal: string): void => {
  const forbidden = [
    { re: /\.\.\./, name: "spread" },
    { re: /`/, name: "template string" },
    { re: /\b[a-zA-Z_$][\w$]*\s*\(/, name: "function call" },
  ];
  for (const f of forbidden) {
    if (f.re.test(literal)) throw new Error(`meta must be a pure literal; found ${f.name}`);
  }
  const withoutKeysAndStrings = literal
    .replace(/(['"])(?:\\.|(?!\1).)*\1\s*:/g, "")
    .replace(/[a-zA-Z_$][\w$]*\s*:/g, "")
    .replace(/(['"])(?:\\.|(?!\1).)*\1/g, "")
    .replace(/\b(true|false|null)\b/g, "");
  if (/[a-zA-Z_$][\w$]*/.test(withoutKeysAndStrings)) {
    throw new Error("meta must be a pure literal; found identifier reference");
  }
};

export const extractWorkflowMeta = (script: string): WorkflowMeta => {
  const match = META_RE.exec(script);
  if (!match?.[1]) throw new Error("workflow script must start with export const meta = { ... }");
  const literal = match[1];
  rejectNonLiteralMeta(literal);
  const context = vm.createContext(Object.freeze({}));
  const parsed = vm.runInContext(`(${literal})`, context, { timeout: 1000 });
  return WorkflowMetaSchema.parse(parsed);
};

export const stripMetaExport = (script: string): string => script.replace(META_RE, "").trim();

export const validateDeterministicScript = (script: string): void => {
  const checks = [
    { re: /\bDate\.now\s*\(/, name: "Date.now" },
    { re: /\bMath\.random\s*\(/, name: "Math.random" },
    { re: /\bnew\s+Date\s*\(\s*\)/, name: "new Date()" },
    { re: /\brequire\s*\(/, name: "require()" },
    { re: /\bimport\s*\(/, name: "dynamic import()" },
  ];
  for (const check of checks) {
    if (check.re.test(script)) throw new Error(`workflow script uses nondeterministic or unavailable API: ${check.name}`);
  }
};

export const inspectWorkflowScript = (script: string): WorkflowInspection => {
  const errors: string[] = [];
  let meta: WorkflowMeta | null = null;
  try {
    meta = extractWorkflowMeta(script);
    validateDeterministicScript(script);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  return { valid: errors.length === 0, meta, errors, warnings: [] };
};
```

- [ ] **Step 4: Run tests**

Run: `cd copilot-workflows && npm test -- tests/unit/script.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add copilot-workflows/src/script.ts copilot-workflows/tests/unit/script.test.ts
git commit -m "feat: parse workflow scripts"
```

---

### Task 4: Agent Runtime, Stub Backend, and Schema Validation

**Files:**
- Create: `copilot-workflows/src/agent-runtime.ts`
- Create: `copilot-workflows/tests/unit/agent-runtime.test.ts`
- Modify: `copilot-workflows/src/types.ts`

**Interfaces:**
- Produces: `AgentBackend`, `AgentRunInput`, `AgentRunOutput`.
- Produces: `StubAgentBackend`.
- Produces: `validateJsonSchemaResult(result, schema): unknown`.
- Produces: `runAgentWithSchemaRetry(input, backend, opts): Promise<AgentRunOutput>`.

- [ ] **Step 1: Write failing agent runtime tests**

Create `copilot-workflows/tests/unit/agent-runtime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  StubAgentBackend,
  runAgentWithSchemaRetry,
  validateJsonSchemaResult,
} from "../../src/agent-runtime.js";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["summary"],
  properties: { summary: { type: "string" } },
};

describe("agent runtime", () => {
  it("returns text when no schema is provided", async () => {
    const backend = new StubAgentBackend([{ text: "plain response", tokens: 12, toolCalls: 1 }]);
    const out = await runAgentWithSchemaRetry(
      { prompt: "say hi", stepId: "step_1", agentId: "agent-a", model: "gpt-5.5", effort: "xhigh", contextWindow: 1_100_000 },
      backend,
      { maxRetries: 1 },
    );
    expect(out.result).toBe("plain response");
    expect(out.tokens).toBe(12);
  });

  it("validates structured output against a small JSON schema", () => {
    expect(validateJsonSchemaResult({ summary: "ok" }, schema)).toEqual({ summary: "ok" });
    expect(() => validateJsonSchemaResult({ summary: 1 }, schema)).toThrow(/summary/);
    expect(() => validateJsonSchemaResult({ summary: "ok", extra: true }, schema)).toThrow(/additional/i);
  });

  it("retries malformed structured output and succeeds", async () => {
    const backend = new StubAgentBackend([
      { text: "not json", tokens: 3, toolCalls: 1 },
      { text: JSON.stringify({ summary: "ok" }), tokens: 4, toolCalls: 1 },
    ]);
    const out = await runAgentWithSchemaRetry(
      { prompt: "summarize", stepId: "step_1", agentId: "agent-a", model: "gpt-5.5", effort: "xhigh", contextWindow: 1_100_000, schema },
      backend,
      { maxRetries: 2 },
    );
    expect(out.result).toEqual({ summary: "ok" });
    expect(out.retries).toBe(1);
  });

  it("fails cleanly when schema retries are exhausted", async () => {
    const backend = new StubAgentBackend([
      { text: JSON.stringify({ summary: 1 }), tokens: 3, toolCalls: 1 },
      { text: JSON.stringify({ nope: "x" }), tokens: 4, toolCalls: 1 },
    ]);
    await expect(
      runAgentWithSchemaRetry(
        { prompt: "summarize", stepId: "step_1", agentId: "agent-a", model: "gpt-5.5", effort: "xhigh", contextWindow: 1_100_000, schema },
        backend,
        { maxRetries: 1 },
      ),
    ).rejects.toThrow(/schema validation failed/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd copilot-workflows && npm test -- tests/unit/agent-runtime.test.ts`

Expected: FAIL because `src/agent-runtime.ts` does not exist.

- [ ] **Step 3: Implement stub backend and schema validation**

Create `copilot-workflows/src/agent-runtime.ts`:

```ts
import { execa } from "execa";

export interface AgentRunInput {
  prompt: string;
  stepId: string;
  agentId: string;
  model: string;
  effort: string;
  contextWindow: number;
  schema?: Record<string, unknown>;
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

const typeName = (v: unknown): string => Array.isArray(v) ? "array" : typeof v;

export const validateJsonSchemaResult = (result: unknown, schema: Record<string, unknown>): unknown => {
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
    const props = schema.properties && typeof schema.properties === "object"
      ? schema.properties as Record<string, Record<string, unknown>>
      : {};
    for (const [key, prop] of Object.entries(props)) {
      if (!(key in obj)) continue;
      if (prop.type && typeName(obj[key]) !== prop.type) {
        throw new Error(`schema validation failed: property ${key} expected ${prop.type}, got ${typeName(obj[key])}`);
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
  throw new Error(`schema validation failed after ${opts.maxRetries + 1} attempt(s): ${lastError?.message ?? "unknown error"}`);
};

export class CopilotPrintBackend implements AgentBackend {
  constructor(private readonly binary = "copilot") {}

  async run(input: AgentRunInput): Promise<BackendRawOutput> {
    const result = await execa(
      this.binary,
      [
        "--model",
        input.model,
        "--effort",
        input.effort,
        "-p",
        input.prompt,
        "-s",
      ],
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
```

- [ ] **Step 4: Run tests**

Run: `cd copilot-workflows && npm test -- tests/unit/agent-runtime.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add copilot-workflows/src/agent-runtime.ts copilot-workflows/tests/unit/agent-runtime.test.ts
git commit -m "feat: add workflow agent runtime"
```

---

### Task 5: Cache Keys, Runtime Globals, Parallel, Pipeline, and Budget

**Files:**
- Create: `copilot-workflows/src/cache.ts`
- Modify: `copilot-workflows/src/script.ts`
- Create: `copilot-workflows/tests/unit/cache.test.ts`
- Add tests to: `copilot-workflows/tests/unit/script.test.ts`

**Interfaces:**
- Produces: `agentCacheKey(prompt, opts, args): string`
- Produces: `WorkflowRuntimeContext`
- Produces: `executeWorkflowScript(script, context): Promise<unknown>`
- Produces runtime globals: `agent`, `parallel`, `pipeline`, `phase`, `log`, `args`, `budget`.

- [ ] **Step 1: Write failing cache tests**

Create `copilot-workflows/tests/unit/cache.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { agentCacheKey } from "../../src/cache.js";

describe("workflow cache keys", () => {
  it("is stable for same prompt, opts, and args", () => {
    const a = agentCacheKey("read README", { label: "read", model: "gpt-5.5" }, { topic: "x" });
    const b = agentCacheKey("read README", { model: "gpt-5.5", label: "read" }, { topic: "x" });
    expect(a).toBe(b);
  });

  it("changes when prompt, schema, model, effort, label, phase, or args change", () => {
    const base = agentCacheKey("p", { label: "l", phase: "A", model: "gpt-5.5", effort: "xhigh" }, { a: 1 });
    expect(agentCacheKey("p2", { label: "l", phase: "A", model: "gpt-5.5", effort: "xhigh" }, { a: 1 })).not.toBe(base);
    expect(agentCacheKey("p", { label: "l2", phase: "A", model: "gpt-5.5", effort: "xhigh" }, { a: 1 })).not.toBe(base);
    expect(agentCacheKey("p", { label: "l", phase: "B", model: "gpt-5.5", effort: "xhigh" }, { a: 1 })).not.toBe(base);
    expect(agentCacheKey("p", { label: "l", phase: "A", model: "other", effort: "xhigh" }, { a: 1 })).not.toBe(base);
    expect(agentCacheKey("p", { label: "l", phase: "A", model: "gpt-5.5", effort: "high" }, { a: 1 })).not.toBe(base);
    expect(agentCacheKey("p", { label: "l", phase: "A", model: "gpt-5.5", effort: "xhigh" }, { a: 2 })).not.toBe(base);
  });
});
```

- [ ] **Step 2: Add failing runtime tests**

Append to `copilot-workflows/tests/unit/script.test.ts`:

```ts
import { StubAgentBackend } from "../../src/agent-runtime.js";
import { executeWorkflowScript } from "../../src/script.js";

describe("workflow runtime globals", () => {
  it("runs agent(), phase(), log(), args, and budget", async () => {
    const script = `
export const meta = { name: 'runtime', description: 'Runtime test', phases: [{ title: 'Read' }] }
phase('Read')
log('starting')
const one = await agent('hello ' + args.topic, { label: 'a' })
return { one, remaining: budget.remaining() }
`;
    const out = await executeWorkflowScript(script, {
      args: { topic: "world" },
      backend: new StubAgentBackend([{ text: "ok", tokens: 10, toolCalls: 1 }]),
      defaultModel: "gpt-5.5",
      defaultEffort: "xhigh",
      defaultContextWindow: 1_100_000,
      maxRetries: 0,
      budgetTokens: 100,
    });
    expect(out.result).toEqual({ one: "ok", remaining: 90 });
    expect(out.progress.some((p) => p.type === "workflow_phase")).toBe(true);
    expect(out.progress.some((p) => p.type === "workflow_log")).toBe(true);
    expect(out.progress.some((p) => p.type === "workflow_agent")).toBe(true);
  });

  it("parallel preserves order and converts thrown thunks to null", async () => {
    const script = `
export const meta = { name: 'parallel', description: 'Parallel test' }
const out = await parallel([
  () => agent('a', { label: 'a' }),
  () => { throw new Error('boom') },
  () => agent('b', { label: 'b' }),
])
return out
`;
    const out = await executeWorkflowScript(script, {
      backend: new StubAgentBackend([
        { text: "A", tokens: 1, toolCalls: 1 },
        { text: "B", tokens: 1, toolCalls: 1 },
      ]),
      defaultModel: "gpt-5.5",
      defaultEffort: "xhigh",
      defaultContextWindow: 1_100_000,
      maxRetries: 0,
    });
    expect(out.result).toEqual(["A", null, "B"]);
  });

  it("pipeline drops only the failed item", async () => {
    const script = `
export const meta = { name: 'pipe', description: 'Pipeline test' }
return await pipeline(
  ['a', 'bad', 'b'],
  async (item) => item === 'bad' ? (() => { throw new Error('bad item') })() : agent('stage1 ' + item, { label: 's1:' + item }),
  async (prev, original) => agent('stage2 ' + original + ':' + prev, { label: 's2:' + original }),
)
`;
    const out = await executeWorkflowScript(script, {
      backend: new StubAgentBackend([
        { text: "A1", tokens: 1, toolCalls: 1 },
        { text: "A2", tokens: 1, toolCalls: 1 },
        { text: "B1", tokens: 1, toolCalls: 1 },
        { text: "B2", tokens: 1, toolCalls: 1 },
      ]),
      defaultModel: "gpt-5.5",
      defaultEffort: "xhigh",
      defaultContextWindow: 1_100_000,
      maxRetries: 0,
    });
    expect(out.result).toEqual(["A2", null, "B2"]);
  });

  it("throws when budget is exceeded", async () => {
    const script = `
export const meta = { name: 'budget', description: 'Budget test' }
await agent('too much', { label: 'a' })
return true
`;
    await expect(
      executeWorkflowScript(script, {
        backend: new StubAgentBackend([{ text: "A", tokens: 101, toolCalls: 1 }]),
        defaultModel: "gpt-5.5",
        defaultEffort: "xhigh",
        defaultContextWindow: 1_100_000,
        maxRetries: 0,
        budgetTokens: 100,
      }),
    ).rejects.toThrow(/budget exceeded/i);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd copilot-workflows && npm test -- tests/unit/cache.test.ts tests/unit/script.test.ts`

Expected: FAIL for missing `cache.ts` and `executeWorkflowScript`.

- [ ] **Step 4: Implement cache keys**

Create `copilot-workflows/src/cache.ts`:

```ts
import { createHash } from "node:crypto";
import type { AgentStepOptions } from "./types.js";

const stable = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, val]) => [k, stable(val)]),
    );
  }
  return v;
};

export const agentCacheKey = (
  prompt: string,
  opts: Partial<AgentStepOptions>,
  args: unknown,
): string => {
  const payload = JSON.stringify(stable({ prompt, opts, args }));
  return `v1:${createHash("sha256").update(payload).digest("hex")}`;
};
```

- [ ] **Step 5: Implement runtime globals**

Extend `copilot-workflows/src/script.ts` with these exports:

```ts
import type { AgentBackend } from "./agent-runtime.js";
import { runAgentWithSchemaRetry } from "./agent-runtime.js";
import { agentCacheKey } from "./cache.js";
import { newAgentId } from "./ids.js";
import {
  AgentStepOptionsSchema,
  type WorkflowProgressEntry,
} from "./types.js";

export interface ExecuteWorkflowInput {
  args?: unknown;
  backend: AgentBackend;
  defaultModel: string;
  defaultEffort: string;
  defaultContextWindow: number;
  maxRetries: number;
  budgetTokens?: number;
}

export interface ExecuteWorkflowOutput {
  result: unknown;
  progress: WorkflowProgressEntry[];
  totalTokens: number;
  totalToolCalls: number;
  agentCount: number;
}

export const executeWorkflowScript = async (
  script: string,
  input: ExecuteWorkflowInput,
): Promise<ExecuteWorkflowOutput> => {
  const meta = extractWorkflowMeta(script);
  validateDeterministicScript(script);
  const body = stripMetaExport(script);
  const progress: WorkflowProgressEntry[] = meta.phases.map((p, i) => ({
    type: "workflow_phase",
    index: i + 1,
    title: p.title,
    ...(p.detail ? { detail: p.detail } : {}),
  }));
  let currentPhase: string | null = null;
  let logIndex = 0;
  let agentIndex = 0;
  let totalTokens = 0;
  let totalToolCalls = 0;

  const budgetTotal = input.budgetTokens ?? Number.POSITIVE_INFINITY;
  const budget = {
    total: budgetTotal,
    spent: () => totalTokens,
    remaining: () => Math.max(0, budgetTotal - totalTokens),
  };

  const phase = (title: string): void => {
    currentPhase = title;
    if (!progress.some((p) => p.type === "workflow_phase" && p.title === title)) {
      progress.push({ type: "workflow_phase", index: progress.filter((p) => p.type === "workflow_phase").length + 1, title });
    }
  };

  const log = (message: string): void => {
    progress.push({ type: "workflow_log", index: logIndex++, message, timestamp: new Date().toISOString() });
  };

  const agent = async (prompt: string, rawOpts: unknown = {}): Promise<unknown> => {
    const opts = AgentStepOptionsSchema.parse(rawOpts);
    const index = ++agentIndex;
    const agentId = newAgentId();
    const label = opts.label ?? `agent:${index}`;
    const phaseTitle = opts.phase ?? currentPhase ?? undefined;
    const phaseIndex = phaseTitle
      ? progress.filter((p) => p.type === "workflow_phase").findIndex((p) => p.title === phaseTitle) + 1
      : undefined;
    const model = opts.model ?? input.defaultModel;
    const effort = opts.effort ?? input.defaultEffort;
    const contextWindow = opts.contextWindow ?? input.defaultContextWindow;
    const stepId = `step_${index}`;
    const cacheKey = agentCacheKey(prompt, opts, input.args);
    const startedAt = Date.now();
    const entry: WorkflowProgressEntry = {
      type: "workflow_agent",
      index,
      stepId,
      label,
      ...(phaseIndex && phaseIndex > 0 ? { phaseIndex } : {}),
      ...(phaseTitle ? { phaseTitle } : {}),
      agentId,
      model,
      effort,
      contextWindow,
      state: "running",
      queuedAt: startedAt,
      startedAt,
      updatedAt: startedAt,
      attempt: 1,
      tokens: 0,
      toolCalls: 0,
      retries: 0,
      cacheKey,
    };
    progress.push(entry);
    const out = await runAgentWithSchemaRetry(
      {
        prompt,
        stepId,
        agentId,
        model,
        effort,
        contextWindow,
        ...(opts.schema ? { schema: opts.schema } : {}),
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
        ...(opts.env ? { env: opts.env } : {}),
      },
      input.backend,
      { maxRetries: input.maxRetries },
    );
    totalTokens += out.tokens;
    totalToolCalls += out.toolCalls;
    if (totalTokens > budgetTotal) throw new Error(`workflow budget exceeded: spent ${totalTokens}, budget ${budgetTotal}`);
    Object.assign(entry, {
      state: "done",
      updatedAt: Date.now(),
      completedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      tokens: out.tokens,
      toolCalls: out.toolCalls,
      retries: out.retries,
      ...(out.lastToolName ? { lastToolName: out.lastToolName } : {}),
      ...(out.lastToolSummary ? { lastToolSummary: out.lastToolSummary } : {}),
      resultPreview: typeof out.result === "string" ? out.result.slice(0, 200) : JSON.stringify(out.result).slice(0, 200),
    });
    return out.result;
  };

  const parallel = async (thunks: Array<() => unknown | Promise<unknown>>): Promise<unknown[]> =>
    Promise.all(thunks.map(async (thunk) => {
      try {
        return await thunk();
      } catch {
        return null;
      }
    }));

  const pipeline = async (
    items: unknown[],
    ...stages: Array<(prev: unknown, original: unknown, index: number) => unknown | Promise<unknown>>
  ): Promise<unknown[]> => Promise.all(items.map(async (item, index) => {
    let current: unknown = item;
    try {
      for (const stage of stages) current = await stage(current, item, index);
      return current;
    } catch {
      return null;
    }
  }));

  const runner = new Function(
    "agent",
    "parallel",
    "pipeline",
    "phase",
    "log",
    "args",
    "budget",
    `"use strict"; return (async () => {\n${body}\n})()`,
  );

  const result = await runner(agent, parallel, pipeline, phase, log, input.args, budget);
  return { result, progress, totalTokens, totalToolCalls, agentCount: agentIndex };
};
```

- [ ] **Step 6: Run tests**

Run: `cd copilot-workflows && npm test -- tests/unit/cache.test.ts tests/unit/script.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add copilot-workflows/src/cache.ts copilot-workflows/src/script.ts copilot-workflows/tests/unit/cache.test.ts copilot-workflows/tests/unit/script.test.ts
git commit -m "feat: execute workflow scripts"
```

---

### Task 6: Runner Lifecycle, Status, Output, and Stop

**Files:**
- Create: `copilot-workflows/src/runner.ts`
- Create: `copilot-workflows/src/visibility.ts`
- Create: `copilot-workflows/tests/integration/runner.test.ts`
- Create: `copilot-workflows/tests/unit/visibility.test.ts`
- Modify: `copilot-workflows/src/state.ts`

**Interfaces:**
- Produces: `WorkflowRunner`
- Produces: `launch(input): Promise<WorkflowLaunchOutput>`
- Produces: `runToCompletion(runId): Promise<WorkflowRun>`
- Produces: `status(runId): WorkflowRun`
- Produces: `output(runId): WorkflowOutput`
- Produces: `stop(runId): WorkflowRun`
- Produces: `renderProgressTree(run): string`

- [ ] **Step 1: Write failing runner tests**

Create `copilot-workflows/tests/integration/runner.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StubAgentBackend } from "../../src/agent-runtime.js";
import { WorkflowRunner } from "../../src/runner.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cw-runner-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const script = `
export const meta = {
  name: 'readme-demo',
  description: 'Read README',
  phases: [{ title: 'Read', detail: 'one read' }],
}
phase('Read')
const summary = await agent('read README', { label: 'read:README' })
return { summary }
`;

describe("WorkflowRunner", () => {
  it("launches, completes, and exposes status/output with transcripts", async () => {
    const runner = new WorkflowRunner({
      root,
      backend: new StubAgentBackend([{ text: "README summary", tokens: 7, toolCalls: 1 }]),
    });
    const launch = await runner.launch({ script, args: { topic: "readme" }, confirm: false });
    expect(launch.runId).toMatch(/^wf_/);
    expect(launch.scriptPath).toContain("readme-demo");
    expect(launch.transcriptDir).toContain(launch.runId);

    const completed = await runner.runToCompletion(launch.runId);
    expect(completed.status).toBe("completed");
    expect(completed.result).toEqual({ summary: "README summary" });

    const status = runner.status(launch.runId);
    expect(status.workflowProgress.some((p) => p.type === "workflow_agent" && p.label === "read:README")).toBe(true);

    const output = runner.output(launch.runId);
    expect(output.result).toEqual({ summary: "README summary" });
    expect(output.journal).toContain("run_started");
    expect(output.transcripts.length).toBe(1);
  });

  it("marks a queued run stopped before execution", async () => {
    const runner = new WorkflowRunner({
      root,
      backend: new StubAgentBackend([{ text: "unused", tokens: 1, toolCalls: 1 }]),
    });
    const launch = await runner.launch({ script, confirm: false });
    const stopped = runner.stop(launch.runId);
    expect(stopped.status).toBe("stopped");
    await expect(runner.runToCompletion(launch.runId)).rejects.toThrow(/stopped/);
  });
});
```

Create `copilot-workflows/tests/unit/visibility.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderProgressTree } from "../../src/visibility.js";
import type { WorkflowRun } from "../../src/types.js";

describe("workflow visibility", () => {
  it("renders phases and labelled agents", () => {
    const run = {
      runId: "wf_x",
      taskId: "w123",
      workflowName: "demo",
      status: "running",
      script: "",
      scriptPath: "/tmp/demo.js",
      transcriptDir: "/tmp/t",
      defaultModel: "gpt-5.5",
      defaultEffort: "xhigh",
      defaultContextWindow: 1_100_000,
      phases: [{ title: "Read", detail: "read files" }],
      workflowProgress: [
        { type: "workflow_phase", index: 1, title: "Read", detail: "read files" },
        {
          type: "workflow_agent",
          index: 1,
          stepId: "step_1",
          label: "read:README",
          phaseIndex: 1,
          phaseTitle: "Read",
          agentId: "agent-a",
          model: "gpt-5.5",
          effort: "xhigh",
          contextWindow: 1_100_000,
          state: "running",
          updatedAt: 1,
          attempt: 1,
          tokens: 10,
          toolCalls: 1,
          retries: 0,
        },
      ],
      result: null,
      error: null,
      agentCount: 1,
      totalTokens: 10,
      totalToolCalls: 1,
      durationMs: 100,
      createdAt: "x",
      startedAt: "x",
      updatedAt: "x",
      completedAt: null,
    } satisfies WorkflowRun;
    const tree = renderProgressTree(run);
    expect(tree).toContain("Read");
    expect(tree).toContain("read:README");
    expect(tree).toContain("running");
    expect(tree).toContain("gpt-5.5");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd copilot-workflows && npm test -- tests/integration/runner.test.ts tests/unit/visibility.test.ts`

Expected: FAIL because `runner.ts` and `visibility.ts` do not exist.

- [ ] **Step 3: Implement visibility**

Create `copilot-workflows/src/visibility.ts`:

```ts
import type { WorkflowRun } from "./types.js";

export const renderProgressTree = (run: WorkflowRun): string => {
  const lines = [`${run.workflowName} ${run.status} ${run.agentCount} agents ${run.totalTokens} tokens`];
  for (const entry of run.workflowProgress) {
    if (entry.type === "workflow_phase") {
      lines.push(`▸ ${entry.title}${entry.detail ? ` — ${entry.detail}` : ""}`);
    } else if (entry.type === "workflow_log") {
      lines.push(`  • ${entry.message}`);
    } else {
      lines.push(
        `  ${entry.state.padEnd(9)} ${entry.label} ${entry.model}/${entry.effort} tokens=${entry.tokens} tools=${entry.toolCalls}`,
      );
    }
  }
  return lines.join("\n");
};
```

- [ ] **Step 4: Implement runner**

Create `copilot-workflows/src/runner.ts`:

```ts
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentBackend } from "./agent-runtime.js";
import { CopilotPrintBackend } from "./agent-runtime.js";
import { extractWorkflowMeta, executeWorkflowScript } from "./script.js";
import {
  appendJournal,
  createInitialRun,
  loadRun,
  saveRun,
  workflowPaths,
  writeAgentTranscript,
  type StateOptions,
} from "./state.js";
import type { ProgressReporter, WorkflowRun } from "./types.js";
import { noopProgress } from "./types.js";

export interface WorkflowRunnerOptions extends StateOptions {
  backend?: AgentBackend;
  progress?: ProgressReporter;
}

export interface WorkflowLaunchInput {
  script: string;
  args?: unknown;
  confirm?: boolean;
  resumeFromRunId?: string;
  defaultModel?: string;
  defaultEffort?: string;
  defaultContextWindow?: number;
  budgetTokens?: number;
}

export interface WorkflowLaunchOutput {
  taskId: string;
  runId: string;
  workflowName: string;
  status: WorkflowRun["status"];
  scriptPath: string;
  transcriptDir: string;
}

export interface WorkflowOutput {
  run: WorkflowRun;
  result: unknown;
  journal: string;
  transcripts: Array<{ agentId: string; path: string; content: string }>;
}

export class WorkflowRunner {
  private readonly backend: AgentBackend;
  private readonly progress: ProgressReporter;

  constructor(private readonly opts: WorkflowRunnerOptions = {}) {
    this.backend = opts.backend ?? new CopilotPrintBackend();
    this.progress = opts.progress ?? noopProgress;
  }

  async launch(input: WorkflowLaunchInput): Promise<WorkflowLaunchOutput> {
    if (input.confirm !== false) {
      throw new Error("Workflow launch requires confirmation; pass confirm:false only from trusted automation/tests");
    }
    const meta = extractWorkflowMeta(input.script);
    const run = await createInitialRun({
      root: this.opts.root,
      workflowName: meta.name,
      script: input.script,
      args: input.args,
      phases: meta.phases,
      ...(input.resumeFromRunId ? { resumeFromRunId: input.resumeFromRunId } : {}),
      ...(input.budgetTokens ? { budgetTokens: input.budgetTokens } : {}),
      ...(input.defaultModel ? { defaultModel: input.defaultModel } : {}),
      ...(input.defaultEffort ? { defaultEffort: input.defaultEffort } : {}),
      ...(input.defaultContextWindow ? { defaultContextWindow: input.defaultContextWindow } : {}),
    });
    appendJournal(run.runId, { type: "run_queued", runId: run.runId, taskId: run.taskId }, this.opts);
    return {
      taskId: run.taskId,
      runId: run.runId,
      workflowName: run.workflowName,
      status: run.status,
      scriptPath: run.scriptPath,
      transcriptDir: run.transcriptDir,
    };
  }

  async runToCompletion(runId: string): Promise<WorkflowRun> {
    let run = loadRun(runId, this.opts);
    if (run.status === "stopped") throw new Error(`workflow ${runId} is stopped`);
    const start = Date.now();
    run.status = "running";
    run.startedAt = new Date(start).toISOString();
    appendJournal(runId, { type: "run_started", runId }, this.opts);
    saveRun(run, this.opts);
    await this.progress(1, undefined, `workflow ${run.workflowName} started`);
    try {
      const out = await executeWorkflowScript(run.script, {
        args: run.args,
        backend: this.backend,
        defaultModel: run.defaultModel,
        defaultEffort: run.defaultEffort,
        defaultContextWindow: run.defaultContextWindow,
        maxRetries: 1,
        budgetTokens: run.budgetTokens,
      });
      run = loadRun(runId, this.opts);
      run.status = "completed";
      run.result = out.result;
      run.workflowProgress = out.progress;
      run.agentCount = out.agentCount;
      run.totalTokens = out.totalTokens;
      run.totalToolCalls = out.totalToolCalls;
      run.durationMs = Date.now() - start;
      run.completedAt = new Date().toISOString();
      appendJournal(runId, { type: "run_completed", result: out.result }, this.opts);
      for (const entry of out.progress) {
        if (entry.type === "workflow_agent") {
          writeAgentTranscript(runId, entry.agentId, [{ role: "assistant", content: entry.resultPreview ?? "" }], this.opts);
        }
      }
      saveRun(run, this.opts);
      await this.progress(2, undefined, `workflow ${run.workflowName} completed`);
      return run;
    } catch (err) {
      run = loadRun(runId, this.opts);
      run.status = "failed";
      run.error = err instanceof Error ? err.message : String(err);
      run.durationMs = Date.now() - start;
      run.completedAt = new Date().toISOString();
      appendJournal(runId, { type: "run_failed", error: run.error }, this.opts);
      saveRun(run, this.opts);
      throw err;
    }
  }

  status(runId: string): WorkflowRun {
    return loadRun(runId, this.opts);
  }

  output(runId: string): WorkflowOutput {
    const run = loadRun(runId, this.opts);
    const paths = workflowPaths({ root: this.opts.root, runId, workflowName: run.workflowName });
    const journal = existsSync(paths.journalPath) ? readFileSync(paths.journalPath, "utf8") : "";
    const transcripts = existsSync(paths.transcriptDir)
      ? readdirSync(paths.transcriptDir)
          .filter((f) => /^agent-.+\.jsonl$/.test(f))
          .map((f) => {
            const path = join(paths.transcriptDir, f);
            return { agentId: f.replace(/\.jsonl$/, ""), path, content: readFileSync(path, "utf8") };
          })
      : [];
    return { run, result: run.result, journal, transcripts };
  }

  stop(runId: string): WorkflowRun {
    const run = loadRun(runId, this.opts);
    if (run.status === "completed" || run.status === "failed") return run;
    run.status = "stopped";
    run.completedAt = new Date().toISOString();
    appendJournal(runId, { type: "run_stopped", runId }, this.opts);
    saveRun(run, this.opts);
    return loadRun(runId, this.opts);
  }
}
```

- [ ] **Step 5: Run tests**

Run: `cd copilot-workflows && npm test -- tests/integration/runner.test.ts tests/unit/visibility.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add copilot-workflows/src/runner.ts copilot-workflows/src/visibility.ts copilot-workflows/tests/integration/runner.test.ts copilot-workflows/tests/unit/visibility.test.ts
git commit -m "feat: add workflow runner lifecycle"
```

---

### Task 7: Resume and Cache Replay

**Files:**
- Modify: `copilot-workflows/src/runner.ts`
- Modify: `copilot-workflows/src/script.ts`
- Modify: `copilot-workflows/src/state.ts`
- Create: `copilot-workflows/tests/integration/resume.test.ts`

**Interfaces:**
- Produces: `resumeFromRunId?: string` in launch/run inputs.
- Produces cache replay in `executeWorkflowScript` using prior progress and prior results.
- Produces `state: "cached"` for replayed steps.

- [ ] **Step 1: Write failing resume tests**

Create `copilot-workflows/tests/integration/resume.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StubAgentBackend } from "../../src/agent-runtime.js";
import { WorkflowRunner } from "../../src/runner.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cw-resume-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const script = `
export const meta = { name: 'resume-demo', description: 'Resume demo' }
const a = await agent('stable expensive', { label: 'stable', model: 'gpt-5.5', effort: 'xhigh' })
const b = await agent('format ' + a, { label: 'format', model: 'gpt-5.5', effort: 'xhigh' })
return { a, b }
`;

const edited = script.replace("format ' + a", "format edited ' + a");

describe("workflow resume cache", () => {
  it("replays same script with zero new backend calls", async () => {
    const first = new WorkflowRunner({
      root,
      backend: new StubAgentBackend([
        { text: "A", tokens: 10, toolCalls: 1 },
        { text: "B", tokens: 5, toolCalls: 1 },
      ]),
    });
    const launch = await first.launch({ script, confirm: false });
    await first.runToCompletion(launch.runId);

    const replay = new WorkflowRunner({ root, backend: new StubAgentBackend([]) });
    const replayLaunch = await replay.launch({ script, confirm: false, resumeFromRunId: launch.runId });
    const completed = await replay.runToCompletion(replayLaunch.runId);
    expect(completed.result).toEqual({ a: "A", b: "B" });
    expect(completed.totalTokens).toBe(0);
    expect(completed.workflowProgress.filter((p) => p.type === "workflow_agent").every((p) => p.state === "cached")).toBe(true);
  });

  it("reruns from the first edited step onward", async () => {
    const first = new WorkflowRunner({
      root,
      backend: new StubAgentBackend([
        { text: "A", tokens: 10, toolCalls: 1 },
        { text: "B", tokens: 5, toolCalls: 1 },
      ]),
    });
    const launch = await first.launch({ script, confirm: false });
    await first.runToCompletion(launch.runId);

    const second = new WorkflowRunner({
      root,
      backend: new StubAgentBackend([{ text: "B2", tokens: 6, toolCalls: 1 }]),
    });
    const replayLaunch = await second.launch({ script: edited, confirm: false, resumeFromRunId: launch.runId });
    const completed = await second.runToCompletion(replayLaunch.runId);
    expect(completed.result).toEqual({ a: "A", b: "B2" });
    const agents = completed.workflowProgress.filter((p) => p.type === "workflow_agent");
    expect(agents.map((p) => p.state)).toEqual(["cached", "done"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd copilot-workflows && npm test -- tests/integration/resume.test.ts`

Expected: FAIL because `resumeFromRunId` is not implemented.

- [ ] **Step 3: Add resume fields and prior cache loading**

Modify `WorkflowLaunchInput` in `src/runner.ts`:

```ts
export interface WorkflowLaunchInput {
  script: string;
  args?: unknown;
  confirm?: boolean;
  resumeFromRunId?: string;
  defaultModel?: string;
  defaultEffort?: string;
  defaultContextWindow?: number;
  budgetTokens?: number;
}
```

When creating a run, persist `resumeFromRunId` as an optional field in `WorkflowRunSchema` and `WorkflowRun`.

Add to `WorkflowRunSchema` in `types.ts`:

```ts
resumeFromRunId: z.string().optional(),
cacheResults: z.array(z.object({
  cacheKey: z.string(),
  result: z.unknown(),
  progress: WorkflowProgressEntrySchema,
})).default([]),
```

Set it in `createInitialRun` when provided.

- [ ] **Step 4: Add cached result storage**

In `script.ts`, extend `ExecuteWorkflowInput`:

```ts
previousCache?: Map<string, { result: unknown; progress: WorkflowProgressEntry }>;
```

Extend `ExecuteWorkflowOutput`:

```ts
cacheResults: Array<{ cacheKey: string; result: unknown; progress: WorkflowProgressEntry }>;
```

Inside `executeWorkflowScript`, initialize `const cacheResults: Array<{ cacheKey: string; result: unknown; progress: WorkflowProgressEntry }> = [];` next to `progress`.

At the start of `agent()`, after computing `cacheKey`, add:

```ts
const cached = input.previousCache?.get(cacheKey);
if (cached) {
  const cachedEntry = {
    ...(cached.progress as Extract<WorkflowProgressEntry, { type: "workflow_agent" }>),
    index,
    stepId,
    label,
    agentId,
    state: "cached" as const,
    tokens: 0,
    toolCalls: 0,
    updatedAt: Date.now(),
    completedAt: Date.now(),
  };
  progress.push(cachedEntry);
  return cached.result;
}
```

After a live agent completes and before returning its result, add:

```ts
cacheResults.push({ cacheKey, result: out.result, progress: entry });
```

Return `cacheResults` from `executeWorkflowScript`.

Write a helper in `runner.ts` before calling `executeWorkflowScript`:

```ts
const buildPreviousCache = (prior: WorkflowRun | null): Map<string, { result: unknown; progress: WorkflowProgressEntry }> => {
  const map = new Map<string, { result: unknown; progress: WorkflowProgressEntry }>();
  for (const cached of prior?.cacheResults ?? []) {
    map.set(cached.cacheKey, { result: cached.result, progress: cached.progress });
  }
  return map;
};
```

In `runToCompletion`, load the prior run when `run.resumeFromRunId` is set:

```ts
const prior = run.resumeFromRunId ? loadRun(run.resumeFromRunId, this.opts) : null;
const out = await executeWorkflowScript(run.script, {
  args: run.args,
  backend: this.backend,
  defaultModel: run.defaultModel,
  defaultEffort: run.defaultEffort,
  defaultContextWindow: run.defaultContextWindow,
  maxRetries: 1,
  previousCache: buildPreviousCache(prior),
});
run.cacheResults = out.cacheResults;
```

- [ ] **Step 5: Run resume tests**

Run: `cd copilot-workflows && npm test -- tests/integration/resume.test.ts`

Expected: PASS with cached steps marked `cached` and no backend calls on a full replay.

- [ ] **Step 6: Run runner tests**

Run: `cd copilot-workflows && npm test -- tests/integration/runner.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add copilot-workflows/src/runner.ts copilot-workflows/src/script.ts copilot-workflows/src/state.ts copilot-workflows/src/types.ts copilot-workflows/tests/integration/resume.test.ts
git commit -m "feat: add workflow resume cache"
```

---

### Task 8: MCP Tools and Progress Notifications

**Files:**
- Create: `copilot-workflows/src/tools.ts`
- Create: `copilot-workflows/src/server.ts`
- Create: `copilot-workflows/tests/integration/server.test.ts`

**Interfaces:**
- Produces MCP tools: `Workflow`, `WorkflowStatus`, `WorkflowOutput`, `WorkflowStop`, `WorkflowList`, `WorkflowInspect`, `WorkflowSave`.
- Produces: `buildServer(deps): McpServer`.

- [ ] **Step 1: Write failing MCP contract tests**

Create `copilot-workflows/tests/integration/server.test.ts`:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StubAgentBackend } from "../../src/agent-runtime.js";
import { buildServer } from "../../src/server.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cw-server-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const script = `
export const meta = { name: 'server-demo', description: 'Server demo' }
return await agent('hello', { label: 'hello' })
`;

const link = async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer({
    root,
    backend: new StubAgentBackend([{ text: "ok", tokens: 1, toolCalls: 1 }]),
  });
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
};

describe("workflow MCP server", () => {
  it("exposes workflow tools", async () => {
    const { client } = await link();
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      "Workflow",
      "WorkflowInspect",
      "WorkflowList",
      "WorkflowOutput",
      "WorkflowSave",
      "WorkflowStatus",
      "WorkflowStop",
    ].sort());
  });

  it("runs a workflow and reads status/output", async () => {
    const { client } = await link();
    const run = await client.callTool({ name: "Workflow", arguments: { script, confirm: false, wait: true } });
    expect(run.isError).toBeFalsy();
    const parsed = JSON.parse((run.content as Array<{ text: string }>)[0]!.text);
    expect(parsed.status).toBe("completed");

    const status = await client.callTool({ name: "WorkflowStatus", arguments: { runId: parsed.runId } });
    expect(status.isError).toBeFalsy();
    expect((status.content as Array<{ text: string }>)[0]!.text).toContain("server-demo");

    const output = await client.callTool({ name: "WorkflowOutput", arguments: { runId: parsed.runId } });
    expect(output.isError).toBeFalsy();
    expect((output.content as Array<{ text: string }>)[0]!.text).toContain("\"ok\"");
  });

  it("emits progress notifications", async () => {
    const { client } = await link();
    const events: Array<{ progress: number; message?: string }> = [];
    await client.callTool(
      { name: "Workflow", arguments: { script, confirm: false, wait: true } },
      undefined,
      { onprogress: (p: { progress: number; message?: string }) => events.push(p) },
    );
    expect(events.some((e) => e.message?.includes("workflow"))).toBe(true);
  });

  it("saves and lists workflows without running them", async () => {
    const { client } = await link();
    const saved = await client.callTool({ name: "WorkflowSave", arguments: { script } });
    expect(saved.isError).toBeFalsy();
    const savedParsed = JSON.parse((saved.content as Array<{ text: string }>)[0]!.text);
    expect(savedParsed.saved).toBe(true);
    expect(savedParsed.status).toBe("queued");

    const listed = await client.callTool({ name: "WorkflowList", arguments: { workflowName: "server-demo" } });
    expect(listed.isError).toBeFalsy();
    const listParsed = JSON.parse((listed.content as Array<{ text: string }>)[0]!.text);
    expect(listParsed.runs).toHaveLength(1);
    expect(listParsed.runs[0].workflowName).toBe("server-demo");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd copilot-workflows && npm test -- tests/integration/server.test.ts`

Expected: FAIL because `server.ts` does not exist.

- [ ] **Step 3: Implement tools**

Create `copilot-workflows/src/tools.ts` with zod schemas and handlers:

```ts
import { z } from "zod";
import { inspectWorkflowScript } from "./script.js";
import { WorkflowRunner, type WorkflowRunnerOptions } from "./runner.js";
import { listRuns } from "./state.js";
import { renderProgressTree } from "./visibility.js";

export const WorkflowInputSchema = z.object({
  script: z.string().optional(),
  scriptPath: z.string().optional(),
  goal: z.string().optional(),
  args: z.unknown().optional(),
  confirm: z.boolean().default(true),
  wait: z.boolean().default(false),
  resumeFromRunId: z.string().optional(),
});

export const WorkflowRunIdSchema = z.object({ runId: z.string().min(1) });
export const WorkflowInspectInputSchema = z.object({ script: z.string() });
export const WorkflowListInputSchema = z.object({
  status: z.enum(["preview", "queued", "running", "completed", "failed", "stopped"]).optional(),
  workflowName: z.string().optional(),
});
export const WorkflowSaveInputSchema = z.object({
  script: z.string(),
  args: z.unknown().optional(),
});

export const handleWorkflow = async (raw: unknown, deps: WorkflowRunnerOptions) => {
  const input = WorkflowInputSchema.parse(raw);
  if (!input.script) throw new Error("Workflow requires script");
  const runner = new WorkflowRunner(deps);
  const launch = await runner.launch({
    script: input.script,
    args: input.args,
    confirm: input.confirm,
    ...(input.resumeFromRunId ? { resumeFromRunId: input.resumeFromRunId } : {}),
  });
  if (!input.wait) return { status: "async_launched", ...launch };
  const done = await runner.runToCompletion(launch.runId);
  return { ...launch, status: done.status, result: done.result, workflowProgress: done.workflowProgress };
};

export const handleWorkflowStatus = (raw: unknown, deps: WorkflowRunnerOptions) => {
  const { runId } = WorkflowRunIdSchema.parse(raw);
  const runner = new WorkflowRunner(deps);
  const run = runner.status(runId);
  return { run, progressTree: renderProgressTree(run) };
};

export const handleWorkflowOutput = (raw: unknown, deps: WorkflowRunnerOptions) => {
  const { runId } = WorkflowRunIdSchema.parse(raw);
  return new WorkflowRunner(deps).output(runId);
};

export const handleWorkflowStop = (raw: unknown, deps: WorkflowRunnerOptions) => {
  const { runId } = WorkflowRunIdSchema.parse(raw);
  return new WorkflowRunner(deps).stop(runId);
};

export const handleWorkflowInspect = (raw: unknown) => {
  const { script } = WorkflowInspectInputSchema.parse(raw);
  return inspectWorkflowScript(script);
};

export const handleWorkflowList = (raw: unknown, deps: WorkflowRunnerOptions) => {
  const input = WorkflowListInputSchema.parse(raw);
  const runs = listRuns({ root: deps.root }).filter((run) => {
    if (input.status && run.status !== input.status) return false;
    if (input.workflowName && run.workflowName !== input.workflowName) return false;
    return true;
  });
  return { runs };
};

export const handleWorkflowSave = async (raw: unknown, deps: WorkflowRunnerOptions) => {
  const input = WorkflowSaveInputSchema.parse(raw);
  const inspection = inspectWorkflowScript(input.script);
  if (!inspection.valid || !inspection.meta) return inspection;
  const launch = await new WorkflowRunner(deps).launch({
    script: input.script,
    args: input.args,
    confirm: false,
  });
  return { ...inspection, saved: true, ...launch };
};
```

- [ ] **Step 4: Implement server**

Create `copilot-workflows/src/server.ts` following the `copilot-teams/src/server.ts` wrapper style:

```ts
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
    description: "Run a dynamic workflow from a persisted JS script. Use this when the user says workflow:<goal>; generate the JS script first, then pass it here.",
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
```

- [ ] **Step 5: Run server tests**

Run: `cd copilot-workflows && npm test -- tests/integration/server.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add copilot-workflows/src/tools.ts copilot-workflows/src/server.ts copilot-workflows/tests/integration/server.test.ts
git commit -m "feat: expose workflow MCP tools"
```

---

### Task 9: Goal Planner and Inline `workflow:` UX Contract

**Files:**
- Create: `copilot-workflows/src/planner.ts`
- Create: `copilot-workflows/tests/unit/planner.test.ts`
- Modify: `copilot-workflows/src/tools.ts`
- Modify: `copilot-workflows/src/server.ts`

**Interfaces:**
- Produces: `generateWorkflowScriptFromGoal(goal: string): string`
- `Workflow` accepts `{ goal, confirm, wait }` without explicit `script`.

- [ ] **Step 1: Write failing planner tests**

Create `copilot-workflows/tests/unit/planner.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractWorkflowMeta } from "../../src/script.js";
import { generateWorkflowScriptFromGoal } from "../../src/planner.js";

describe("workflow goal planner", () => {
  it("generates deterministic JS for an inline workflow goal", () => {
    const script = generateWorkflowScriptFromGoal("workflow: compare README and package metadata");
    expect(script).toContain("export const meta");
    expect(script).toContain("agent(");
    expect(script).toContain("parallel(");
    expect(script).not.toContain("Date.now");
    const meta = extractWorkflowMeta(script);
    expect(meta.name).toBe("compare-readme-and-package-metadata");
    expect(meta.description).toContain("compare README and package metadata");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd copilot-workflows && npm test -- tests/unit/planner.test.ts`

Expected: FAIL because `planner.ts` does not exist.

- [ ] **Step 3: Implement planner**

Create `copilot-workflows/src/planner.ts`:

```ts
import { slugifyWorkflowName } from "./ids.js";

const jsString = (s: string): string => JSON.stringify(s);

const cleanGoal = (goal: string): string => goal.replace(/^workflow:\s*/i, "").trim();

export const generateWorkflowScriptFromGoal = (goal: string): string => {
  const cleaned = cleanGoal(goal);
  const name = slugifyWorkflowName(cleaned).slice(0, 60);
  const desc = cleaned || "Run a dynamic workflow";
  return `export const meta = {
  name: ${jsString(name)},
  description: ${jsString(desc)},
  phases: [
    { title: 'Plan', detail: 'turn the user goal into concrete workflow tasks' },
    { title: 'Execute', detail: 'run task agents with isolated context' },
    { title: 'Synthesize', detail: 'merge task results into a final answer' },
  ],
}

const TASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'prompt'],
        properties: {
          label: { type: 'string' },
          prompt: { type: 'string' },
        },
      },
    },
  },
}

phase('Plan')
const plan = await agent(
  'Create 2-6 read-only or implementation-safe subagent tasks for this workflow goal. Return only JSON matching the schema. Goal: ' + ${jsString(desc)},
  { label: 'plan:tasks', phase: 'Plan', schema: TASK_SCHEMA },
)

phase('Execute')
const rawResults = await parallel(
  plan.tasks.map((task) => () => agent(task.prompt, { label: task.label, phase: 'Execute' })),
)
const results = rawResults.filter(Boolean)
log('completed ' + results.length + ' of ' + rawResults.length + ' planned tasks')

phase('Synthesize')
return await agent(
  'Synthesize these workflow results for the original goal: ' + ${jsString(desc)} + '\\n\\n' + JSON.stringify(results, null, 2),
  { label: 'synthesize:final', phase: 'Synthesize' },
)
`;
};
```

- [ ] **Step 4: Wire goal into Workflow tool**

In `tools.ts`, import planner:

```ts
import { generateWorkflowScriptFromGoal } from "./planner.js";
```

Change `handleWorkflow` script selection:

```ts
const script = input.script ?? (input.goal ? generateWorkflowScriptFromGoal(input.goal) : undefined);
if (!script) throw new Error("Workflow requires script or goal");
```

Pass `script` to `runner.launch`.

- [ ] **Step 5: Add server integration test for goal**

Append to `copilot-workflows/tests/integration/server.test.ts`:

```ts
it("accepts a workflow goal and generates a script", async () => {
  const { client } = await link();
  const r = await client.callTool({
    name: "Workflow",
    arguments: { goal: "workflow: compare README and package metadata", confirm: false, wait: false },
  });
  expect(r.isError).toBeFalsy();
  const parsed = JSON.parse((r.content as Array<{ text: string }>)[0]!.text);
  expect(parsed.workflowName).toBe("compare-readme-and-package-metadata");
  expect(parsed.scriptPath).toContain("compare-readme-and-package-metadata");
});
```

- [ ] **Step 6: Run planner and server tests**

Run: `cd copilot-workflows && npm test -- tests/unit/planner.test.ts tests/integration/server.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add copilot-workflows/src/planner.ts copilot-workflows/src/tools.ts copilot-workflows/src/server.ts copilot-workflows/tests/unit/planner.test.ts copilot-workflows/tests/integration/server.test.ts
git commit -m "feat: add workflow goal planner"
```

---

### Task 10: CLI Wrapper

**Files:**
- Create: `copilot-workflows/src/cli.ts`
- Create: `copilot-workflows/tests/integration/cli.test.ts`
- Modify: `bin/copilot-workflow`

**Interfaces:**
- Produces commands: `run`, `status`, `output`, `stop`, `inspect`, `resume`.

- [ ] **Step 1: Write failing CLI tests**

Create `copilot-workflows/tests/integration/cli.test.ts`:

```ts
import { execa } from "execa";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let root: string;
let scriptPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cw-cli-"));
  scriptPath = join(root, "demo.js");
  writeFileSync(scriptPath, "export const meta = { name: 'cli-demo', description: 'CLI demo' }\\nreturn 'ok'\\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("copilot-workflow CLI", () => {
  it("inspects a script", async () => {
    const r = await execa("node", ["src/cli.ts", "inspect", scriptPath], {
      cwd: process.cwd(),
      env: { ...process.env, COPILOT_WORKFLOWS_ROOT: root },
      reject: false,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("cli-demo");
  });
});
```

If `node src/cli.ts` cannot run TypeScript directly, change the test command to `npm run build && node dist/cli.js inspect <path>` in the implementation step.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd copilot-workflows && npm test -- tests/integration/cli.test.ts`

Expected: FAIL because `cli.ts` does not exist.

- [ ] **Step 3: Implement CLI**

Create `copilot-workflows/src/cli.ts`:

```ts
#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { WorkflowRunner } from "./runner.js";
import { inspectWorkflowScript } from "./script.js";
import { renderProgressTree } from "./visibility.js";

const root = process.env.COPILOT_WORKFLOWS_ROOT;
const [cmd, ...args] = process.argv.slice(2);

const print = (v: unknown): void => {
  process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
};

const runner = new WorkflowRunner({ ...(root ? { root } : {}) });

if (cmd === "inspect") {
  const path = args[0];
  if (!path) throw new Error("usage: copilot-workflow inspect <script.js>");
  print(inspectWorkflowScript(readFileSync(path, "utf8")));
} else if (cmd === "run") {
  const path = args[0];
  if (!path) throw new Error("usage: copilot-workflow run <script.js>");
  const launch = await runner.launch({ script: readFileSync(path, "utf8"), confirm: false });
  print(launch);
} else if (cmd === "status") {
  const runId = args[0];
  if (!runId) throw new Error("usage: copilot-workflow status <run-id>");
  const run = runner.status(runId);
  process.stdout.write(`${renderProgressTree(run)}\n`);
} else if (cmd === "output") {
  const runId = args[0];
  if (!runId) throw new Error("usage: copilot-workflow output <run-id>");
  print(runner.output(runId));
} else if (cmd === "stop") {
  const runId = args[0];
  if (!runId) throw new Error("usage: copilot-workflow stop <run-id>");
  print(runner.stop(runId));
} else {
  process.stderr.write("usage: copilot-workflow <inspect|run|status|output|stop> ...\n");
  process.exit(2);
}
```

- [ ] **Step 4: Adjust CLI test to build first**

Replace the test command in `cli.test.ts` with:

```ts
await execa("npm", ["run", "build"], { cwd: process.cwd() });
const r = await execa("node", ["dist/cli.js", "inspect", scriptPath], {
  cwd: process.cwd(),
  env: { ...process.env, COPILOT_WORKFLOWS_ROOT: root },
  reject: false,
});
```

- [ ] **Step 5: Run CLI tests**

Run: `cd copilot-workflows && npm test -- tests/integration/cli.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add copilot-workflows/src/cli.ts copilot-workflows/tests/integration/cli.test.ts bin/copilot-workflow
git commit -m "feat: add workflow CLI"
```

---

### Task 11: Exhaustive Reliability and Visibility Test Pass

**Files:**
- Modify: `copilot-workflows/tests/integration/runner.test.ts`
- Modify: `copilot-workflows/tests/integration/server.test.ts`
- Create: `copilot-workflows/tests/integration/reliability.test.ts`
- Modify: `copilot-workflows/README.md`
- Modify: root `README.md`

**Interfaces:**
- Produces opt-in test command documentation.
- Produces visible user-story coverage for inline `workflow:` experience.

- [ ] **Step 1: Write reliability tests**

Create `copilot-workflows/tests/integration/reliability.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StubAgentBackend } from "../../src/agent-runtime.js";
import { WorkflowRunner } from "../../src/runner.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "cw-reliability-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("workflow reliability and visibility user stories", () => {
  it("shows stable labels and full output for a workflow: goal", async () => {
    const script = `
export const meta = { name: 'visibility', description: 'Visibility', phases: [{ title: 'Fanout' }] }
phase('Fanout')
const out = await parallel([
  () => agent('a', { label: 'reader:a', phase: 'Fanout' }),
  () => agent('b', { label: 'reader:b', phase: 'Fanout' }),
])
return { out }
`;
    const runner = new WorkflowRunner({
      root,
      backend: new StubAgentBackend([
        { text: "A".repeat(500), tokens: 2, toolCalls: 1 },
        { text: "B".repeat(500), tokens: 2, toolCalls: 1 },
      ]),
    });
    const launch = await runner.launch({ script, confirm: false });
    await runner.runToCompletion(launch.runId);
    const output = runner.output(launch.runId);
    expect(JSON.stringify(output.result)).toContain("A".repeat(100));
    expect(output.run.workflowProgress.filter((p) => p.type === "workflow_agent").map((p) => p.label)).toEqual(["reader:a", "reader:b"]);
  });

  it("records failure instead of silently succeeding on budget overflow", async () => {
    const script = `
export const meta = { name: 'budget-fail', description: 'Budget fail' }
return await agent('too many tokens', { label: 'expensive' })
`;
    const runner = new WorkflowRunner({
      root,
      backend: new StubAgentBackend([{ text: "huge", tokens: 10_000, toolCalls: 1 }]),
    });
    const launch = await runner.launch({ script, confirm: false, budgetTokens: 1 });
    await expect(runner.runToCompletion(launch.runId)).rejects.toThrow();
    expect(runner.status(launch.runId).status).toBe("failed");
    expect(runner.status(launch.runId).error).toMatch(/budget/i);
  });
});
```

- [ ] **Step 2: Run reliability tests**

Run: `cd copilot-workflows && npm test -- tests/integration/reliability.test.ts`

Expected: PASS. If this fails, verify `WorkflowRunner.runToCompletion()` passes `run.budgetTokens` into `executeWorkflowScript()` and records budget errors on the run before rethrowing.

- [ ] **Step 3: Add package README**

Create `copilot-workflows/README.md`:

```md
# copilot-workflows

Dynamic workflow runner for GitHub Copilot CLI agents.

Use this when a prompt says `workflow: <goal>` or when a task benefits from multiple isolated agents with visible phases, transcripts, and resumable JS orchestration.

## Tools

- `Workflow` runs a generated or persisted workflow JS file.
- `WorkflowStatus` shows live phase and agent progress.
- `WorkflowOutput` returns the final result, journal, and per-agent transcripts.
- `WorkflowStop` cancels a run.
- `WorkflowInspect` validates a script without running it.

Default agent config is GPT-5.5, xhigh effort, 1.1M context. Override globally, per workflow, per phase, or per agent.

## Test

```sh
npm test
npm run typecheck
npm run build
```

Real-model smoke tests are opt-in only; normal tests use deterministic stub agents.
```

- [ ] **Step 4: Update root README**

Add a short `copilot-workflows` section to root `README.md` after the opening description:

```md
## copilot-workflows

Dynamic workflow runner for GitHub Copilot CLI agents. It provides a Claude Code ultracode-style workflow surface: the assistant can respond to `workflow: <goal>` by generating a deterministic JS workflow, launching isolated agents, and exposing phase/step progress, transcripts, output, stop, and resume.
```

- [ ] **Step 5: Run full workflow package validation**

Run: `cd copilot-workflows && npm run typecheck && npm test && npm run build`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add copilot-workflows/README.md README.md copilot-workflows/tests/integration/reliability.test.ts
git commit -m "test: cover workflow reliability and visibility"
```

---

## Final Verification

- [ ] Run targeted validation:

```bash
cd copilot-workflows && npm run typecheck && npm test && npm run build
```

Expected: all commands pass.

- [ ] Confirm no accidental pane/worktree changes were introduced:

```bash
git --no-pager status --short --untracked-files=all
```

Expected: only intentional implementation files are modified/untracked before final commit.

- [ ] Request a rubber-duck review using Claude Opus 4.8 max or xhigh on the final implementation:

```text
Review the dynamic workflows implementation against docs/superpowers/specs/2026-06-18-dynamic-workflows-design.md and docs/superpowers/plans/2026-06-18-dynamic-workflows.md. Focus on correctness, reliability, visibility, failure semantics, and test gaps. Ignore style nits.
```

- [ ] Fix any real issues found by the rubber-duck review.

- [ ] Run final validation again:

```bash
cd copilot-workflows && npm run typecheck && npm test && npm run build
```

Expected: PASS.
