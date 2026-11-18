import json
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / "claude-copilot"


@pytest.fixture
def launch_claude(tmp_path):
    fake_claude = tmp_path / "claude"
    capture = tmp_path / "capture.json"
    fake_claude.write_text(
        f"""#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path

Path({str(capture)!r}).write_text(json.dumps({{
    "argv": sys.argv[1:],
    "env": {{key: os.environ.get(key) for key in [
        "ANTHROPIC_BASE_URL",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
        "ANTHROPIC_CUSTOM_MODEL_OPTION",
        "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME",
        "ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "MAX_THINKING_TOKENS",
        "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING",
        "CLAUDE_CODE_EFFORT_LEVEL",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
        "CLAUDE_CODE_ATTRIBUTION_HEADER",
        "ENABLE_TOOL_SEARCH",
    ]}},
}}))
""",
        encoding="utf-8",
    )
    fake_claude.chmod(0o755)

    env = os.environ.copy()
    for key in (
        "ANTHROPIC_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL",
        "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
        "ANTHROPIC_CUSTOM_MODEL_OPTION",
        "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME",
        "ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION",
        "ANTHROPIC_DEFAULT_SONNET_MODEL",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        "CLAUDE_CODE_MODEL",
        "COPILOT_CC_BASE_URL",
        "MAX_THINKING_TOKENS",
        "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
        "CLAUDE_CODE_ATTRIBUTION_HEADER",
        "COPILOT_CC_SKIP_PROXY_CHECK",
        "ENABLE_TOOL_SEARCH",
    ):
        env.pop(key, None)
    env.update(
        {
            "PATH": f"{tmp_path}:{env.get('PATH', '')}",
            "ANTHROPIC_AUTH_TOKEN": "must-not-reach-claude",
            "ANTHROPIC_API_KEY": "must-not-reach-claude",
            "HTTP_PROXY": "http://127.0.0.1:9",
            "HTTPS_PROXY": "http://127.0.0.1:9",
            "ALL_PROXY": "http://127.0.0.1:9",
            "COPILOT_CC_SKIP_PROXY_CHECK": "1",
        }
    )

    def run(args=None, overrides=None):
        subprocess.run(
            [str(LAUNCHER), *(args or []), "-p", "hello"],
            check=True,
            env={**env, **(overrides or {})},
            cwd=ROOT.parent,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        return json.loads(capture.read_text(encoding="utf-8"))

    return run


def test_launcher_runs_claude_with_local_bridge_and_no_anthropic_token(launch_claude):
    captured = launch_claude()
    assert "--dangerously-skip-permissions" in captured["argv"]
    assert "--setting-sources" in captured["argv"]
    assert "user,project,local" in captured["argv"]
    assert "--model" in captured["argv"]
    assert captured["argv"][captured["argv"].index("--model") + 1] == "claude-opus-5.5[1m]"
    assert captured["argv"][-2:] == ["-p", "hello"]
    assert captured["env"]["ANTHROPIC_BASE_URL"] == "http://127.0.0.1:4141"
    assert captured["env"]["ANTHROPIC_AUTH_TOKEN"] is None
    assert captured["env"]["ANTHROPIC_API_KEY"] is None
    assert captured["env"]["ANTHROPIC_MODEL"] == "claude-opus-5.5"
    assert captured["env"]["ANTHROPIC_DEFAULT_OPUS_MODEL"] == "claude-opus-5.5"
    assert captured["env"]["ANTHROPIC_DEFAULT_OPUS_MODEL_NAME"] == "Opus 5.5"
    assert captured["env"]["ANTHROPIC_CUSTOM_MODEL_OPTION"] == "claude-opus-5.5[1m]"
    assert captured["env"]["ANTHROPIC_CUSTOM_MODEL_OPTION_NAME"] == "Opus 5.5 (1M context)"
    assert captured["env"]["ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION"] == "Copilot / claude-opus-5.5[1m]"
    assert captured["env"]["ANTHROPIC_DEFAULT_SONNET_MODEL"] == "claude-sonnet-5"
    assert captured["env"]["ANTHROPIC_DEFAULT_HAIKU_MODEL"] == "claude-sonnet-5"
    assert captured["env"]["HTTP_PROXY"] is None
    assert captured["env"]["HTTPS_PROXY"] is None
    assert captured["env"]["ALL_PROXY"] is None
    assert captured["env"]["MAX_THINKING_TOKENS"] == "4096"
    assert captured["env"]["CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING"] == "0"
    assert captured["env"]["CLAUDE_CODE_EFFORT_LEVEL"] is None
    assert captured["env"]["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"] == "1"
    assert captured["env"]["CLAUDE_CODE_ATTRIBUTION_HEADER"] == "0"


def test_launcher_preserves_model_and_proxy_environment_overrides(launch_claude):
    overrides = {
        "ANTHROPIC_MODEL": "claude-opus-4.8",
        "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4.8",
        "ANTHROPIC_DEFAULT_SONNET_MODEL": "custom-sonnet",
        "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-haiku-4.5",
        "CLAUDE_CODE_MODEL": "sonnet",
        "COPILOT_CC_BASE_URL": "http://127.0.0.1:4142",
    }
    captured = launch_claude(overrides=overrides)
    for key, value in overrides.items():
        if key.startswith("ANTHROPIC_"):
            assert captured["env"][key] == value
    assert captured["env"]["ANTHROPIC_BASE_URL"] == overrides["COPILOT_CC_BASE_URL"]
    assert captured["argv"][captured["argv"].index("--model") + 1] == "sonnet"


@pytest.mark.parametrize("args", [["--model", "sonnet"], ["--model=sonnet"]])
def test_launcher_preserves_explicit_model_argument(launch_claude, args):
    captured = launch_claude(args=args, overrides={"CLAUDE_CODE_MODEL": "opus[1m]"})
    model_flags = [arg for arg in captured["argv"] if arg == "--model" or arg.startswith("--model=")]
    assert len(model_flags) == 1
    assert captured["argv"][-(len(args) + 2):] == [*args, "-p", "hello"]


@pytest.mark.parametrize(
    "args",
    [
        ["--resume", "old-session-id"],
        ["--resume=old-session-id"],
        ["-r", "old-session-id"],
        ["--continue"],
        ["-c"],
    ],
)
@pytest.mark.parametrize("model_args", [[], ["--model", "sonnet"], ["--model=sonnet"]])
def test_launcher_sets_resume_default_without_overriding_explicit_model(launch_claude, args, model_args):
    captured = launch_claude(args=[*args, *model_args])
    argv = captured["argv"]
    selected_models = [
        argv[i + 1] if arg == "--model" else arg.split("=", 1)[1]
        for i, arg in enumerate(argv)
        if arg == "--model" or arg.startswith("--model=")
    ]
    assert selected_models == ["sonnet" if model_args else "claude-opus-5.5[1m]"]
    assert argv[-(len(args) + len(model_args) + 2):] == [*args, *model_args, "-p", "hello"]
    assert captured["env"]["ANTHROPIC_DEFAULT_OPUS_MODEL"] == "claude-opus-5.5"
    assert captured["env"]["ANTHROPIC_DEFAULT_OPUS_MODEL_NAME"] == "Opus 5.5"


def test_launcher_does_not_label_an_older_opus_override_as_55(launch_claude):
    captured = launch_claude(overrides={"ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4.8"})
    assert captured["env"]["ANTHROPIC_DEFAULT_OPUS_MODEL"] == "claude-opus-4.8"
    assert captured["env"]["ANTHROPIC_DEFAULT_OPUS_MODEL_NAME"] is None
    assert captured["env"]["ANTHROPIC_CUSTOM_MODEL_OPTION"] is None
    assert captured["env"]["ANTHROPIC_CUSTOM_MODEL_OPTION_NAME"] is None
    assert captured["argv"][captured["argv"].index("--model") + 1] == "opus[1m]"


def test_launcher_preserves_custom_opus_display_name(launch_claude):
    captured = launch_claude(overrides={"ANTHROPIC_DEFAULT_OPUS_MODEL_NAME": "My Opus endpoint"})
    assert captured["env"]["ANTHROPIC_DEFAULT_OPUS_MODEL_NAME"] == "My Opus endpoint"


def test_launcher_preserves_existing_custom_model_option(launch_claude):
    overrides = {
        "ANTHROPIC_CUSTOM_MODEL_OPTION": "my-model",
        "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME": "My model",
        "ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION": "My deployment",
    }
    captured = launch_claude(overrides=overrides)
    for key, value in overrides.items():
        assert captured["env"][key] == value


def test_launcher_does_not_label_an_unrelated_custom_option_as_opus(launch_claude):
    captured = launch_claude(overrides={"ANTHROPIC_CUSTOM_MODEL_OPTION": "my-model"})
    assert captured["env"]["ANTHROPIC_CUSTOM_MODEL_OPTION"] == "my-model"
    assert captured["env"]["ANTHROPIC_CUSTOM_MODEL_OPTION_NAME"] is None
    assert captured["env"]["ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION"] is None


@pytest.fixture
def catalog_server():
    settings = {"modelPicker": {"replaceBuiltInOptions": True, "options": [
        {"model": "gpt-test[1m]", "label": "GPT Test (1M client context)", "behavesAs": "claude-opus-5-5"},
        {"model": "gemini-test[1m]", "label": "Gemini Test (1M client context)", "behavesAs": "claude-opus-5-5"},
    ]}}
    paths = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            paths.append(self.path)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(settings).encode())

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", settings, paths
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_launcher_loads_account_picker_without_credentials_and_preserves_effort(launch_claude, catalog_server):
    url, settings, paths = catalog_server
    result = launch_claude(overrides={
        "COPILOT_CC_SKIP_PROXY_CHECK": "0", "COPILOT_CC_BASE_URL": url, "CLAUDE_CODE_EFFORT_LEVEL": "max"})
    assert paths == ["/model-picker"]
    argv = result["argv"]
    assert json.loads(argv[argv.index("--settings") + 1]) == settings
    assert result["env"]["CLAUDE_CODE_EFFORT_LEVEL"] == "max"
    assert result["env"]["ENABLE_TOOL_SEARCH"] == "false"
    assert result["env"]["ANTHROPIC_AUTH_TOKEN"] is None


@pytest.mark.parametrize("inline", [True, False])
def test_launcher_merges_explicit_settings_without_losing_ultracode_or_model_picker(
    launch_claude, catalog_server, tmp_path, inline
):
    url, settings, _ = catalog_server
    custom = {"ultracode": True, "effortLevel": "xhigh"}
    path = tmp_path / "settings.json"
    path.write_text(json.dumps(custom))
    value = json.dumps(custom) if inline else str(path)
    result = launch_claude(args=["--settings", value, "--model", "gpt-test"],
                           overrides={"COPILOT_CC_SKIP_PROXY_CHECK": "0", "COPILOT_CC_BASE_URL": url})
    argv = result["argv"]
    assert argv.count("--settings") == 1
    assert json.loads(argv[argv.index("--settings") + 1]) == {**settings, **custom}
    assert argv[argv.index("--model") + 1] == "gpt-test"


def test_launcher_respects_explicit_picker_override(launch_claude, catalog_server):
    url, _, _ = catalog_server
    custom = {"modelPicker": {"options": [{"model": "my-model"}]}}
    result = launch_claude(args=["--settings=" + json.dumps(custom)],
                          overrides={"COPILOT_CC_SKIP_PROXY_CHECK": "0", "COPILOT_CC_BASE_URL": url})
    argv = result["argv"]
    assert json.loads(argv[argv.index("--settings") + 1]) == custom


def test_launcher_keeps_explicit_custom_picker_row_visible(launch_claude, catalog_server):
    url, _, _ = catalog_server
    result = launch_claude(overrides={
        "COPILOT_CC_SKIP_PROXY_CHECK": "0", "COPILOT_CC_BASE_URL": url,
        "ANTHROPIC_CUSTOM_MODEL_OPTION": "my-model",
        "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME": "My deployment",
    })
    argv = result["argv"]
    options = json.loads(argv[argv.index("--settings") + 1])["modelPicker"]["options"]
    assert next(option for option in options if option["model"] == "my-model")["label"] == "My deployment"


def test_launcher_does_not_duplicate_catalog_model_as_short_context_custom_row(launch_claude, catalog_server):
    url, settings, _ = catalog_server
    result = launch_claude(overrides={
        "COPILOT_CC_SKIP_PROXY_CHECK": "0", "COPILOT_CC_BASE_URL": url,
        "ANTHROPIC_CUSTOM_MODEL_OPTION": "gpt-test",
    })
    argv = result["argv"]
    assert json.loads(argv[argv.index("--settings") + 1]) == settings
