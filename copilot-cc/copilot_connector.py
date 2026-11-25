from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import logging
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import aiohttp
from aiohttp import web

from copilot_catalog import CatalogError, ModelCatalog, endpoint_for, picker_settings, selectable
from copilot_protocols import (
    StreamTranslator,
    effort_for,
    encode_event,
    error_message,
    sse_events,
    strip_bridge_state,
    translate_request,
    translate_response,
)

log = logging.getLogger(__name__)

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 4141
STREAM_PING_INTERVAL = 15.0
DEFAULT_COPILOT_API_BASE = "https://api.enterprise.githubcopilot.com"
DEFAULT_MODEL_MAP = {
    "claude-opus-4-8": "claude-opus-4.8",
    "claude-opus-5-5": "claude-opus-5.5",
    "claude-sonnet-5-5": "claude-sonnet-5.5",
    "claude-haiku-5-5": "claude-haiku-5.5",
    "claude-haiku-4-5": "claude-haiku-4.5",
}
MODEL_MAP: dict[str, str] = DEFAULT_MODEL_MAP.copy()
DEBUG = os.environ.get("CONNECTOR_DEBUG")
_USAGE = re.compile(rb'"usage":\s*(\{[^}]*\})')
TOKEN_ENV_VARS = ("COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN")
IDENTITY_HEADERS = {
    "Editor-Version": "copilot-cli/1.0.0",
    "Editor-Plugin-Version": "copilot-cli/1.0.0",
    "User-Agent": "Copilot/1.0",
    "Copilot-Integration-Id": "copilot-cli",
    "Openai-Intent": "conversation-agent",
    "X-Initiator": "user",
    "X-GitHub-Api-Version": "2025-04-01",
}


def sanitize(body: dict) -> dict:
    # Pass cache_control, thinking, and output_config through to Copilot's native
    # endpoint; strip only Claude Code fields Copilot rejects.
    body.pop("context_management", None)
    if isinstance(body.get("model"), str):
        body["model"] = body["model"].removesuffix("[1m]")
    if (m := body.get("model")) in MODEL_MAP:
        body["model"] = MODEL_MAP[m]
    return body


def _resolve_copilot_config_path(
    copilot_home: str | Path | None = None,
    config_path: str | Path | None = None,
) -> Path:
    if config_path is not None:
        return Path(config_path)
    if copilot_home is not None:
        base = Path(copilot_home)
    else:
        base = Path(os.environ.get("COPILOT_HOME", Path.home() / ".copilot"))
    return base / "config.json"


def _strip_jsonc_comments(text: str) -> str:
    out: list[str] = []
    in_string = False
    escape = False
    i = 0
    while i < len(text):
        char = text[i]
        if in_string:
            out.append(char)
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            i += 1
            continue

        if char == '"':
            in_string = True
            out.append(char)
            i += 1
            continue

        if char == "/" and i + 1 < len(text):
            next_char = text[i + 1]
            if next_char == "/":
                i += 2
                while i < len(text) and text[i] not in "\r\n":
                    i += 1
                continue
            if next_char == "*":
                i += 2
                while i + 1 < len(text) and not (text[i] == "*" and text[i + 1] == "/"):
                    i += 1
                i += 2
                continue

        out.append(char)
        i += 1
    return "".join(out)


def _strip_trailing_commas(text: str) -> str:
    out: list[str] = []
    in_string = False
    escape = False
    i = 0
    while i < len(text):
        char = text[i]
        if in_string:
            out.append(char)
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            i += 1
            continue

        if char == '"':
            in_string = True
            out.append(char)
            i += 1
            continue

        if char == ",":
            j = i + 1
            while j < len(text) and text[j].isspace():
                j += 1
            if j < len(text) and text[j] in "}]":
                i += 1
                continue

        out.append(char)
        i += 1
    return "".join(out)


def _load_jsonc(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None

    try:
        raw = path.read_text(encoding="utf-8")
        normalized = _strip_trailing_commas(_strip_jsonc_comments(raw))
        parsed = json.loads(normalized)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"invalid Copilot CLI config JSON in {path}: {exc}") from exc

    if not isinstance(parsed, dict):
        raise RuntimeError(f"unexpected Copilot CLI config shape in {path}: expected object")
    return parsed


def _extract_login(value: Any) -> str | None:
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, dict):
        for key in ("login", "user", "username", "name"):
            login = value.get(key)
            if isinstance(login, str) and login.strip():
                return login.strip()
    return None


def _extract_token_value(value: Any) -> str | None:
    if isinstance(value, str):
        token = value.strip()
        return token or None
    if isinstance(value, dict):
        for key in ("token", "githubToken", "accessToken"):
            nested = value.get(key)
            if isinstance(nested, str) and nested.strip():
                return nested.strip()
    return None


def _matches_login_key(key: str, login: str) -> bool:
    return key == login or key.rsplit(":", 1)[-1] == login


def _extract_token_from_config(config: dict[str, Any]) -> str | None:
    if token := _extract_token_value(config):
        return token

    selected_login = _extract_login(config.get("lastLoggedInUser"))
    logged_in_users = config.get("loggedInUsers")
    if isinstance(logged_in_users, dict):
        if selected_login is not None:
            if token := _extract_token_value(logged_in_users.get(selected_login)):
                return token
        for value in logged_in_users.values():
            if token := _extract_token_value(value):
                return token

    copilot_tokens = config.get("copilotTokens")
    if isinstance(copilot_tokens, dict):
        selected_login = _extract_login(copilot_tokens.get("lastLoggedInUser")) or selected_login
        if token := _extract_token_value(copilot_tokens.get("lastLoggedInUser")):
            return token
        if selected_login is not None:
            for key, value in copilot_tokens.items():
                if isinstance(key, str) and _matches_login_key(key, selected_login):
                    if token := _extract_token_value(value):
                        return token
        for value in copilot_tokens.values():
            if token := _extract_token_value(value):
                return token

    return None


def load_copilot_cli_token(
    copilot_home: str | Path | None = None,
    config_path: str | Path | None = None,
) -> str:
    for env_name in TOKEN_ENV_VARS:
        if token := os.environ.get(env_name, "").strip():
            return token

    if token := _load_gh_cli_token():
        return token

    config = _load_jsonc(_resolve_copilot_config_path(copilot_home=copilot_home, config_path=config_path))
    if config is not None and (token := _extract_token_from_config(config)):
        return token

    raise RuntimeError(
        "No Copilot CLI token found. Run `copilot login` or set "
        "COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN."
    )


def _load_gh_cli_token() -> str | None:
    try:
        result = subprocess.run(
            ["gh", "auth", "token"],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (FileNotFoundError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    token = result.stdout.strip()
    return token or None


async def run_auth() -> int:
    try:
        process = await asyncio.create_subprocess_exec("copilot", "login")
    except FileNotFoundError as exc:
        raise RuntimeError("copilot CLI not found; install it and run `copilot login`") from exc
    return await process.wait()


@dataclass
class CopilotCredentials:
    token: str
    api_base: str


class TokenManager:
    def __init__(
        self,
        gh_token: str | None = None,
        session: aiohttp.ClientSession | Any | None = None,
        api_base: str | None = None,
        copilot_home: str | Path | None = None,
        config_path: str | Path | None = None,
    ) -> None:
        self._gh_token = gh_token
        self._api_base = (
            api_base or os.environ.get("COPILOT_API_BASE") or DEFAULT_COPILOT_API_BASE
        ).rstrip("/")
        self._copilot_home = Path(copilot_home) if copilot_home is not None else None
        self._config_path = Path(config_path) if config_path is not None else None
        self._session = session
        self._owns_session = False
        self._lock: asyncio.Lock | None = None
        self._lock_loop: asyncio.AbstractEventLoop | None = None
        self._cached: CopilotCredentials | None = None

    def set_session(self, session: aiohttp.ClientSession, own: bool = False) -> None:
        self._session = session
        self._owns_session = own

    async def close(self) -> None:
        if self._owns_session and self._session is not None:
            await self._session.close()
            self._session = None
            self._owns_session = False

    async def get(self) -> tuple[str, str]:
        return await self.get_token()

    async def get_token(self) -> tuple[str, str]:
        cached = self._cached
        if cached is not None:
            return (cached.token, cached.api_base)

        lock = self._get_lock()
        async with lock:
            cached = self._cached
            if cached is not None:
                return (cached.token, cached.api_base)
            credentials = await self._load_credentials()
            self._cached = credentials
            return (credentials.token, credentials.api_base)

    def _get_lock(self) -> asyncio.Lock:
        loop = asyncio.get_running_loop()
        if self._lock is None or self._lock_loop is not loop:
            self._lock = asyncio.Lock()
            self._lock_loop = loop
        return self._lock

    def _get_gh_token(self) -> str:
        if self._gh_token is None:
            self._gh_token = load_copilot_cli_token(
                copilot_home=self._copilot_home,
                config_path=self._config_path,
            )
        return self._gh_token

    async def _load_credentials(self) -> CopilotCredentials:
        token = await asyncio.to_thread(self._get_gh_token)
        return CopilotCredentials(token=token, api_base=self._api_base)


def _extract_text_fragments(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        fragments: list[str] = []
        for item in value:
            fragments.extend(_extract_text_fragments(item))
        return fragments
    if isinstance(value, dict):
        fragments = []
        if "text" in value:
            fragments.extend(_extract_text_fragments(value["text"]))
        elif "content" in value:
            fragments.extend(_extract_text_fragments(value["content"]))
        return fragments
    return []


def estimate_input_tokens(body: dict[str, Any]) -> int:
    fragments: list[str] = []
    fragments.extend(_extract_text_fragments(body.get("system")))
    fragments.extend(_extract_text_fragments(body.get("messages")))
    total_chars = sum(len(fragment) for fragment in fragments)
    return total_chars // 4


def _debug_request(body: dict[str, Any]) -> None:
    if DEBUG:
        print(
            "req:",
            {k: body.get(k) for k in ("model", "thinking", "output_config")},
            file=sys.stderr,
        )


def _debug_usage(chunk: bytes) -> None:
    if DEBUG and (match := _USAGE.search(chunk)):
        print("usage:", match.group(1).decode(), file=sys.stderr)


def _get_token_manager(app: web.Application) -> Any:
    manager = app.get("token_manager")
    if manager is None:
        raise RuntimeError("application missing token_manager")
    return manager


async def _get_upstream_credentials(app: web.Application) -> tuple[str, str]:
    manager = _get_token_manager(app)
    getter = getattr(manager, "get_token", None) or getattr(manager, "get", None)
    if getter is None:
        raise RuntimeError("token manager missing get_token/get")
    result = getter()
    if asyncio.iscoroutine(result):
        return await result
    return result


def _get_upstream_session(app: web.Application) -> Any:
    for key in ("upstream_session", "client_session", "session"):
        session = app.get(key)
        if session is not None:
            return session
    raise RuntimeError("application missing upstream session")


def api_error(status: int, message: str) -> web.Response:
    error_type = {400: "invalid_request_error", 401: "authentication_error",
                  403: "permission_error", 404: "not_found_error", 429: "rate_limit_error"}.get(status, "api_error")
    return web.json_response({"type": "error", "error": {"type": error_type, "message": message}}, status=status)


@web.middleware
async def error_middleware(request, handler):
    try:
        return await handler(request)
    except CatalogError as exc:
        log.warning("%s", exc)
        return api_error(exc.status, str(exc))
    except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
        log.warning("Copilot connection failed: %s", exc)
        return api_error(502, "Copilot upstream connection failed or timed out")
    except RuntimeError as exc:
        log.error("Copilot proxy configuration failed: %s", exc)
        return api_error(503, str(exc))


def upstream_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Accept-Encoding": "identity",
            "Content-Type": "application/json", **IDENTITY_HEADERS}


async def get_catalog(app: web.Application) -> list[dict]:
    token, api_base = await _get_upstream_credentials(app)
    return await app["catalog"].get(_get_upstream_session(app), api_base, upstream_headers(token))


async def handle_models(request: web.Request) -> web.Response:
    models = await get_catalog(request.app)
    if request.path == "/model-picker":
        return web.json_response(picker_settings(models))
    return web.json_response({"data": [{**model, "display_name": model.get("name", model["id"])}
                                     for model in models if selectable(model)], "has_more": False})


async def translated_response(request: web.Request, upstream, body: dict, endpoint: str) -> web.StreamResponse:
    if upstream.status >= 400:
        raw = (await upstream.text()).strip()
        error = ""
        if raw:
            try:
                parsed = json.loads(raw)
            except ValueError:
                error = raw[:500]
            else:
                error = error_message(parsed) if isinstance(parsed, dict) else raw[:500]
        if not error:
            error = f"Copilot returned HTTP {upstream.status}"
        log.warning("Copilot %s returned HTTP %s: %s", endpoint, upstream.status, error)
        return api_error(upstream.status, error)
    if not body.get("stream"):
        try:
            return web.json_response(translate_response(await upstream.json(), endpoint, body["model"]))
        except (ValueError, KeyError, TypeError) as exc:
            log.warning("Invalid %s response: %s", endpoint, exc)
            return api_error(502, f"Invalid Copilot response: {exc}")
    downstream = web.StreamResponse(headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache"})
    try:
        await downstream.prepare(request)
        translator = StreamTranslator(endpoint, body["model"])
        await downstream.write(encode_event(translator.start()))
        loop = asyncio.get_running_loop()
        last_write = loop.time()
        ping_interval = STREAM_PING_INTERVAL
        events = sse_events(upstream.content).__aiter__()
        pending: asyncio.Task[dict] | None = None
        try:
            pending = asyncio.create_task(events.__anext__())
            while True:
                if ping_interval > 0:
                    wait = max(0.0, last_write + ping_interval - loop.time())
                    done, _ = await asyncio.wait({pending}, timeout=wait)
                    if not done:
                        await downstream.write(encode_event({"type": "ping"}))
                        last_write = loop.time()
                        continue
                else:
                    await pending
                try:
                    event = pending.result()
                except StopAsyncIteration:
                    pending = None
                    break
                pending = asyncio.create_task(events.__anext__())
                converted = translator.feed(event)
                for item in converted:
                    await downstream.write(encode_event(item))
                    last_write = loop.time()
                if not converted and ping_interval > 0 and loop.time() - last_write >= ping_interval:
                    await downstream.write(encode_event({"type": "ping"}))
                    last_write = loop.time()
            for converted in translator.finish():
                await downstream.write(encode_event(converted))
        except (ValueError, KeyError, TypeError, aiohttp.ClientError, asyncio.TimeoutError) as exc:
            log.warning("Copilot %s stream failed: %s", endpoint, exc)
            await downstream.write(encode_event({"type": "error", "error": {
                "type": "api_error", "message": f"Copilot stream failed: {exc}"}}))
        finally:
            if pending is not None:
                if not pending.done():
                    pending.cancel()
                with contextlib.suppress(asyncio.CancelledError, StopAsyncIteration, Exception):
                    await pending
        await downstream.write_eof()
    except (aiohttp.ClientConnectionResetError, ConnectionResetError, BrokenPipeError):
        pass
    return downstream


async def handle_messages(request: web.Request) -> web.StreamResponse:
    try:
        body = await request.json()
    except json.JSONDecodeError as exc:
        return api_error(400, f"invalid JSON: {exc}")

    if not isinstance(body, dict) or not isinstance(body.get("model"), str):
        return api_error(400, "Request must be an object with a model string")

    body = sanitize(body)
    _debug_request(body)
    token, api_base = await _get_upstream_credentials(request.app)
    session = _get_upstream_session(request.app)

    headers = upstream_headers(token)
    endpoint = "/v1/messages"
    metadata = None
    if not body["model"].startswith("claude-"):
        models = await get_catalog(request.app)
        metadata = next((model for model in models if model["id"] == body["model"]), None)
        if metadata is None or metadata.get("policy", {}).get("state", "enabled") != "enabled":
            return api_error(400, f"Model {body['model']} is not available in this proxy's Copilot account")
        try:
            endpoint = endpoint_for(metadata)
        except ValueError as exc:
            return api_error(400, str(exc))

    if endpoint != "/v1/messages":
        if request.path.endswith("/count_tokens"):
            log.warning("%s: count_tokens is a text-only estimate, not the provider tokenizer", body["model"])
            return web.json_response({"input_tokens": estimate_input_tokens(body)})
        try:
            payload_body = translate_request(body, endpoint, metadata)
        except (ValueError, KeyError, TypeError) as exc:
            return api_error(400, str(exc))
    else:
        payload_body = strip_bridge_state(body)
        catalog = request.app.get("catalog")
        cached = catalog.models if catalog else []
        metadata = next((m for m in cached if m["id"] == body["model"]), None)
        if metadata and (effort := body.get("output_config", {}).get("effort")):
            supported = metadata.get("capabilities", {}).get("supports", {}).get("reasoning_effort")
            if supported:
                try:
                    payload_body["output_config"]["effort"] = effort_for(effort, supported, body["model"])
                except ValueError as exc:
                    return api_error(400, str(exc))
    payload = json.dumps(payload_body, separators=(",", ":")).encode("utf-8")
    upstream_url = f"{api_base}{request.path if endpoint == '/v1/messages' else endpoint}"
    async with session.request("POST", upstream_url, data=payload, headers=headers) as upstream:
        if endpoint != "/v1/messages":
            return await translated_response(request, upstream, body, endpoint)
        if request.path.endswith("/count_tokens") and upstream.status == 404:
            return web.json_response({"input_tokens": estimate_input_tokens(body)})

        response_headers = {"Content-Type": upstream.headers.get("Content-Type", "application/json")}
        downstream = web.StreamResponse(status=upstream.status, headers=response_headers)
        try:
            await downstream.prepare(request)
        except (aiohttp.ClientConnectionResetError, ConnectionResetError, BrokenPipeError):
            return downstream

        async for chunk in upstream.content.iter_any():
            try:
                await downstream.write(chunk)
            except (aiohttp.ClientConnectionResetError, ConnectionResetError, BrokenPipeError):
                return downstream
            _debug_usage(chunk)

        try:
            await downstream.write_eof()
        except (aiohttp.ClientConnectionResetError, ConnectionResetError, BrokenPipeError):
            return downstream
        return downstream


async def _session_context(app: web.Application):
    if app.get("upstream_session") is not None:
        yield
        return

    # aiohttp's default is ClientTimeout(total=300), and `total` covers draining the
    # streamed body -- so any generation running longer than 5 minutes was being killed
    # mid-SSE. Drop the wall-clock cap and guard on inter-chunk silence instead, which is
    # the only thing that actually indicates a dead upstream on a streaming connection.
    timeout = aiohttp.ClientTimeout(total=None, sock_connect=30, sock_read=600)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        app["upstream_session"] = session
        app["client_session"] = session
        app["session"] = session
        token_manager = _get_token_manager(app)
        if hasattr(token_manager, "set_session"):
            token_manager.set_session(session)
        yield


def create_app(gh_token: str | None = None) -> web.Application:
    app = web.Application(client_max_size=100 * 1024 * 1024, middlewares=[error_middleware])
    app["token_manager"] = TokenManager(gh_token=gh_token)
    app["catalog"] = ModelCatalog()
    app.cleanup_ctx.append(_session_context)
    app.router.add_post("/v1/messages", handle_messages)
    app.router.add_post("/v1/messages/count_tokens", handle_messages)
    app.router.add_get("/v1/models", handle_models)
    app.router.add_get("/model-picker", handle_models)
    return app


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="GitHub Copilot native Anthropic proxy")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("auth", help="Run `copilot login`")

    serve = subparsers.add_parser("serve", help="Run the local proxy")
    serve.add_argument("--host", default=DEFAULT_HOST)
    serve.add_argument("--port", type=int, default=DEFAULT_PORT)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "auth":
        return asyncio.run(run_auth())

    if args.command == "serve":
        app = create_app()
        web.run_app(app, host=args.host, port=args.port)
        return 0

    parser.error(f"unknown command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
