"""Translate Messages to Copilot's Responses and Chat Completions protocols."""

from __future__ import annotations

import base64
import copy
import hashlib
import json
import logging
import uuid
from collections import defaultdict, deque
from typing import Any

log = logging.getLogger(__name__)
EFFORTS = ("none", "minimal", "low", "medium", "high", "xhigh", "max")
STATE_PREFIX = "copilot-cc:v1:"


def effort_for(requested: str, supported: list[str], model: str) -> str:
    if requested not in EFFORTS:
        raise ValueError(f"Unknown reasoning effort {requested!r}; ultracode is a Claude workflow mode")
    if requested in supported:
        return requested
    choices = [value for value in EFFORTS if value in supported]
    if not choices:
        raise ValueError(f"{model} does not advertise a reasoning-effort parameter")
    lower = [value for value in choices if EFFORTS.index(value) <= EFFORTS.index(requested)]
    mapped = lower[-1] if lower else choices[0]
    log.warning("%s: reasoning effort %s -> %s (supported: %s)", model, requested, mapped, "/".join(choices))
    return mapped


def state_block(model: str, endpoint: str, value: dict) -> dict:
    data = json.dumps({"model": model, "endpoint": endpoint, "value": value}, separators=(",", ":"))
    return {"type": "redacted_thinking", "data": STATE_PREFIX + base64.b64encode(data.encode()).decode()}


def is_bridge_state(block: dict) -> bool:
    return block.get("type") == "redacted_thinking" and str(block.get("data", "")).startswith(STATE_PREFIX)


def read_state(block: dict, model: str, endpoint: str) -> dict | None:
    if not is_bridge_state(block):
        log.warning("%s: omitting nonportable thinking from another protocol/model", model)
        return None
    try:
        data = json.loads(base64.b64decode(block["data"][len(STATE_PREFIX):], validate=True))
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValueError("Invalid copilot-cc reasoning state") from exc
    if not isinstance(data, dict) or not isinstance(data.get("value"), dict):
        raise ValueError("Invalid copilot-cc reasoning state")
    if data.get("model") != model or data.get("endpoint") != endpoint:
        log.warning("%s: omitting reasoning state belonging to %s", model, data.get("model"))
        return None
    return data["value"]


def blocks(content: Any) -> list[dict]:
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    if isinstance(content, list) and all(isinstance(item, dict) for item in content):
        return content
    raise ValueError("Message content must be a string or a list of blocks")


def text_content(content: Any) -> str:
    result = []
    for block in blocks(content):
        if block.get("type") != "text":
            raise ValueError(f"Unsupported text content block: {block.get('type')}")
        result.append(block["text"])
    return "\n".join(result)


def convert_content(content: Any, endpoint: str, role: str = "user") -> list[dict]:
    result = []
    for block in blocks(content):
        kind = block.get("type")
        if kind == "text":
            result.append({"type": ("output_text" if role == "assistant" else "input_text")
                           if endpoint == "/responses" else "text", "text": block["text"]})
        elif kind == "image" and role != "assistant":
            source = block.get("source", {})
            if source.get("type") == "base64":
                url = f"data:{source['media_type']};base64,{source['data']}"
            elif source.get("type") == "url":
                url = source["url"]
            else:
                raise ValueError(f"Unsupported image source: {source.get('type')}")
            result.append({"type": "input_image", "image_url": url} if endpoint == "/responses"
                          else {"type": "image_url", "image_url": {"url": url}})
        else:
            raise ValueError(f"Unsupported content block for {endpoint}: {kind}")
    return result


def tool_output(block: dict, endpoint: str) -> str | list[dict]:
    parts = blocks(block.get("content", ""))
    if block.get("is_error"):
        text = "\n".join(part["text"] for part in parts if part.get("type") == "text")
        non_text = [part for part in parts if part.get("type") != "text"]
        parts = [{"type": "text", "text": f"Tool error: {text}" if text else "Tool error"}] + non_text
    if all(part.get("type") == "text" for part in parts):
        return text_content(parts)
    return convert_content(parts, endpoint)


def chat_tool_output(block: dict) -> tuple[str, list[dict]]:
    # Copilot's /chat/completions adapter tokenizes base64 data URLs inside role="tool"
    # messages as raw text (~150k tokens per screenshot). Hoist images to a following
    # role="user" message so they are processed as vision inputs instead.
    output = tool_output(block, "/chat/completions")
    if isinstance(output, str):
        return output, []
    texts = [part["text"] for part in output if part.get("type") == "text"]
    images = [part for part in output if part.get("type") != "text"]
    if not texts and images:
        texts = ["[Image returned by tool; attached in following user message]"]
    return "\n".join(texts), images


def translate_request(body: dict, endpoint: str, metadata: dict) -> dict:
    model = body["model"]
    responses = endpoint == "/responses"
    result: dict[str, Any] = {"model": model, "stream": bool(body.get("stream", False))}
    supports = metadata.get("capabilities", {}).get("supports", {})
    for key in ("mcp_servers", "container"):
        if body.get(key):
            raise ValueError(f"{key} is not supported by the {endpoint} adapter")
    if "max_tokens" in body:
        limit = metadata.get("capabilities", {}).get("limits", {}).get("max_output_tokens")
        budget = body["max_tokens"]
        if not isinstance(budget, int) or isinstance(budget, bool) or budget <= 0:
            raise ValueError("max_tokens must be a positive integer")
        if limit and budget > limit:
            log.warning("%s: output budget %s -> catalog limit %s", model, budget, limit)
            budget = limit
        result["max_output_tokens" if responses else "max_tokens"] = budget
    for key in ("temperature", "top_p"):
        if key in body:
            result[key] = body[key]
    if body.get("stop_sequences"):
        if responses:
            raise ValueError("stop_sequences are not supported by the Responses API")
        result["stop"] = body["stop_sequences"]
    config = body.get("output_config") or {}
    effort = config.get("effort")
    if effort is not None:
        mapped = effort_for(effort, supports.get("reasoning_effort", []), model)
        result["reasoning" if responses else "reasoning_effort"] = {"effort": mapped} if responses else mapped
    elif body.get("thinking", {}).get("type") == "disabled" and "none" in supports.get("reasoning_effort", []):
        result["reasoning" if responses else "reasoning_effort"] = {"effort": "none"} if responses else "none"
    elif body.get("thinking", {}).get("type") == "enabled":
        budget = body["thinking"].get("budget_tokens", 4096)
        requested = "low" if budget <= 2048 else "medium" if budget <= 8192 else "high"
        mapped = effort_for(requested, supports.get("reasoning_effort", []), model)
        log.warning("%s: thinking budget %s translated to reasoning effort %s", model, budget, mapped)
        result["reasoning" if responses else "reasoning_effort"] = {"effort": mapped} if responses else mapped
    if config.get("format"):
        if not supports.get("structured_outputs"):
            raise ValueError(f"{model} does not advertise structured outputs")
        fmt = config["format"]
        if fmt.get("type") != "json_schema":
            raise ValueError(f"Unsupported output format: {fmt.get('type')}")
        schema = {"name": "response", "schema": fmt["schema"], "strict": True}
        if responses:
            result["text"] = {"format": {"type": "json_schema", **schema}}
        else:
            result["response_format"] = {"type": "json_schema", "json_schema": schema}

    tools = []
    for tool in body.get("tools", []):
        if tool.get("type", "custom") != "custom":
            raise ValueError(f"Unsupported server tool {tool.get('type')}; disable Claude tool search for non-Claude models")
        function = {"name": tool["name"], "description": tool.get("description", ""),
                    "parameters": tool["input_schema"], "strict": tool.get("strict", False)}
        tools.append({"type": "function", **function} if responses else {"type": "function", "function": function})
    if tools:
        result["tools"] = tools
    choice = body.get("tool_choice", {})
    if choice:
        kind = choice.get("type", "auto")
        if kind == "tool":
            result["tool_choice"] = {"type": "function", "name": choice["name"]} if responses else {
                "type": "function", "function": {"name": choice["name"]}}
        elif kind in ("auto", "any", "none"):
            result["tool_choice"] = "required" if kind == "any" else kind
        else:
            raise ValueError(f"Unsupported tool choice: {kind}")
        if "disable_parallel_tool_use" in choice:
            result["parallel_tool_calls"] = not choice["disable_parallel_tool_use"]

    messages: list[dict] = []
    if body.get("system"):
        messages.append({"role": "system", "content": text_content(body["system"])})
    for message in body.get("messages", []):
        message_start = len(messages)
        role = message["role"]
        if role not in ("user", "assistant", "system", "developer"):
            raise ValueError(f"Unsupported message role: {role}")
        pending: list[dict] = []
        deferred_user: list[dict] = []
        calls: list[dict] = []
        extra: dict = {}
        call_extras: dict = {}

        def flush():
            if pending or calls:
                item = {"role": role, "content": list(pending), **extra}
                if calls:
                    item["tool_calls"] = list(calls)
                messages.append(item)
                pending.clear()
                calls.clear()

        content = blocks(message["content"])
        if responses and role == "assistant":
            content = restore_response_order(content, model)
        for block in content:
            kind = block.get("type")
            if kind in ("thinking", "redacted_thinking"):
                state = read_state(block, model, endpoint)
                if state is None:
                    continue
                if responses:
                    flush()
                    if state.get("kind") == "reasoning":
                        messages.append(state["item"])
                    elif state.get("kind") == "message":
                        extra = {key: state[key] for key in ("phase",) if key in state}
                else:
                    extra.update(state.get("fields", {}))
                    call_extras.update(state.get("tool_extras", {}))
            elif kind == "tool_use":
                if role != "assistant":
                    raise ValueError("tool_use requires an assistant message")
                arguments = json.dumps(block["input"], separators=(",", ":"))
                if responses:
                    flush()
                    messages.append({"type": "function_call", "call_id": block["id"],
                                     "name": block["name"], "arguments": arguments})
                else:
                    calls.append({**call_extras.get(block["id"], {}), "id": block["id"], "type": "function",
                                  "function": {"name": block["name"], "arguments": arguments}})
            elif kind == "tool_result":
                if role != "user":
                    raise ValueError("tool_result requires a user message")
                flush()
                if responses:
                    messages.append({"type": "function_call_output", "call_id": block["tool_use_id"],
                                     "output": tool_output(block, endpoint)})
                else:
                    text, images = chat_tool_output(block)
                    messages.append({"role": "tool", "tool_call_id": block["tool_use_id"], "content": text})
                    deferred_user.extend(images)
            else:
                if deferred_user:
                    pending.extend(deferred_user)
                    deferred_user.clear()
                pending.extend(convert_content([block], endpoint, role))
        if deferred_user:
            pending.extend(deferred_user)
            deferred_user.clear()
        flush()
        # A stream can deliver opaque state after its tool blocks.
        if not responses and (extra or call_extras):
            for item in reversed(messages[message_start:]):
                if item.get("role") != "assistant":
                    break
                item.update(extra)
                for call in item.get("tool_calls", []):
                    call.update(call_extras.get(call["id"], {}))
    result["input" if responses else "messages"] = messages
    if responses:
        result.update(store=False, include=["reasoning.encrypted_content"])
    elif result["stream"]:
        result["stream_options"] = {"include_usage": True}
    return result


def usage(data: dict, endpoint: str) -> dict:
    responses = endpoint == "/responses"
    details = data.get("input_tokens_details" if responses else "prompt_tokens_details") or {}
    cached = details.get("cached_tokens", 0)
    total = data.get("input_tokens" if responses else "prompt_tokens", 0)
    output = data.get("output_tokens" if responses else "completion_tokens", 0)
    if not responses:
        # Copilot's Gemini adapter reports reasoning separately from completion.
        output += data.get("reasoning_tokens", 0)
    return {"input_tokens": max(0, total - cached), "output_tokens": output, "cache_read_input_tokens": cached}


def error_message(data: dict) -> str:
    error = data.get("error") or data
    return str(error.get("message") or error.get("code") or "Copilot upstream request failed") if isinstance(error, dict) else str(error)


def stop_reason(reason: str | None, tool_calls: bool = False) -> str:
    if reason in ("length", "max_output_tokens"):
        return "max_tokens"
    if reason in ("content_filter", "refusal", "safety"):
        return "refusal"
    return "tool_use" if tool_calls or reason in ("tool_calls", "function_call") else "end_turn"


def parse_arguments(arguments: str) -> dict:
    value = json.loads(arguments or "{}")
    if not isinstance(value, dict):
        raise ValueError("Upstream tool arguments must be a JSON object")
    return value


def response_item_blocks(item: dict, model: str) -> list[dict]:
    kind = item.get("type")
    if kind == "reasoning":
        return []
    if kind == "function_call":
        return [{"type": "tool_use", "id": item["call_id"], "name": item["name"],
                 "input": parse_arguments(item["arguments"])}]
    if kind == "message":
        result = []
        for part in item.get("content", []):
            if part.get("type") not in ("output_text", "refusal"):
                raise ValueError(f"Unsupported Responses output content: {part.get('type')}")
            result.append({"type": "text", "text": part.get("text", part.get("refusal", ""))})
        return result
    raise ValueError(f"Unsupported Responses output item: {kind}")


def block_anchor(block: dict) -> str:
    keys = ("type", "text") if block["type"] == "text" else ("type", "id", "name", "input")
    value = {key: block[key] for key in keys}
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def response_replay_state(output: list[dict], model: str) -> dict | None:
    if not any(item["type"] == "reasoning" or item.get("phase") for item in output):
        return None
    items = []
    for item in output:
        state = {"kind": "reasoning", "item": item} if item["type"] == "reasoning" else {
            "kind": "message", **({"phase": item["phase"]} if item.get("phase") else {}),
        }
        items.append({"state": state, "anchors": [block_anchor(block) for block in response_item_blocks(item, model)]})
    return state_block(model, "/responses", {"kind": "response", "items": items})


def restore_response_order(content: list[dict], model: str) -> list[dict]:
    # Claude moves redacted blocks ahead of text/tools. Hash anchors retain item boundaries
    # and ordering without storing another copy of generated text in the transcript.
    layouts = {}
    for i, block in enumerate(content):
        if is_bridge_state(block):
            state = read_state(block, model, "/responses")
            if state and state.get("kind") == "response":
                layouts[i] = state["items"]
    if not layouts:
        return content
    available = defaultdict(deque)
    for i, block in enumerate(content):
        if block.get("type") in ("text", "tool_use"):
            available[block_anchor(block)].append(i)
    ordered = []
    used = set(layouts)
    for items in layouts.values():
        for item in items:
            ordered.append(state_block(model, "/responses", item["state"]))
            for anchor in item["anchors"]:
                if not available[anchor]:
                    log.warning("%s: assistant content changed; omitting stale Responses replay metadata", model)
                    return [block for i, block in enumerate(content) if i not in layouts]
                i = available[anchor].popleft()
                used.add(i)
                ordered.append(content[i])
    ordered.extend(block for i, block in enumerate(content) if i not in used)
    return ordered


def chat_state(message: dict, model: str) -> dict | None:
    fields = {key: message[key] for key in ("reasoning_text", "reasoning_content", "reasoning_opaque")
              if message.get(key) is not None}
    extras = {call["id"]: {key: value for key, value in call.items() if key not in ("id", "type", "function", "index")}
              for call in message.get("tool_calls", [])}
    extras = {key: value for key, value in extras.items() if value}
    if fields or extras:
        return state_block(model, "/chat/completions", {"fields": fields, "tool_extras": extras})
    return None


def translate_response(data: dict, endpoint: str, model: str) -> dict:
    if data.get("error"):
        raise ValueError(error_message(data))
    content = []
    if endpoint == "/responses":
        if data.get("status") not in ("completed", "incomplete"):
            raise ValueError(f"Upstream response did not complete: {data.get('status')}")
        for item in data.get("output", []):
            content.extend(response_item_blocks(item, model))
        if state := response_replay_state(data.get("output", []), model):
            content.append(state)
        reason = (data.get("incomplete_details") or {}).get("reason")
        if any(part.get("type") == "refusal" for item in data.get("output", []) for part in item.get("content", [])):
            reason = "refusal"
    else:
        if not data.get("choices"):
            raise ValueError("Upstream response has no choices")
        choice = data["choices"][0]
        message = choice["message"]
        if state := chat_state(message, model):
            content.append(state)
        if message.get("content"):
            if not isinstance(message["content"], str):
                raise ValueError("Unsupported Chat Completions output content")
            content.append({"type": "text", "text": message["content"]})
        if message.get("refusal"):
            content.append({"type": "text", "text": message["refusal"]})
        for call in message.get("tool_calls", []):
            content.append({"type": "tool_use", "id": call["id"], "name": call["function"]["name"],
                            "input": parse_arguments(call["function"]["arguments"])})
        reason = choice.get("finish_reason")
        if message.get("refusal"):
            reason = "refusal"
    return {"id": "msg_" + uuid.uuid4().hex, "type": "message", "role": "assistant", "model": model,
            "content": content, "stop_reason": stop_reason(reason, any(b["type"] == "tool_use" for b in content)),
            "stop_sequence": None, "usage": usage(data.get("usage") or {}, endpoint)}


async def sse_events(content):
    buffer = b""
    lines: list[bytes] = []
    async for chunk in content.iter_any():
        buffer += chunk
        while b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            line = line.rstrip(b"\r")
            if line.startswith(b"data:"):
                lines.append(line[5:].lstrip(b" "))
            elif not line and lines:
                raw = b"\n".join(lines)
                lines.clear()
                if raw == b"[DONE]":
                    yield {"type": "_done"}
                else:
                    yield json.loads(raw)
    if buffer.strip() or lines:
        raise ValueError("Upstream SSE ended inside an event")


def encode_event(event: dict) -> bytes:
    return f"event: {event['type']}\ndata: {json.dumps(event, separators=(',', ':'))}\n\n".encode()


class StreamTranslator:
    def __init__(self, endpoint: str, model: str):
        self.endpoint = endpoint
        self.model = model
        self.index = 0
        self.active: dict[tuple, int] = {}
        self.finished: set[tuple] = set()
        self.text: dict[tuple, str] = {}
        self.items: dict[int, dict] = {}
        self.chat_message: dict = {}
        self.chat_tools: dict[int, dict] = {}
        self.final_usage = usage({}, endpoint)
        self.reason: str | None = None
        self.has_tools = False
        self.complete = False
        self.events: list[dict] = []

    def start(self) -> dict:
        return {"type": "message_start", "message": {
            "id": "msg_" + uuid.uuid4().hex, "type": "message", "role": "assistant", "model": self.model,
            "content": [], "stop_reason": None, "stop_sequence": None,
            "usage": {"input_tokens": 0, "output_tokens": 0}}}

    def open(self, key: tuple, block: dict):
        if key in self.active or key in self.finished:
            return
        self.active[key] = self.index
        self.index += 1
        self.events.append({"type": "content_block_start", "index": self.active[key], "content_block": block})
        if block["type"] == "tool_use":
            self.has_tools = True

    def delta(self, key: tuple, text: str, tool: bool = False):
        if not text:
            return
        if key not in self.active:
            raise ValueError("Upstream delta references an unopened content block")
        self.text[key] = self.text.get(key, "") + text
        self.events.append({"type": "content_block_delta", "index": self.active[key],
                            "delta": {"type": "input_json_delta", "partial_json": text} if tool else
                            {"type": "text_delta", "text": text}})

    def close(self, key: tuple):
        if key in self.active:
            self.events.append({"type": "content_block_stop", "index": self.active.pop(key)})
            self.finished.add(key)

    def whole(self, key: tuple, block: dict):
        self.open(key, block)
        self.close(key)

    def item_done(self, index: int, item: dict):
        self.items[index] = item
        kind = item.get("type")
        if kind == "function_call":
            key = (index, "tool")
            self.open(key, {"type": "tool_use", "id": item["call_id"], "name": item["name"], "input": {}})
            if not self.text.get(key):
                self.delta(key, item.get("arguments", "{}"), tool=True)
            parse_arguments(self.text.get(key, "{}"))
            self.close(key)
        elif kind == "message":
            for part_index, part in enumerate(item.get("content", [])):
                if part.get("type") not in ("output_text", "refusal"):
                    raise ValueError(f"Unsupported Responses content: {part.get('type')}")
                key = (index, part_index, "text")
                self.open(key, {"type": "text", "text": ""})
                if not self.text.get(key):
                    self.delta(key, part.get("text", part.get("refusal", "")))
                self.close(key)
        elif kind != "reasoning":
            raise ValueError(f"Unsupported Responses output item: {kind}")

    def feed(self, event: dict) -> list[dict]:
        self.events = []
        if event.get("error") or event.get("type") in ("error", "response.failed"):
            raise ValueError(error_message(event.get("response") or event))
        if self.endpoint == "/responses":
            self.responses_event(event)
        else:
            self.chat_event(event)
        return self.events

    def responses_event(self, event: dict):
        kind = event.get("type", "")
        index = event.get("output_index", 0)
        if kind == "response.output_item.added":
            item = event["item"]
            self.items[index] = item
            if item["type"] == "function_call":
                self.open((index, "tool"), {"type": "tool_use", "id": item["call_id"], "name": item["name"], "input": {}})
        elif kind in ("response.output_text.delta", "response.refusal.delta"):
            if kind == "response.refusal.delta":
                self.reason = "refusal"
            key = (index, event.get("content_index", 0), "text")
            self.open(key, {"type": "text", "text": ""})
            self.delta(key, event["delta"])
        elif kind == "response.function_call_arguments.delta":
            self.delta((index, "tool"), event["delta"], tool=True)
        elif kind == "response.output_item.done":
            self.item_done(index, event["item"])
        elif kind in ("response.completed", "response.incomplete"):
            data = event["response"]
            if data.get("error"):
                raise ValueError(error_message(data))
            self.reason = (data.get("incomplete_details") or {}).get("reason") or self.reason
            for i, item in enumerate(data.get("output", [])):
                self.item_done(i, item)
            if state := response_replay_state([item for _, item in sorted(self.items.items())], self.model):
                self.whole(("state",), state)
            self.final_usage = usage(data.get("usage") or {}, self.endpoint)
            self.complete = True

    def chat_event(self, event: dict):
        if event.get("type") == "_done":
            if self.reason is None:
                raise ValueError("Chat stream ended without a finish reason")
            self.complete = True
            return
        if event.get("usage"):
            self.final_usage = usage(event["usage"], self.endpoint)
        for choice in event.get("choices", []):
            if choice.get("index", 0) != 0:
                continue
            delta = choice.get("delta") or {}
            for field in ("reasoning_text", "reasoning_content", "reasoning_opaque"):
                if delta.get(field):
                    self.chat_message[field] = self.chat_message.get(field, "") + delta[field]
            text = delta.get("content") or delta.get("refusal")
            if text:
                self.open(("text",), {"type": "text", "text": ""})
                self.delta(("text",), text)
            for fragment in delta.get("tool_calls", []):
                i = fragment["index"]
                call = self.chat_tools.setdefault(i, {"function": {"name": "", "arguments": ""}})
                for field, value in fragment.items():
                    if field not in ("function", "index") and value is not None:
                        call[field] = value
                function = fragment.get("function") or {}
                call["function"]["name"] += function.get("name") or ""
                call["function"]["arguments"] += function.get("arguments") or ""
            if choice.get("finish_reason") is not None:
                self.reason = choice["finish_reason"]

    def finish(self) -> list[dict]:
        if not self.complete:
            raise ValueError("Copilot upstream stream ended before its terminal event")
        self.events = []
        if self.endpoint == "/chat/completions":
            # Chat permits fragmented names; Anthropic cannot revise a tool's name after its start.
            for i, call in sorted(self.chat_tools.items()):
                if not call.get("id") or not call["function"].get("name"):
                    raise ValueError("Incomplete upstream tool call")
                parse_arguments(call["function"]["arguments"])
                key = (i, "tool")
                self.open(key, {"type": "tool_use", "id": call["id"], "name": call["function"]["name"], "input": {}})
                self.delta(key, call["function"]["arguments"] or "{}", tool=True)
                self.close(key)
            self.chat_message["tool_calls"] = list(self.chat_tools.values())
            if state := chat_state(self.chat_message, self.model):
                self.whole(("state",), state)
        for key in list(self.active):
            self.close(key)
        self.events.extend([
            {"type": "message_delta", "delta": {"stop_reason": stop_reason(self.reason, self.has_tools),
                                              "stop_sequence": None}, "usage": self.final_usage},
            {"type": "message_stop"},
        ])
        return self.events


def strip_bridge_state(body: dict) -> dict:
    if not any(is_bridge_state(block) for message in body.get("messages", [])
               for block in blocks(message.get("content", ""))):
        return body
    result = copy.deepcopy(body)
    for message in result["messages"]:
        message["content"] = [block for block in blocks(message["content"]) if not is_bridge_state(block)]
    log.warning("%s: removed nonportable bridge reasoning state for native Messages", body.get("model"))
    return result
