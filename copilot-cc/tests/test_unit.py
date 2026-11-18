import asyncio
import inspect
import json
import sys
from pathlib import Path

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
import pytest


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import copilot_connector as cc  # noqa: E402


def _get_attr(*names):
    for name in names:
        value = getattr(cc, name, None)
        if value is not None:
            return value
    raise AssertionError(f"missing expected attribute; tried {names}")


async def _maybe_await(value):
    if inspect.isawaitable(value):
        return await value
    return value


def _call_with_supported_kwargs(callable_obj, **candidates):
    sig = inspect.signature(callable_obj)
    kwargs = {}
    for name in sig.parameters:
        if name in candidates:
            kwargs[name] = candidates[name]
    return callable_obj(**kwargs)


class _FakeExchangeResponse:
    def __init__(self, payload, delay=None):
        self._payload = payload
        self._delay = delay
        self.status = 200

    async def __aenter__(self):
        if self._delay is not None:
            await self._delay.wait()
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def json(self):
        return self._payload


class _FakeTokenExchangeSession:
    def __init__(self, payload, delay=None):
        self.payload = payload
        self.delay = delay
        self.calls = 0
        self.last_url = None
        self.last_headers = None

    def get(self, url, headers=None):
        self.calls += 1
        self.last_url = url
        self.last_headers = headers or {}
        return _FakeExchangeResponse(self.payload, self.delay)


class _FakeUpstreamContent:
    def __init__(self, chunks):
        self._chunks = list(chunks)

    async def iter_any(self):
        for chunk in self._chunks:
            yield chunk

    async def iter_chunked(self, _size):
        for chunk in self._chunks:
            yield chunk


class _FakeUpstreamResponse:
    def __init__(self, status, headers, chunks, body_json=None):
        self.status = status
        self.headers = headers
        self.content = _FakeUpstreamContent(chunks)
        self._body = b"".join(chunks)
        self._body_json = body_json

    async def read(self):
        return self._body

    async def text(self):
        return self._body.decode()

    async def json(self):
        if self._body_json is not None:
            return self._body_json
        return json.loads(self._body.decode())


class _FakeUpstreamRequestContext:
    def __init__(self, response, recorder):
        self.response = response
        self.recorder = recorder

    async def __aenter__(self):
        self.recorder["entered"] = self.recorder.get("entered", 0) + 1
        return self.response

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeUpstreamSession:
    def __init__(self, response_by_path):
        self.response_by_path = response_by_path
        self.calls = []
        self.recorder = {}

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        path = url.split("://", 1)[-1]
        path = path[path.find("/") :]
        response = self.response_by_path[path]
        return _FakeUpstreamRequestContext(response, self.recorder)

    def post(self, url, **kwargs):
        return self.request("POST", url, **kwargs)


class _FakeTokenManager:
    def __init__(self, api_base):
        self.api_base = api_base
        self.calls = 0

    async def get(self):
        self.calls += 1
        return ("jwt-123", self.api_base)

    async def get_token(self):
        return await self.get()


def _build_token_manager(session=None, **overrides):
    cls = _get_attr("TokenManager", "TokenMgr", "CopilotTokenManager")
    kwargs_options = [
        {"gh_token": "gho_test", "session": session, **overrides},
        {"gh_token": "gho_test", "client_session": session, **overrides},
        {"token": "gho_test", "session": session, **overrides},
        {"gh_token": "gho_test", **overrides},
        {**overrides},
        {},
    ]
    for kwargs in kwargs_options:
        try:
            sig = inspect.signature(cls)
            supported = {k: v for k, v in kwargs.items() if k in sig.parameters}
            return cls(**supported)
        except TypeError:
            continue
    raise AssertionError("could not construct token manager with supported arguments")


async def _call_token_manager(manager):
    for name in ("get", "get_token", "get_jwt", "token", "__call__"):
        method = getattr(manager, name, None)
        if method is None:
            continue
        result = method()
        return await _maybe_await(result)
    raise AssertionError("token manager missing a usable getter")


def _token_text(value):
    if isinstance(value, tuple):
        return value[0]
    return getattr(value, "token", value)


def test_sanitize_preserves_cache_control_maps_model_and_never_adds_thinking(monkeypatch):
    monkeypatch.setattr(cc, "MODEL_MAP", {"claude-opus-4.8": "copilot-opus"}, raising=False)
    sanitize = _get_attr("sanitize")

    body = {
        "model": "claude-opus-4.8",
        "max_tokens": 32,
        "messages": [{"role": "user", "content": "hello"}],
        "cache_control": {"type": "ephemeral"},
    }

    result = sanitize(body)

    assert result["model"] == "copilot-opus"
    assert result["cache_control"] == {"type": "ephemeral"}
    assert "thinking" not in result


def test_sanitize_preserves_thinking_and_effort_while_dropping_unsupported_context_management(monkeypatch):
    monkeypatch.setattr(cc, "MODEL_MAP", {}, raising=False)
    sanitize = _get_attr("sanitize")

    body = {
        "model": "claude-opus-4-8",
        "messages": [{"role": "user", "content": "hello"}],
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": "xhigh"},
        "context_management": {"clear_function_results": True},
    }

    result = sanitize(body)

    assert result["thinking"] == {"type": "adaptive"}
    assert result["output_config"] == {"effort": "xhigh"}
    assert "context_management" not in result


@pytest.mark.parametrize(
    ("model", "expected"),
    [
        ("claude-opus-4-8", "claude-opus-4.8"),
        ("claude-opus-5-5", "claude-opus-5.5"),
        ("claude-opus-5.5", "claude-opus-5.5"),
        ("claude-sonnet-5", "claude-sonnet-5"),
        ("claude-opus-5", "claude-opus-5"),
        ("claude-haiku-4.5", "claude-haiku-4.5"),
        ("custom-model", "custom-model"),
    ],
)
def test_sanitize_normalizes_opus_aliases_without_replacing_pinned_models(monkeypatch, model, expected):
    monkeypatch.setattr(cc, "MODEL_MAP", cc.DEFAULT_MODEL_MAP.copy(), raising=False)
    sanitize = _get_attr("sanitize")

    body = {
        "model": model,
        "messages": [{"role": "user", "content": "hello"}],
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": "xhigh"},
    }

    result = sanitize(body)

    assert result["model"] == expected
    assert result["thinking"] == {"type": "adaptive"}
    assert result["output_config"] == {"effort": "xhigh"}


def test_token_manager_returns_direct_github_token_and_default_api_base_without_network_calls():
    session = _FakeTokenExchangeSession({})
    manager = _build_token_manager(session)

    first = asyncio.run(_call_token_manager(manager))
    second = asyncio.run(_call_token_manager(manager))

    assert first == second == ("gho_test", cc.DEFAULT_COPILOT_API_BASE)
    assert session.calls == 0


def test_token_manager_honors_api_base_override_without_network_calls():
    session = _FakeTokenExchangeSession({})
    manager = _build_token_manager(session, api_base="https://api.example.test")

    result = asyncio.run(_call_token_manager(manager))

    assert result == ("gho_test", "https://api.example.test")
    assert session.calls == 0


def test_token_manager_loads_cli_token_once_when_not_injected(monkeypatch):
    session = _FakeTokenExchangeSession({})
    calls = []

    def fake_loader(**kwargs):
        calls.append(kwargs)
        return "loaded-from-cli-config"

    monkeypatch.setattr(cc, "load_copilot_cli_token", fake_loader)
    manager = _build_token_manager(session, gh_token=None)

    first = asyncio.run(_call_token_manager(manager))
    second = asyncio.run(_call_token_manager(manager))

    assert first == second == ("loaded-from-cli-config", cc.DEFAULT_COPILOT_API_BASE)
    assert len(calls) == 1
    assert session.calls == 0


def test_token_manager_offloads_cli_token_loading_outside_event_loop(monkeypatch):
    session = _FakeTokenExchangeSession({})
    loader_calls = []
    to_thread_calls = []

    def fake_loader(**kwargs):
        loader_calls.append(kwargs)
        return "loaded-without-blocking-loop"

    async def fake_to_thread(func, *args, **kwargs):
        to_thread_calls.append((func, args, kwargs))
        return func(*args, **kwargs)

    monkeypatch.setattr(cc, "load_copilot_cli_token", fake_loader)
    monkeypatch.setattr(cc.asyncio, "to_thread", fake_to_thread)
    manager = _build_token_manager(session, gh_token=None)

    async def run():
        return await manager.get_token()

    result = asyncio.run(run())

    assert result == ("loaded-without-blocking-loop", cc.DEFAULT_COPILOT_API_BASE)
    assert loader_calls == [{"copilot_home": None, "config_path": None}]
    assert to_thread_calls


def test_load_copilot_cli_token_selects_keyed_token_for_last_logged_in_user(monkeypatch, tmp_path):
    loader = _get_attr("load_copilot_cli_token", "get_copilot_cli_token", "_load_copilot_cli_token")

    monkeypatch.delenv("COPILOT_GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GH_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.setenv("COPILOT_HOME", str(tmp_path))
    monkeypatch.setattr(cc, "_load_gh_cli_token", lambda: None, raising=False)

    (tmp_path / "config.json").write_text(
        """
        {
          "lastLoggedInUser": "octocat",
          "copilotTokens": {
            "https://github.com:someone-else": "wrong-token",
            "https://github.com:octocat": "selected-token"
          }
        }
        """,
        encoding="utf-8",
    )

    token = _token_text(
        _call_with_supported_kwargs(
            loader,
            copilot_home=tmp_path,
            home=tmp_path,
            config_path=tmp_path / "config.json",
            config_file=tmp_path / "config.json",
            path=tmp_path / "config.json",
        )
    )

    assert token == "selected-token"


def test_load_copilot_cli_token_falls_back_to_logged_in_users(monkeypatch, tmp_path):
    loader = _get_attr("load_copilot_cli_token", "get_copilot_cli_token", "_load_copilot_cli_token")

    monkeypatch.delenv("COPILOT_GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GH_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.setenv("COPILOT_HOME", str(tmp_path))
    monkeypatch.setattr(cc, "_load_gh_cli_token", lambda: None, raising=False)

    (tmp_path / "config.json").write_text(
        """
        {
          "lastLoggedInUser": "octocat",
          "loggedInUsers": {
            "octocat": {
              "token": "logged-in-user-token"
            }
          }
        }
        """,
        encoding="utf-8",
    )

    token = _token_text(
        _call_with_supported_kwargs(
            loader,
            copilot_home=tmp_path,
            home=tmp_path,
            config_path=tmp_path / "config.json",
            config_file=tmp_path / "config.json",
            path=tmp_path / "config.json",
        )
    )

    assert token == "logged-in-user-token"


def test_load_copilot_cli_token_prefers_env_vars_in_copilot_order(monkeypatch):
    loader = _get_attr("load_copilot_cli_token", "get_copilot_cli_token", "_load_copilot_cli_token")

    monkeypatch.setenv("COPILOT_GITHUB_TOKEN", "copilot-env-token")
    monkeypatch.setenv("GH_TOKEN", "gh-env-token")
    monkeypatch.setenv("GITHUB_TOKEN", "github-env-token")

    first = _token_text(_call_with_supported_kwargs(loader))
    assert first == "copilot-env-token"

    monkeypatch.delenv("COPILOT_GITHUB_TOKEN")
    second = _token_text(_call_with_supported_kwargs(loader))
    assert second == "gh-env-token"

    monkeypatch.delenv("GH_TOKEN")
    third = _token_text(_call_with_supported_kwargs(loader))
    assert third == "github-env-token"


def test_load_copilot_cli_token_reads_jsonc_copilot_home_fallback(monkeypatch, tmp_path):
    loader = _get_attr("load_copilot_cli_token", "get_copilot_cli_token", "_load_copilot_cli_token")

    monkeypatch.delenv("COPILOT_GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GH_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.setenv("COPILOT_HOME", str(tmp_path))
    monkeypatch.setattr(cc, "_load_gh_cli_token", lambda: None, raising=False)

    (tmp_path / "config.json").write_text(
        """
        {
          // Copilot CLI stores tokens in JSONC config.
          "copilotTokens": {
            "lastLoggedInUser": {
              "token": "copilot-home-token"
            }
          }
        }
        """,
        encoding="utf-8",
    )

    token = _token_text(
        _call_with_supported_kwargs(
            loader,
            copilot_home=tmp_path,
            home=tmp_path,
            config_path=tmp_path / "config.json",
            config_file=tmp_path / "config.json",
            path=tmp_path / "config.json",
        )
    )

    assert token == "copilot-home-token"


def test_load_copilot_cli_token_prefers_gh_auth_over_stale_plain_config(monkeypatch, tmp_path):
    loader = _get_attr("load_copilot_cli_token", "get_copilot_cli_token", "_load_copilot_cli_token")

    monkeypatch.delenv("COPILOT_GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GH_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.setenv("COPILOT_HOME", str(tmp_path))
    monkeypatch.setattr(cc, "_load_gh_cli_token", lambda: "fresh-gh-auth-token", raising=False)

    (tmp_path / "config.json").write_text(
        """
        {
          "lastLoggedInUser": "octocat",
          "copilotTokens": {
            "https://github.com:octocat": "stale-plain-config-token"
          }
        }
        """,
        encoding="utf-8",
    )

    token = _token_text(
        _call_with_supported_kwargs(
            loader,
            copilot_home=tmp_path,
            config_path=tmp_path / "config.json",
        )
    )

    assert token == "fresh-gh-auth-token"


def test_load_copilot_cli_token_falls_back_to_gh_auth_token(monkeypatch, tmp_path):
    loader = _get_attr("load_copilot_cli_token", "get_copilot_cli_token", "_load_copilot_cli_token")

    monkeypatch.delenv("COPILOT_GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GH_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.setenv("COPILOT_HOME", str(tmp_path))
    monkeypatch.setattr(cc, "_load_gh_cli_token", lambda: "gh-cli-token", raising=False)

    token = _token_text(
        _call_with_supported_kwargs(
            loader,
            copilot_home=tmp_path,
            home=tmp_path,
            config_path=tmp_path / "config.json",
            config_file=tmp_path / "config.json",
            path=tmp_path / "config.json",
        )
    )

    assert token == "gh-cli-token"


def test_load_copilot_cli_token_missing_token_points_to_copilot_login(monkeypatch, tmp_path):
    loader = _get_attr("load_copilot_cli_token", "get_copilot_cli_token", "_load_copilot_cli_token")

    monkeypatch.delenv("COPILOT_GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("GH_TOKEN", raising=False)
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.setenv("COPILOT_HOME", str(tmp_path))
    monkeypatch.setattr(cc, "_load_gh_cli_token", lambda: None, raising=False)

    with pytest.raises(RuntimeError) as excinfo:
        _call_with_supported_kwargs(
            loader,
            copilot_home=tmp_path,
            home=tmp_path,
            config_path=tmp_path / "config.json",
            config_file=tmp_path / "config.json",
            path=tmp_path / "config.json",
        )

    message = str(excinfo.value).lower()
    assert "copilot login" in message or "copilot_github_token" in message
    assert "device flow" not in message
    assert "connector oauth" not in message
    assert "secure credential store" not in message


def test_handle_messages_drops_claude_headers_and_identifies_copilot_cli():
    upstream = _FakeUpstreamResponse(
        status=200,
        headers={"Content-Type": "application/json"},
        chunks=[b'{"ok":true}'],
        body_json={"ok": True},
    )

    resp, body, session = asyncio.run(
        _run_proxy_handler(
            "/v1/messages",
            {"model": "claude-opus-4.8", "stream": False, "messages": []},
            upstream,
            headers={
                "anthropic-version": "2023-06-01",
                "anthropic-beta": "messages-2023-12-15",
                "x-api-key": "local-anthropic-key",
                "x-claude-code": "true",
            },
        )
    )

    assert resp.status == 200
    assert json.loads(body.decode()) == {"ok": True}
    upstream_headers = session.calls[0][2]["headers"]
    for key in ("anthropic-version", "anthropic-beta", "x-api-key", "x-claude-code"):
        assert key not in upstream_headers
    assert upstream_headers["User-Agent"].lower().startswith("copilot")
    assert "vscode" not in upstream_headers["User-Agent"].lower()
    assert "vscode" not in upstream_headers["Editor-Version"].lower()
    assert "vscode" not in upstream_headers["Editor-Plugin-Version"].lower()
    assert "vscode" not in upstream_headers["Copilot-Integration-Id"].lower()
    assert upstream_headers.get("Openai-Intent") == "conversation-agent"
    assert upstream_headers.get("X-Initiator") == "user"
    assert upstream_headers.get("X-GitHub-Api-Version")


def test_token_manager_uses_github_token_directly_without_copilot_internal_exchange():
    session = _FakeTokenExchangeSession({})
    manager = _build_token_manager(session)

    result = asyncio.run(_call_token_manager(manager))

    assert session.calls == 0
    assert _token_text(result) == "gho_test"


async def _run_proxy_handler(path, payload, upstream_response, headers=None):
    handler = _get_attr(
        "handle_messages",
        "messages_handler",
        "proxy_messages",
        "handle_request",
        "proxy_request",
        "forward_request",
    )
    app = web.Application()
    app["token_manager"] = _FakeTokenManager("https://api.example.test")
    app["session"] = app["client_session"] = app["upstream_session"] = _FakeUpstreamSession(
        {path: upstream_response}
    )
    app.router.add_post("/v1/messages", handler)
    app.router.add_post("/v1/messages/count_tokens", handler)

    async with TestServer(app) as server:
        async with TestClient(server) as client:
            resp = await client.post(path, json=payload, headers=headers or {})
            body = await resp.read()
            return resp, body, app["session"]


def test_passthrough_stream_bytes_status_and_content_type_are_copied():
    upstream = _FakeUpstreamResponse(
        status=207,
        headers={"Content-Type": "text/event-stream"},
        chunks=[b"abc", b"def"],
    )

    resp, body, session = asyncio.run(
        _run_proxy_handler(
            "/v1/messages",
            {"model": "claude-opus-4.8", "stream": True, "messages": []},
            upstream,
        )
    )

    assert session.calls
    assert resp.status == 207
    assert resp.headers["Content-Type"] == "text/event-stream"
    assert body == b"abcdef"
    expected_auth = "Bearer " + "".join(chr(c) for c in (106, 119, 116, 45, 49, 50, 51))
    assert session.calls[0][2]["headers"]["Authorization"] == expected_auth
    assert session.calls[0][2]["headers"]["Authorization"] != "******"


def test_passthrough_treats_downstream_disconnect_as_normal_close(monkeypatch):
    upstream = _FakeUpstreamResponse(
        status=200,
        headers={"Content-Type": "text/event-stream"},
        chunks=[b"first", b"second"],
    )
    writes = []

    class DisconnectingStreamResponse:
        def __init__(self, status, headers):
            self.status = status
            self.headers = headers

        async def prepare(self, request):
            return None

        async def write(self, chunk):
            writes.append(chunk)
            raise cc.aiohttp.ClientConnectionResetError("Cannot write to closing transport")

        async def write_eof(self):
            raise AssertionError("write_eof should not run after client disconnect")

    monkeypatch.setattr(cc.web, "StreamResponse", DisconnectingStreamResponse)

    response = asyncio.run(
        _run_proxy_handler_object(
            "/v1/messages",
            {"model": "claude-opus-4.8", "stream": True, "messages": []},
            upstream,
        )
    )

    assert isinstance(response, DisconnectingStreamResponse)
    assert writes == [b"first"]


def test_passthrough_treats_downstream_disconnect_during_prepare_as_normal_close(monkeypatch):
    upstream = _FakeUpstreamResponse(
        status=200,
        headers={"Content-Type": "text/event-stream"},
        chunks=[b"first"],
    )

    class DisconnectingStreamResponse:
        def __init__(self, status, headers):
            self.status = status
            self.headers = headers

        async def prepare(self, request):
            raise cc.aiohttp.ClientConnectionResetError("Cannot write to closing transport")

    monkeypatch.setattr(cc.web, "StreamResponse", DisconnectingStreamResponse)

    response = asyncio.run(
        _run_proxy_handler_object(
            "/v1/messages",
            {"model": "claude-opus-4.8", "stream": True, "messages": []},
            upstream,
        )
    )

    assert isinstance(response, DisconnectingStreamResponse)


def test_count_tokens_falls_back_to_estimate_when_native_endpoint_returns_404():
    upstream = _FakeUpstreamResponse(
        status=404,
        headers={"Content-Type": "application/json"},
        chunks=[b'{"error":"not found"}'],
        body_json={"error": "not found"},
    )
    text = "abcdefghij"

    resp, body, session = asyncio.run(
        _run_proxy_handler(
            "/v1/messages/count_tokens",
            {"model": "claude-opus-4.8", "messages": [{"role": "user", "content": text}]},
            upstream,
        )
    )

    assert session.calls
    assert resp.status == 200
    assert json.loads(body.decode()) == {"input_tokens": len(text) // 4}


async def _run_proxy_handler_object(path, payload, upstream_response, headers=None):
    handler = _get_attr(
        "handle_messages",
        "messages_handler",
        "proxy_messages",
        "handle_request",
        "proxy_request",
        "forward_request",
    )
    app = web.Application()
    app["token_manager"] = _FakeTokenManager("https://api.example.test")
    app["session"] = app["client_session"] = app["upstream_session"] = _FakeUpstreamSession(
        {path: upstream_response}
    )
    app.router.add_post("/v1/messages", handler)
    app.router.add_post("/v1/messages/count_tokens", handler)

    class RequestShim:
        def __init__(self):
            self.app = app
            self.headers = headers or {}
            self.path = path

        async def json(self):
            return payload

    return await handler(RequestShim())
