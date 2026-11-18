# copilot-cc

Use Claude Code with the chat models available to your GitHub Copilot account.

## Install
Use Python 3.10 or newer, GitHub CLI, and Claude Code 2.1.280 or newer.
Install the proxy dependency from this directory:

```bash
python3 -m pip install -r requirements.txt
```

## Run
1. Sign in with `gh auth login`, run `python copilot_connector.py auth`, or supply a supported token environment variable.
2. Start the proxy: `python3 copilot_connector.py serve`.
3. Launch Claude through `./claude-copilot` so it only targets the local bridge and always uses `--dangerously-skip-permissions`.

Use a separate GitHub CLI configuration and port for another subscription:

```bash
env -u COPILOT_GITHUB_TOKEN -u GH_TOKEN -u GITHUB_TOKEN \
  GH_CONFIG_DIR="$HOME/.config/gh-other" \
  python3 copilot_connector.py serve --port 4142

COPILOT_CC_BASE_URL=http://127.0.0.1:4142 ./claude-copilot
```

The proxy caches its credentials until restart. Each process fetches its own account's catalog and caches it for five minutes.

## Model picker and protocols

Open `/model` to select an enabled chat model from that proxy's Copilot catalog.
Each model has one entry, labeled `1M client context`, that selects its `[1m]` variant by default.
The proxy strips this client-only suffix before sending the original model ID upstream.
The picker excludes embeddings, hidden utility models, disabled models, and endpoints the bridge cannot translate.

New launches refresh the picker through `GET /model-picker`. `GET /v1/models` exposes the eligible catalog and its capability metadata.
New OpenAI models appear automatically when the account's catalog enables them.
Catalog or authentication failures stop the launcher with an error instead of presenting a stale catalog.

| Upstream endpoint | Models | Local interface |
| --- | --- | --- |
| `/v1/messages` | Native Claude models | Messages passthrough |
| `/responses` | Catalog-listed GPT, Grok, and MAI models | Messages translation |
| `/chat/completions` | Catalog-listed Gemini models and other chat-only models | Messages translation |

The catalog determines routing, not a fixed provider list. The bridge prefers native Messages, then Responses, then Chat Completions.
Translations cover streaming and non-streaming text, images, function tools, tool results, and opaque reasoning state.

Responses replay preserves item order and message phases even when Claude moves reasoning blocks before text.
If saved text or tool content changes, the proxy omits stale replay metadata and logs a warning.
Chat Completions tool calls wait until the stream completes because their names can arrive in fragments.

Provider errors retain their HTTP status. An interrupted translated stream sends an SSE error instead of a successful completion.
Unsupported document blocks and server-side tools return explicit errors.
The launcher defaults `ENABLE_TOOL_SEARCH=false` because Anthropic's server-side tool-search protocol is unavailable through the other endpoints.

## Claude Code settings
`./claude-copilot` clears Anthropic auth tokens and HTTP proxy variables from the child environment.
It still loads user, project, and local settings. Environment cleanup does not isolate credential helpers or other settings.
Keep `DISABLE_PROMPT_CACHING` unset.
Set concurrency to `<=4`.

The launcher passes `--model 'claude-opus-5.5[1m]'` and defaults both `ANTHROPIC_MODEL` and `ANTHROPIC_DEFAULT_OPUS_MODEL` to `claude-opus-5.5`.
The catalog picker labels this selection `Claude Opus 5.5 (1M client context)`.

The Sonnet and Haiku aliases retain their existing `claude-sonnet-5` defaults. Selecting Haiku through that alias therefore uses Sonnet.
Newer Sonnet and Haiku models appear under their own names when the account enables them.
Override `ANTHROPIC_DEFAULT_SONNET_MODEL` and `ANTHROPIC_DEFAULT_HAIKU_MODEL` to change those aliases.

Explicit `--model`, `CLAUDE_CODE_MODEL`, and `ANTHROPIC_*` model overrides remain supported. An explicitly pinned Haiku model is not silently redirected by the proxy.
The bridge normalizes known hyphenated Claude IDs to Copilot's dotted IDs.
Explicit `--settings` JSON or files merge over the generated settings. An explicit `modelPicker` replaces the generated picker.
Custom entries supplied through `ANTHROPIC_CUSTOM_MODEL_OPTION*` remain visible.

Use Claude Code 2.1.280 or newer. The picker uses `modelPicker.behavesAs` to enable Claude-side controls while preserving the outgoing model ID.
Those compatibility settings also affect Claude's context window and dollar estimates. They do not establish Copilot capacity or billing rates.
Read each row's upstream context and maximum input limits. Selecting the 1M client window cannot raise those account-side limits.
Different subscriptions can have different limits for the same model.
For translated requests, the proxy caps output budgets at the catalog limit and logs the adjustment.

Restart each existing proxy to load these routes, then relaunch Claude Code through the launcher.
`COPILOT_CC_SKIP_PROXY_CHECK=1` skips catalog loading for isolated tests or manual configuration.

## Reasoning effort and ultracode

Use Claude's effort controls or pass `--effort low|medium|high|xhigh|max`.
The launcher preserves `CLAUDE_CODE_EFFORT_LEVEL`, enables adaptive thinking, and keeps explicit settings.
Supported efforts pass through unchanged. Higher unsupported choices map to the backend's strongest advertised effort, with a picker description and proxy warning.

| Example model | Requested effort | Upstream effort |
| --- | --- | --- |
| GPT-6 Astra | `max` | `max` |
| Gemini 3.8 Flash | `xhigh` or `max` | `high` |
| Grok 4.7 | `max` | `xhigh` |
| MAI Code 1.1 Flash | `xhigh` or `max` | `high` |

The live catalog supplies these capabilities. Older native models without an effort parameter keep their own Claude controls.
The API also accepts `output_config.effort=none` where the backend advertises it.

Ultracode is Claude Code workflow orchestration, not an upstream reasoning-effort value.
Use `--effort ultracode` to enable it at `xhigh`, or `--settings '{"ultracode":true}'` to retain the selected effort.
Claude Code still requires dynamic workflows to be enabled for your session. The bridge does not grant workflow access or start workflows itself.
The same adapters handle individual subagent requests.

## Resume older sessions
Resume through the launcher from your project directory:

```bash
/path/to/agent-tools/copilot-cc/claude-copilot --resume SESSION_ID
/path/to/agent-tools/copilot-cc/claude-copilot --continue
```

The explicit launch model takes precedence over the model saved in the transcript.
Older sessions therefore resume on Opus 5.5 with the 1M client window selected, without rewriting their histories.
Explicit `--model` or `CLAUDE_CODE_MODEL` choices still win. If you override `ANTHROPIC_DEFAULT_OPUS_MODEL`, the launcher uses `opus[1m]` to follow that override instead.
An already-running process retains its old environment and picker. Exit and resume through the launcher after restarting the proxy.

Translating a resumed session preserves its text and tool history. The proxy omits incompatible reasoning state when switching providers and logs that omission.
It does not edit saved transcripts.

## Verify
1. `copilot-cc/tests/smoke.sh` (proxy must already be running on `127.0.0.1:4141`).
2. Confirm streaming output includes `message_start`, `content_block_delta`, `message_stop`.
3. Confirm `/v1/messages/count_tokens` returns `input_tokens`.
4. If auth or serve fail, rerun after checking `copilot login` state or env-token setup and the proxy logs.

Native token counting falls back to a text-length estimate when Copilot returns 404.
Translated token counts always use that estimate, which excludes images, tool schemas, and provider tokenization.
They are not a context-capacity check.
