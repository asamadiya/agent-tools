from __future__ import annotations

import asyncio
import logging
import time

import aiohttp

from copilot_protocols import EFFORTS

log = logging.getLogger(__name__)
CATALOG_PROBES = 3


class CatalogError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def endpoint_for(model: dict) -> str:
    supported = model.get("supported_endpoints", [])
    for endpoint in ("/v1/messages", "/responses", "/chat/completions"):
        if endpoint in supported:
            return endpoint
    raise ValueError(f"No supported chat endpoint for {model.get('id')}")


def selectable(model: dict) -> bool:
    return (
        model.get("model_picker_enabled") is True
        and model.get("policy", {}).get("state", "enabled") == "enabled"
        and model.get("capabilities", {}).get("type") == "chat"
        and any(path in model.get("supported_endpoints", []) for path in
                ("/v1/messages", "/responses", "/chat/completions"))
    )


def picker_settings(models: list[dict]) -> dict:
    options = []
    for model in models:
        if not selectable(model):
            continue
        capabilities = model.get("capabilities", {})
        limits = capabilities.get("limits", {})
        limit = limits.get("max_context_window_tokens")
        efforts = capabilities.get("supports", {}).get("reasoning_effort", [])
        description = f"Copilot / {model['id']}"
        if limit:
            description += f"; context {limit:,}"
        if prompt_limit := limits.get("max_prompt_tokens"):
            description += f"; max input {prompt_limit:,}"
        if efforts:
            description += "; effort " + "/".join(efforts)
            missing = [e for e in ("xhigh", "max") if e not in efforts]
            supported = [e for e in EFFORTS if e in efforts]
            if missing and supported:
                description += "; " + "/".join(missing) + " -> " + supported[-1]
        else:
            description += "; no reasoning-effort parameter"
        row = {
            "model": model["id"] + "[1m]",
            "label": model.get("name", model["id"]) + " (1M client context)",
            "description": description + "; 1M client window, upstream limits still apply",
        }
        if efforts:
            # This enables Claude-side controls, not extra upstream capabilities.
            row["behavesAs"] = "claude-opus-5-5"
        options.append(row)
    if not options:
        raise CatalogError(503, "Copilot returned no enabled, picker-visible chat models for this account")
    return {"modelPicker": {"options": options, "replaceBuiltInOptions": True}}


def _context_window(model: dict) -> int:
    value = model.get("capabilities", {}).get("limits", {}).get("max_context_window_tokens")
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _merge_catalogs(batches: list[list[dict]]) -> list[dict]:
    merged: dict[str, dict] = {}
    for batch in batches:
        for model in batch:
            model_id = model["id"]
            existing = merged.get(model_id)
            if existing is None or _context_window(model) > _context_window(existing):
                merged[model_id] = model
    return list(merged.values())


class ModelCatalog:
    def __init__(self):
        self.models: list[dict] = []
        self.expires = 0.0
        self.lock = asyncio.Lock()

    async def _fetch_once(self, session, api_base: str, headers: dict) -> list[dict]:
        async with session.request("GET", f"{api_base}/models", headers=headers,
                                   timeout=aiohttp.ClientTimeout(total=30)) as reply:
            if reply.status != 200:
                raise CatalogError(reply.status, f"Copilot model catalog returned HTTP {reply.status}; check this proxy's account")
            try:
                data = await reply.json()
            except (ValueError, aiohttp.ContentTypeError) as exc:
                raise CatalogError(502, "Invalid Copilot model catalog JSON") from exc
        models = data.get("data") if isinstance(data, dict) else None
        if not isinstance(models, list) or not all(isinstance(m, dict) and isinstance(m.get("id"), str) for m in models):
            raise CatalogError(502, "Invalid Copilot model catalog")
        return models

    async def get(self, session, api_base: str, headers: dict) -> list[dict]:
        if time.monotonic() < self.expires:
            return self.models
        async with self.lock:
            if time.monotonic() < self.expires:
                return self.models
            # Copilot /models replicas intermittently return truncated model sets (e.g. omitting Gemini).
            # Reconcile across bounded parallel probes so one partial replica is not cached for 5 minutes.
            results = await asyncio.gather(
                *(self._fetch_once(session, api_base, headers) for _ in range(max(1, CATALOG_PROBES))),
                return_exceptions=True,
            )
            batches: list[list[dict]] = []
            errors: list[BaseException] = []
            for item in results:
                if isinstance(item, CatalogError) and item.status in (401, 403):
                    raise item
                if isinstance(item, BaseException):
                    errors.append(item)
                else:
                    batches.append(item)
            if not batches:
                raise errors[0]
            if errors:
                log.warning("Copilot /models had %d failed probe(s); using %d healthy response(s)",
                            len(errors), len(batches))
            models = _merge_catalogs(batches)
            prev_selectable = {m["id"] for m in self.models if selectable(m)}
            curr_selectable = {m["id"] for m in models if selectable(m)}
            if prev_selectable - curr_selectable:
                try:
                    extra = await self._fetch_once(session, api_base, headers)
                except (CatalogError, aiohttp.ClientError, asyncio.TimeoutError):
                    pass
                else:
                    models = _merge_catalogs([models, extra])
            self.models = models
            self.expires = time.monotonic() + 300
            return self.models
