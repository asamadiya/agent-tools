# Task: Copilot-CLI-backed Anthropic proxy for Claude Code

## Objective
A Python proxy (`copilot_connector.py`) that lets Claude Code keep
speaking Anthropic-compatible `/v1/messages` locally while GitHub Copilot sees a
Copilot CLI-style client upstream.

## Superseded constraint
The initial VS Code OAuth/device-flow contract is obsolete. Do not use the VS
Code app client id, do not run a connector-owned OAuth flow, and do not identify
upstream as VS Code. Runtime auth and upstream identity must match Copilot CLI.

## Current auth contract
- Auth source precedence: `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`,
  `gh auth token`, then `COPILOT_HOME/config.json` (`~/.copilot/config.json` by default).
- `gh auth token` inherits the proxy's `GH_CONFIG_DIR`.
- `auth` subcommand delegates to `copilot login`.
- If no token is available, fail with instructions to run `copilot login` or set
  one of the env tokens.
- Upstream requests use `Authorization: Bearer <token>` directly; do not call
  `https://api.github.com/copilot_internal/v2/token`.

## Upstream contract
- Local routes include `POST /v1/messages`, `POST /v1/messages/count_tokens`,
  `GET /v1/models`, and `GET /model-picker`.
- Default upstream base is `https://api.enterprise.githubcopilot.com`, override
  with `COPILOT_API_BASE`.
- Native Claude requests use Copilot's Anthropic `/v1/messages` route.
- For other models, `copilot_catalog.py` selects the endpoint from the account's
  catalog. `copilot_protocols.py` translates Messages to Responses or Chat Completions.
- Send Copilot CLI identity headers: `User-Agent`, `Editor-Version`,
  `Editor-Plugin-Version`, `Copilot-Integration-Id: copilot-developer-cli`,
  `Openai-Intent: conversation-agent`, `X-Initiator: user`, and
  `X-GitHub-Api-Version`.
- Do not forward Claude-local headers such as `anthropic-version`,
  `anthropic-beta`, `x-api-key`, or `x-claude-*`.

## Proxy behavior
- `sanitize()` removes `context_management`, normalizes known model aliases,
  and removes the client-side `[1m]` suffix.
- Map Claude Code's local Opus 4.8 alias `claude-opus-4-8` to Copilot's catalog
  id `claude-opus-4.8`; Copilot reports this model as supporting adaptive
  thinking and reasoning efforts `low`, `medium`, `high`, `xhigh`, and `max`.
- Also map `claude-opus-5-5` to the Copilot catalog id `claude-opus-5.5`.
- Default Claude Code launcher model argument is `--model 'claude-opus-5.5[1m]'`,
  with a selected `/model` entry named `Claude Opus 5.5 (1M client context)`.
  Default Opus family and `ANTHROPIC_MODEL` values are `claude-opus-5.5`;
  the default Sonnet family model is `claude-sonnet-5`.
  The Haiku alias retains its Sonnet 5 default. New catalog entries do not
  change those aliases automatically.
  Preserve environment overrides and explicit model selection; do not redirect
  pinned older or unsupported model IDs to different versions or families.
- Apply the same default on `--resume` and `--continue`, taking precedence over
  the transcript's saved model without rewriting histories. Preserve explicit
  model flags, `CLAUDE_CODE_MODEL`, and custom picker entries. When the Opus
  family model is overridden, keep `opus[1m]` selection for that override.
- Use Claude Code 2.1.280+ for built-in Opus 5.5 support and the configurable picker.
- The picker lists enabled, picker-visible chat models for the proxy's account.
  Each model has one `[1m]` entry labeled `1M client context`, including newly
  enabled OpenAI models. Strip the suffix before upstream routing.
  Each process caches the catalog for five minutes. Failed fetches return explicit errors.
- Picker descriptions show upstream context and maximum input limits. The 1M
  client window cannot raise account-side limits. The compatibility model
  enables effort controls but also affects client context and dollar estimates.
- Preserve native `cache_control`, `thinking`, and `output_config`, except
  catalog-based effort mappings. Remove bridge-specific reasoning state when
  switching back to native Claude.
- Stream native upstream bytes verbatim with upstream status and `Content-Type`.
- Translated streams preserve text, function arguments, usage, and opaque
  reasoning state. Correlate Responses events by index because Copilot IDs can change.
- Map unsupported higher efforts to the strongest advertised level. Disclose
  mappings in the picker and proxy log. Reject unknown effort names.
- Ultracode remains client-side workflow orchestration. Preserve its settings
  and route subagent requests without changing workflow permissions.
- If native `count_tokens` returns 404, return a `len(text)//4` estimate as
  `{"input_tokens": N}`.
- Translated token counts use the same text-only estimate and log that limitation.
- The launcher defaults `ENABLE_TOOL_SEARCH=false` for cross-provider compatibility.
- Explicit `--settings` values merge over generated picker settings.
- Keep automated concurrency at or below 4.

## Acceptance
- Unit tests prove the Copilot CLI auth source order, GitHub CLI fallback,
  Copilot CLI upstream identity, Claude-header stripping, no internal token
  exchange, passthrough streaming, count fallback, and cache-control behavior.
- Live smoke: `tests/smoke.sh` succeeds against a running proxy.
- Claude Code launches through `claude-copilot`, has no Anthropic auth token in
  its process environment, targets only the local bridge in best-effort env-only
  isolation, defaults to Opus 5.5 with a 1M client context window and
  sends `claude-opus-5.5` to Copilot, enables adaptive thinking, and leaves effort
  selection to Claude Code. Sonnet and Haiku aliases both send `claude-sonnet-5`.
