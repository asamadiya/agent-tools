import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";

const DEFAULT_ROOT = join(homedir(), ".copilot", "workflows");
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const WORKFLOW_BIN = join(REPO_ROOT, "bin", "copilot-workflow");
const INSTANCE_ID = "copilot-workflows";
const servers = new Map();

const stateIcon = (state) => ({
  completed: "✔", done: "✔", running: "◯", failed: "✖",
  stopped: "⊘", cancelled: "⊘", cached: "↻", queued: "○", preview: "○",
}[state] ?? "○");

const fmtDuration = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? `${min}m${rem}s` : `${min}m`;
};

const fmtTokens = (n) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n ?? 0);
};

const trunc = (value, max = 180) => {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

function loadRuns(root = DEFAULT_ROOT) {
  const runsDir = join(root, "runs");
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const path = join(runsDir, f);
      const run = JSON.parse(readFileSync(path, "utf8"));
      return { ...run, _file: f };
    })
    .sort((a, b) =>
      Date.parse(b.createdAt ?? b.updatedAt ?? 0) - Date.parse(a.createdAt ?? a.updatedAt ?? 0) ||
      String(b._file).localeCompare(String(a._file)),
    )
    .map((run, index) => ({ ...run, workflowId: `WF${index + 1}` }));
}

const agents = (run) => (run.workflowProgress ?? []).filter((p) => p.type === "workflow_agent");
const phases = (run) => {
  const explicit = (run.workflowProgress ?? []).filter((p) => p.type === "workflow_phase");
  const seen = new Set(explicit.map((p) => p.title));
  for (const agent of agents(run)) {
    const title = agent.phaseTitle ?? "Tasks";
    if (!seen.has(title)) {
      explicit.push({ type: "workflow_phase", index: explicit.length + 1, title });
      seen.add(title);
    }
  }
  return explicit.length ? explicit : [{ type: "workflow_phase", index: 1, title: "Tasks" }];
};
const doneAgents = (run) => agents(run).filter((a) => ["done", "cached"].includes(a.state)).length;

function renderHtml(root) {
  const initial = JSON.stringify({ root });
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Copilot Workflows</title>
  <style>
    :root { color-scheme: dark; --bg:#0d1117; --panel:#161b22; --fg:#e6edf3; --muted:#8b949e; --line:#30363d; --accent:#58a6ff; --ok:#3fb950; --bad:#f85149; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--fg); font:13px ui-monospace,SFMono-Regular,Consolas,monospace; }
    header { padding:10px 12px; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; }
    .root { color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    main { display:grid; grid-template-columns: 36% 64%; height: calc(100vh - 42px); }
    .list, .detail { overflow:auto; padding:10px; }
    .list { border-right:1px solid var(--line); }
    .run, .phase, .agent { padding:7px 8px; border:1px solid transparent; border-radius:6px; margin-bottom:4px; cursor:default; }
    .run.selected, .phase.selected, .agent.selected { border-color:var(--accent); background:#10233d; }
    .title { font-weight:700; }
    .meta { color:var(--muted); margin-top:3px; }
    .grid { display:grid; grid-template-columns: 28% 72%; gap:10px; }
    .box { border:1px solid var(--line); border-radius:8px; background:var(--panel); padding:10px; min-height:120px; }
    .agents { max-height:42vh; overflow:auto; }
    pre { white-space:pre-wrap; word-break:break-word; margin:6px 0 0; color:var(--fg); }
    .ok { color:var(--ok); } .bad { color:var(--bad); } .muted { color:var(--muted); }
    .help { color:var(--muted); }
  </style>
</head>
<body>
  <header>
    <div><b>Copilot Workflows</b> <span id="count" class="muted"></span></div>
    <div class="help">↑/↓ select · → drill in · ← back · j/k scroll text · r refresh</div>
  </header>
  <main>
    <section class="list" id="runs"></section>
    <section class="detail" id="detail"></section>
  </main>
  <script>
    const cfg = ${initial};
    let runs = [], runIndex = 0, phaseIndex = 0, agentIndex = 0, detailScroll = 0, view = 'list';
    const icon = ${stateIcon.toString()};
    const doneAgents = ${doneAgents.toString()};
    const agents = ${agents.toString()};
    const phases = ${phases.toString()};
    const fmtDuration = ${fmtDuration.toString()};
    const fmtTokens = ${fmtTokens.toString()};
    const trunc = ${trunc.toString()};
    async function refresh() {
      const res = await fetch('/api/runs');
      runs = await res.json();
      runIndex = Math.max(0, Math.min(runIndex, runs.length - 1));
      render();
    }
    function renderRuns() {
      document.getElementById('count').textContent = runs.length ? '(' + runs.length + ')' : '(none)';
      document.getElementById('runs').innerHTML = runs.length ? runs.map((run, i) => {
        const a = agents(run), done = doneAgents(run);
        return '<div class="run ' + (i === runIndex ? 'selected' : '') + '">' +
          '<div class="title">' + (i === runIndex ? '❯ ' : '  ') + run.workflowId + ' ' + icon(run.status) + ' ' + run.workflowName + '</div>' +
          '<div class="meta">' + done + '/' + a.length + ' agents · ' + fmtDuration(run.durationMs || 0) + ' · ' + fmtTokens(run.totalTokens || 0) + ' tok · ' + run.status + '</div>' +
        '</div>';
      }).join('') : '<div class="muted">No workflows yet</div>';
    }
    function phaseAgents(run, phase) { return agents(run).filter(a => (a.phaseTitle || 'Tasks') === phase.title); }
    function renderDetail() {
      const run = runs[runIndex];
      if (!run) { document.getElementById('detail').innerHTML = '<div class="muted">No workflow selected</div>'; return; }
      const ps = phases(run);
      phaseIndex = Math.max(0, Math.min(phaseIndex, ps.length - 1));
      const phase = ps[phaseIndex], ags = phaseAgents(run, phase);
      agentIndex = Math.max(0, Math.min(agentIndex, Math.max(ags.length - 1, 0)));
      const selected = ags[agentIndex];
      const phaseHtml = ps.map((p, i) => {
        const pa = phaseAgents(run, p), done = pa.filter(a => ['done','cached'].includes(a.state)).length;
        return '<div class="phase ' + (i === phaseIndex ? 'selected' : '') + '">' + (i === phaseIndex ? '❯ ' : '  ') + icon(pa.some(a => a.state === 'failed') ? 'failed' : pa.every(a => ['done','cached'].includes(a.state)) ? 'done' : pa.some(a => a.state === 'running') ? 'running' : 'queued') + ' ' + p.title + ' ' + done + '/' + pa.length + '</div>';
      }).join('');
      const agentHtml = ags.map((a, i) => '<div class="agent ' + (i === agentIndex ? 'selected' : '') + '">' +
        '<div class="title">' + icon(a.state) + ' ' + a.label + '</div>' +
        '<div class="meta">' + a.model + '/' + a.effort + ' · ' + fmtTokens(a.tokens) + ' tok · ' + a.toolCalls + ' tools · ' + (a.durationMs === undefined ? a.state : fmtDuration(a.durationMs)) + '</div>' +
      '</div>').join('') || '<div class="muted">No agents in this phase</div>';
      const details = [
        '<b>Prompt</b><pre>' + trunc(selected?.promptPreview, 1200) + '</pre>',
        '<b>Activity</b><pre>' + trunc((selected?.lastToolName || selected?.state || 'none') + (selected?.lastToolSummary ? ' — ' + selected.lastToolSummary : ''), 1200) + '</pre>',
        '<b>Outcome</b><pre>' + trunc(selected?.error || selected?.resultPreview || 'none', 2000) + '</pre>',
      ];
      const visibleDetails = view === 'agent' ? details.slice(detailScroll) : details;
      document.getElementById('detail').innerHTML =
        '<h2>' + run.workflowId + ' ' + run.workflowName + '</h2>' +
        '<div class="meta">' + run.status + ' · ' + doneAgents(run) + '/' + agents(run).length + ' agents · ' + fmtDuration(run.durationMs || 0) + ' · ' + fmtTokens(run.totalTokens || 0) + ' tok</div>' +
        '<div class="grid"><div class="box"><b>Phases</b>' + phaseHtml + '</div><div class="box"><b>' + phase.title + ' · ' + ags.length + ' agent' + (ags.length === 1 ? '' : 's') + '</b><div class="agents">' + agentHtml + '</div></div></div>' +
        '<div class="box" style="margin-top:10px"><div class="meta">' + (view === 'agent' ? 'Agent details · j/k scroll · ← back' : 'Workflow detail · → agent details') + '</div>' + visibleDetails.join('') + '</div>';
    }
    function render(){ renderRuns(); renderDetail(); }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'r') { refresh(); return; }
      if (e.key === 'Escape') { view = 'list'; render(); return; }
      if (e.key === 'Enter' || e.key === 'ArrowRight') {
        if (view === 'list') view = 'workflow';
        else if (view === 'workflow') view = 'agent';
        detailScroll = 0;
        render();
        return;
      }
      if (e.key === 'ArrowLeft') {
        if (view === 'agent') view = 'workflow';
        else if (view === 'workflow') view = 'list';
        detailScroll = 0;
        render();
        return;
      }
      if (view === 'list') {
        if (e.key === 'ArrowDown') runIndex++;
        if (e.key === 'ArrowUp') runIndex--;
        phaseIndex = 0; agentIndex = 0;
      } else if (view === 'agent') {
        if (e.key === 'j' || e.key === 'ArrowDown') detailScroll++;
        if (e.key === 'k' || e.key === 'ArrowUp') detailScroll = Math.max(0, detailScroll - 1);
      } else {
        if (e.key === 'ArrowDown') phaseIndex++;
        if (e.key === 'ArrowUp') phaseIndex--;
      }
      render();
    });
    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>`;
}

async function startServer(instanceId, root) {
  let entry = servers.get(instanceId);
  if (entry) return entry;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/api/runs") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(loadRuns(root)));
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(renderHtml(root));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  entry = { server, root, url: `http://127.0.0.1:${port}/` };
  servers.set(instanceId, entry);
  return entry;
}

let session;
const canvas = createCanvas({
  id: "workflow-ui",
  displayName: "Workflows",
  description: "Interactive browser for copilot-workflows runs",
  inputSchema: {
    type: "object",
    properties: { root: { type: "string" } },
  },
  actions: [
    {
      name: "refresh",
      description: "Refresh workflow run data",
      handler: async () => ({ ok: true }),
    },
  ],
  open: async (ctx) => {
    const root = typeof ctx.input?.root === "string" ? ctx.input.root : DEFAULT_ROOT;
    const entry = await startServer(ctx.instanceId, root);
    return {
      title: "Workflows",
      status: `${loadRuns(root).length} runs`,
      url: entry.url,
    };
  },
  onClose: async (ctx) => {
    const entry = servers.get(ctx.instanceId);
    if (entry) {
      servers.delete(ctx.instanceId);
      await new Promise((resolve) => entry.server.close(resolve));
    }
  },
});

async function openWorkflows(root = DEFAULT_ROOT) {
  if (!session.capabilities.ui?.canvases) {
    return openWorkflowsInTmux(root);
  }
  return session.rpc.canvas.open({
    canvasId: "workflow-ui",
    instanceId: INSTANCE_ID,
    input: { root },
  });
}

async function openWorkflowsInTmux(root = DEFAULT_ROOT) {
  if (!process.env.TMUX) {
    await session.log("This Copilot host does not report canvas support and this session is not inside tmux; run `copilot-workflow ui` in a terminal.", { level: "warning" });
    return { ok: false, reason: "no_canvas_or_tmux" };
  }
  const target = process.env.TMUX_PANE;
  const args = [
    "display-popup",
    ...(target ? ["-t", target] : []),
    "-E",
    "-w",
    "92%",
    "-h",
    "86%",
    "-d",
    REPO_ROOT,
    `${WORKFLOW_BIN} ui`,
  ];
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("tmux", args, { stdio: "ignore", detached: true });
    child.once("error", rejectPromise);
    child.once("spawn", resolvePromise);
    child.unref();
  });
  await session.log("Opened workflow UI in a tmux popup. Press q to close it.", { ephemeral: true });
  return { ok: true, surface: "tmux-popup" };
}

session = await joinSession({
  canvases: [canvas],
  extensionInfo: { source: "project", name: "workflow-ui" },
  commands: [
    {
      name: "workflows",
      description: "Open the interactive workflow browser",
      handler: async (ctx) => {
        await openWorkflows(ctx.args?.trim() || DEFAULT_ROOT);
      },
    },
  ],
  tools: [
    {
      name: "open_workflow_ui",
      description: "Open the interactive workflow browser canvas in the current Copilot session.",
      skipPermission: true,
      parameters: {
        type: "object",
        properties: { root: { type: "string", description: "Workflow state root; defaults to ~/.copilot/workflows" } },
      },
      handler: async (args) => openWorkflows(typeof args?.root === "string" ? args.root : DEFAULT_ROOT),
    },
  ],
});

await session.log("Workflow UI extension loaded. Run /workflows to open the interactive workflow browser.", { ephemeral: true });
