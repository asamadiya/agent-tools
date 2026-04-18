"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const ANSI_PATTERN = /\u001b\[[0-9;]*m/gu;

const DEFAULT_SETTINGS = {
  useUnicode: !String(process.env.LANG || "").toLowerCase().includes("ascii"),
  color: !process.env.NO_COLOR,
  maxWidth: 140,
  gitRefreshMs: 5000,
  display: {
    showModel: false,
    showPromptLabel: false,
    showProject: true,
    showGit: true,
    showUsage: true,
    showTiming: true,
    showTools: false,
    showAgents: true,
    maxTools: 2,
    maxAgents: 2,
  },
};

function defaultSettings() {
  return cloneDeep(DEFAULT_SETTINGS);
}

function defaultState() {
  return {
    version: 1,
    updatedAt: 0,
    session: {},
    tools: [],
    agents: [],
    gitCache: {},
  };
}

function mergeSettings(...layers) {
  const base = defaultSettings();
  for (const layer of layers) {
    if (!layer || typeof layer !== "object") continue;
    Object.assign(base, layer);
    if (layer.display && typeof layer.display === "object") {
      base.display = { ...DEFAULT_SETTINGS.display, ...(layers[0]?.display || {}), ...layer.display };
    }
  }
  base.display = { ...DEFAULT_SETTINGS.display, ...(base.display || {}) };
  return base;
}

function cloneDeep(value) {
  return JSON.parse(JSON.stringify(value));
}

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}

function writeJsonAtomically(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value)}\n`, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function render(status, settings, state, options) {
  const opts = options || {};
  const now = opts.now || Date.now();
  status = status || {};
  state = state || defaultState();
  const cwd = status.cwd || state.session?.cwd || opts.cwd || process.cwd();
  if (cwd) {
    state.session = state.session || {};
    state.session.cwd = cwd;
  }

  const gitInfo = settings.display.showGit ? getGitInfo(state, cwd, settings.gitRefreshMs, now) : { info: {}, changed: false };
  const context = readContext(status);
  const usage = readUsage(status);
  const requests = usage.requests ?? 0;
  const durationSec = readDurationSeconds(status, state, now);
  const apiDurationSec = readApiDurationSeconds(status);
  const throughput = usage.outputTokens != null && apiDurationSec > 0
    ? usage.outputTokens / apiDurationSec
    : null;

  const segments = [
    {
      priority: 100, optional: false,
      full: colorize(settings, "cyan",
        [settings.display.showModel ? compactModel(status) : "",
         settings.display.showPromptLabel ? sessionLabel(status, state) : ""]
        .filter(Boolean).join(` ${settings.useUnicode ? "·" : "-"} `)),
      short: colorize(settings, "cyan",
        settings.display.showPromptLabel ? sessionLabel(status, state) :
        (settings.display.showModel ? compactModel(status) : "")),
    },
    {
      priority: 95, optional: false,
      full: colorize(settings, "magenta", locationLabel(cwd, gitInfo.info, settings)),
      short: colorize(settings, "magenta", shortLocationLabel(cwd, gitInfo.info, settings)),
    },
    {
      priority: 90, optional: false,
      full: colorize(settings, contextColor(context.usedPercentage),
        `ctx ${progressBar(context.usedPercentage, settings)} ${formatPercent(context.usedPercentage)}${formatFraction(context.usedTokens, context.contextSize)}`),
      short: colorize(settings, contextColor(context.usedPercentage), `ctx ${formatPercent(context.usedPercentage)}`),
    },
    {
      priority: 85, optional: false,
      full: colorize(settings, "yellow", `req ${requests}`),
      short: colorize(settings, "yellow", `r ${requests}`),
    },
    settings.display.showUsage ? {
      priority: 80, optional: true,
      full: colorize(settings, "green", usageLabel(usage)),
      short: colorize(settings, "green", shortUsageLabel(usage)),
    } : null,
    settings.display.showTiming ? {
      priority: 75, optional: true,
      full: colorize(settings, "blue", timingLabel(durationSec, throughput, settings)),
      short: colorize(settings, "blue", shortTimingLabel(durationSec, throughput)),
    } : null,
    settings.display.showTools ? {
      priority: 65, optional: true,
      full: colorize(settings, "white", activityLabel("tl", state.tools, settings.display.maxTools, settings)),
      short: colorize(settings, "white", activityLabel("t", state.tools, 1, settings)),
    } : null,
    settings.display.showAgents ? {
      priority: 60, optional: true,
      full: colorize(settings, "white", activityLabel("ag", state.agents, settings.display.maxAgents, settings)),
      short: colorize(settings, "white", activityLabel("a", state.agents, 1, settings)),
    } : null,
  ].filter(Boolean).filter((segment) => segment.full && !segment.full.endsWith(" - "));

  const width = detectWidth(settings.maxWidth, opts.columns);
  const rendered = fitSegments(segments, width, separator(settings));
  return { line: rendered, stateChanged: gitInfo.changed, state };
}

function getGitInfo(state, cwd, refreshMs, now) {
  const cache = state.gitCache || {};
  const cached = cache[cwd];
  if (cached && now - (cached.refreshedAt || 0) < refreshMs) {
    return { info: cached, changed: false };
  }
  const info = { branch: "", dirty: false, dirtyLabel: "", refreshedAt: now };
  try {
    info.branch = gitOutput(cwd,
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    const dirtyOutput = childProcess.execFileSync("git",
      ["-C", cwd, "status", "--porcelain"],
      { encoding: "utf8", timeout: 200, stdio: ["ignore", "pipe", "ignore"] });
    info.dirty = Boolean(dirtyOutput.trim());
    info.dirtyLabel = info.dirty ? "dirty" : "clean";
  } catch {
    info.branch = ""; info.dirty = false; info.dirtyLabel = "";
  }
  state.gitCache = cache;
  state.gitCache[cwd] = info;
  return { info, changed: true };
}

function gitOutput(cwd, ...commandSets) {
  for (const args of commandSets) {
    try {
      return childProcess.execFileSync("git", ["-C", cwd, ...args],
        { encoding: "utf8", timeout: 250, stdio: ["ignore", "pipe", "ignore"] });
    } catch {}
  }
  throw new Error("Unable to resolve git branch");
}

function readContext(status) {
  const context = status.context_window || {};
  const contextSize = numberOrNull(context.context_window_size, context.size, context.max_tokens, status.max_prompt_tokens);
  const remainingTokens = numberOrNull(context.remaining_tokens, context.available_tokens);
  const usedTokens = numberOrNull(context.used_tokens, context.prompt_tokens) ??
    (contextSize != null && remainingTokens != null ? contextSize - remainingTokens : null);
  const usedPercentage = numberOrNull(context.used_percentage, context.percentage_used, context.percent_used) ??
    (usedTokens != null && contextSize ? Math.round((usedTokens / contextSize) * 100) : null);
  return { contextSize, usedTokens, usedPercentage };
}

function readUsage(status) {
  const context = status.context_window || {};
  const currentUsage = context.current_usage || {};
  return {
    requests: numberOrNull(
      status.cost?.total_premium_requests, status.requests, status.request_count,
      status.premium_requests, status.premium_requests_used, status.session_requests,
      status.cost?.requests, status.usage?.requests) ?? 0,
    inputTokens: numberOrNull(currentUsage.input_tokens, context.total_input_tokens,
      status.tokens_in, status.input_tokens, status.prompt_tokens,
      status.cost?.tokens_in, status.cost?.input_tokens, status.usage?.tokens_in, status.usage?.input_tokens),
    outputTokens: numberOrNull(currentUsage.output_tokens, context.total_output_tokens,
      status.tokens_out, status.output_tokens, status.completion_tokens,
      status.cost?.tokens_out, status.cost?.output_tokens, status.usage?.tokens_out, status.usage?.output_tokens),
    cachedTokens: numberOrNull(currentUsage.cache_read_input_tokens, context.total_cache_read_tokens,
      currentUsage.cache_creation_input_tokens, context.total_cache_write_tokens,
      status.cached_tokens, status.cache_tokens, status.cost?.cache_tokens, status.usage?.cache_tokens),
  };
}

function readDurationSeconds(status, state, now) {
  const direct = numberOrNull(status.cost?.total_duration_ms, status.duration_sec, status.durationSeconds, status.duration);
  if (direct != null) return direct > 1000 ? Math.round(direct / 1000) : Math.round(direct);
  const startedAt = numberOrNull(state.session?.startedAt);
  if (startedAt == null) return 0;
  return Math.max(0, Math.round((now - startedAt) / 1000));
}

function readApiDurationSeconds(status) {
  const direct = numberOrNull(status.cost?.total_api_duration_ms, status.api_duration_ms);
  if (direct == null) return 0;
  return direct > 1000 ? Math.round(direct / 1000) : Math.round(direct);
}

function compactModel(status) {
  const modelValue = status.model?.display_name || status.model?.name || status.model || "model";
  const label = String(modelValue)
    .replace(/^claude-/u, "").replace(/^gpt-/u, "gpt ")
    .replace(/-/gu, " ")
    .replace(/\bsonnet\b/ui, "Sonnet").replace(/\bhaiku\b/ui, "Haiku")
    .replace(/\bopus\b/ui, "Opus").replace(/\bmini\b/ui, "mini")
    .replace(/\s+/gu, " ").trim();
  return `[${label}]`;
}

function sessionLabel(status, state) {
  const prompt = state.session?.lastPrompt;
  const sessionName = status.session_name;
  const label = prompt || sessionName || "";
  return label ? truncate(label, 28) : "";
}

function locationLabel(cwd, gitInfo, settings) {
  const project = settings.display.showProject ? path.basename(cwd || "") : "";
  const branch = settings.display.showGit && gitInfo?.branch
    ? `${settings.useUnicode ? "" : "git:"} ${gitInfo.branch} ${gitInfo.dirtyLabel || (gitInfo.dirty ? "dirty" : "clean")}`
    : "";
  return [project || (!settings.display.showProject ? "" : cwd || ""), branch]
    .filter(Boolean).join(` ${settings.useUnicode ? "·" : "-"} `);
}

function shortLocationLabel(cwd, gitInfo, settings) {
  const project = settings.display.showProject ? path.basename(cwd || "") : "";
  if (settings.display.showGit && gitInfo?.branch) {
    return project ? `${project}:${gitInfo.branch}:${gitInfo.dirty ? "dirty" : "clean"}`
                   : `${gitInfo.branch}:${gitInfo.dirty ? "dirty" : "clean"}`;
  }
  return project || "";
}

function usageLabel(usage) {
  const parts = [];
  if (usage.inputTokens != null) parts.push(`in ${formatCompact(usage.inputTokens)}`);
  if (usage.cachedTokens != null) parts.push(`cache ${formatCompact(usage.cachedTokens)}`);
  if (usage.outputTokens != null) parts.push(`out ${formatCompact(usage.outputTokens)}`);
  return parts.join(" ");
}

function shortUsageLabel(usage) {
  const parts = [];
  if (usage.inputTokens != null) parts.push(`i${formatCompact(usage.inputTokens)}`);
  if (usage.outputTokens != null) parts.push(`o${formatCompact(usage.outputTokens)}`);
  return parts.join(" ");
}

function timingLabel(durationSec, throughput, settings) {
  const parts = [];
  if (settings.display.showTiming && durationSec > 0) parts.push(`dur ${formatDuration(durationSec)}`);
  if (throughput != null && throughput > 0) parts.push(`spd ${formatCompact(throughput)}/s`);
  return parts.join(" ");
}

function shortTimingLabel(durationSec, throughput) {
  const parts = [];
  if (durationSec > 0) parts.push(formatDuration(durationSec));
  if (throughput != null && throughput > 0) parts.push(`${formatCompact(throughput)}/s`);
  return parts.join(" ");
}

function activityLabel(prefix, items, limit, settings) {
  if (!Array.isArray(items) || !items.length) return "";
  const shown = items.slice(0, Math.max(0, limit));
  if (!shown.length) return "";
  return `${prefix} ${shown.map((item) =>
    `${statusIcon(item.status, settings)}${compactActivity(item.detail, 14)}${item.count > 1 ? item.count : ""}`).join(" ")}`;
}

function compactActivity(value, maxLength) {
  return truncate(String(value || "")
    .replace(/^.*?:/u, (match) => (match.length > 10 ? match.slice(0, 10) : match))
    .replace(/\s+/gu, " ").trim(), maxLength);
}

function progressBar(percent, settings) {
  const size = 8;
  const normalized = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  const filled = Math.round((normalized / 100) * size);
  const fullChar = settings.useUnicode ? "█" : "#";
  const emptyChar = settings.useUnicode ? "░" : "-";
  return `${fullChar.repeat(filled)}${emptyChar.repeat(Math.max(0, size - filled))}`;
}

function separator(settings) { return settings.useUnicode ? " │ " : " | "; }

function fitSegments(segments, maxWidth, joiner) {
  const working = segments.map((segment) => ({ ...segment, current: segment.full, shortened: false, dropped: false }));
  if (joinedWidth(working, joiner) <= maxWidth) return joinSegments(working, joiner);
  for (const segment of [...working].sort((a, b) => a.priority - b.priority)) {
    if (segment.short && !segment.shortened && stripAnsi(segment.short) !== stripAnsi(segment.full)) {
      segment.current = segment.short; segment.shortened = true;
      if (joinedWidth(working, joiner) <= maxWidth) return joinSegments(working, joiner);
    }
  }
  for (const segment of [...working].sort((a, b) => a.priority - b.priority)) {
    if (!segment.optional) continue;
    segment.dropped = true;
    if (joinedWidth(working, joiner) <= maxWidth) return joinSegments(working, joiner);
  }
  return joinSegments(working.filter((s) => !s.dropped).slice(0, 3), joiner);
}

function joinedWidth(segments, joiner) { return visibleLength(joinSegments(segments, joiner)); }
function joinSegments(segments, joiner) {
  return segments.filter((s) => !s.dropped && s.current).map((s) => s.current).join(joiner);
}

function detectWidth(fallback, override) {
  if (override) return override;
  const envWidth = numberOrNull(process.env.COLUMNS);
  if (envWidth != null) return envWidth;
  if (process.stdout.isTTY && process.stdout.columns) return process.stdout.columns;
  return fallback;
}

function contextColor(percent) {
  if (percent == null) return "blue";
  if (percent >= 90) return "red";
  if (percent >= 75) return "yellow";
  return "green";
}

function statusIcon(status, settings) {
  if (status === "failure") return settings.useUnicode ? "✗" : "x";
  if (status === "denied") return "!";
  if (status === "running") return settings.useUnicode ? "◐" : "...";
  return settings.useUnicode ? "✓" : "+";
}

function colorize(settings, colorName, text) {
  if (!text) return "";
  if (!settings.color) return text;
  const codes = { blue: "\u001b[34m", cyan: "\u001b[36m", green: "\u001b[32m",
    magenta: "\u001b[35m", red: "\u001b[31m", white: "\u001b[37m", yellow: "\u001b[33m" };
  return `${codes[colorName] || ""}${text}\u001b[0m`;
}

function stripAnsi(text) { return String(text || "").replace(ANSI_PATTERN, ""); }
function visibleLength(text) { return stripAnsi(text).length; }

function truncate(text, maxLength) {
  const cleaned = String(text || "").replace(/\s+/gu, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

function formatPercent(value) { return value == null ? "--" : `${Math.max(0, Math.round(value))}%`; }

function formatFraction(used, total) {
  if (used == null || total == null || total <= 0) return "";
  return ` ${formatCompact(used)}/${formatCompact(total)}`;
}

function formatCompact(value) {
  if (value == null) return "--";
  if (Math.abs(value) < 1000) return `${Math.round(value)}`;
  const suffixes = ["k", "M", "B", "T"];
  let scaled = value, suffixIndex = -1;
  while (Math.abs(scaled) >= 1000 && suffixIndex < suffixes.length - 1) {
    scaled /= 1000; suffixIndex += 1;
  }
  const decimals = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
  return `${scaled.toFixed(decimals).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1")}${suffixes[suffixIndex]}`;
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  return remainderMinutes ? `${hours}h${remainderMinutes}m` : `${hours}h`;
}

function numberOrNull(...values) {
  for (const value of values) {
    if (value == null || value === "") continue;
    const number = Number(value);
    if (!Number.isNaN(number)) return number;
  }
  return null;
}

module.exports = {
  DEFAULT_SETTINGS,
  defaultSettings,
  defaultState,
  mergeSettings,
  readJson,
  writeJsonAtomically,
  safeJsonParse,
  render,
};
