import asyncio
import json

import pytest
from aiohttp.test_utils import TestClient, TestServer

from test_unit import cc, _FakeUpstreamResponse, _FakeUpstreamSession, _FakeTokenManager


def model(name="gpt-test", endpoint="/responses", efforts=None, **overrides):
    return {
        "id": name, "name": name, "model_picker_enabled": True,
        "supported_endpoints": [endpoint],
        "capabilities": {
            "type": "chat", "limits": {"max_context_window_tokens": 256000},
            "supports": {"streaming": True, "tool_calls": True,
                         "reasoning_effort": efforts or ["low", "medium", "high", "xhigh", "max"]},
        },
        **overrides,
    }


def response(data, status=200, stream=False):
    raw = data if isinstance(data, bytes) else json.dumps(data).encode()
    return _FakeUpstreamResponse(
        status, {"Content-Type": "text/event-stream" if stream else "application/json"}, [raw]
    )


async def call_proxy(path, body=None, models=None, upstream=None, catalog_status=200):
    app = cc.create_app()
    app["token_manager"] = _FakeTokenManager("https://api.example.test")
    session = _FakeUpstreamSession({
        "/models": response({"data": models or [model()]}, catalog_status),
        **(upstream or {}),
    })
    app["upstream_session"] = session
    async with TestServer(app) as server, TestClient(server) as client:
        async with client.request("GET" if body is None else "POST", path, json=body) as reply:
            return reply.status, await reply.read(), session


def test_picker_uses_account_catalog_excludes_disabled_and_nonchat_entries():
    models = [
        model(), model("gemini-test", "/chat/completions", ["low", "medium", "high"]),
        model("hidden", model_picker_enabled=False),
        model("denied", policy={"state": "disabled"}),
        model("embedding", capabilities={"type": "embeddings"}),
        model("unsupported", "/images"),
    ]
    status, raw, session = asyncio.run(call_proxy("/model-picker", models=models))
    assert status == 200
    picker = json.loads(raw)["modelPicker"]
    assert [row["model"] for row in picker["options"]] == ["gpt-test[1m]", "gemini-test[1m]"]
    assert "xhigh/max -> high" in picker["options"][1]["description"]
    assert picker["options"][1]["behavesAs"] == "claude-opus-5-5"
    assert picker["replaceBuiltInOptions"] is True
    assert session.calls[0][2]["headers"]["Authorization"].startswith("Bearer ")


def test_picker_has_one_long_context_entry_for_every_model_including_new_openai():
    models = [
        {**model("claude-opus-5.5", "/v1/messages"), "name": "Claude Opus 5.5"},
        model("gemini-4-argon", "/chat/completions", ["low", "medium", "high"]),
        model("gpt-6.2-astra"),
        model("gpt-6.2-sol"),
        model("claude-haiku-4.5", "/v1/messages",
              capabilities={"type": "chat", "limits": {"max_context_window_tokens": 200000,
                                                       "max_prompt_tokens": 200000}, "supports": {}}),
    ]
    status, raw, _ = asyncio.run(call_proxy("/model-picker", models=models))
    assert status == 200
    options = json.loads(raw)["modelPicker"]["options"]
    assert [row["model"] for row in options] == [entry["id"] + "[1m]" for entry in models]
    assert all("1M client context" in row["label"] for row in options)
    assert all("upstream limits still apply" in row["description"] for row in options)
    assert "context 200,000" in options[-1]["description"]
    assert "input 200,000" in options[-1]["description"]
    assert "behavesAs" not in options[-1]


@pytest.mark.parametrize("name,endpoint", [
    ("gpt-6.2-astra", "/responses"),
    ("gpt-6.2-sol", "/responses"),
    ("gemini-4-argon", "/chat/completions"),
])
def test_long_context_picker_ids_route_to_unmodified_upstream_model(name, endpoint):
    reply = {"status": "completed", "output": []} if endpoint == "/responses" else {
        "choices": [{"message": {"content": "OK"}, "finish_reason": "stop"}],
    }
    status, _, session = asyncio.run(call_proxy("/v1/messages",
        {"model": name + "[1m]", "messages": [{"role": "user", "content": "hi"}], "max_tokens": 20},
        models=[model(name, endpoint)], upstream={endpoint: response(reply)}))
    assert status == 200
    assert session.calls[-1][1].endswith(endpoint)
    assert json.loads(session.calls[-1][2]["data"])["model"] == name


def test_catalog_failure_is_not_an_empty_successful_picker():
    status, raw, _ = asyncio.run(call_proxy("/model-picker", catalog_status=403))
    assert status == 403
    assert json.loads(raw)["type"] == "error"


def test_catalog_is_cached_per_app_not_globally():
    async def run():
        for name in ("account-one", "account-two"):
            app = cc.create_app()
            app["token_manager"] = _FakeTokenManager("https://api.example.test")
            session = _FakeUpstreamSession({"/models": response({"data": [model(name)]})})
            app["upstream_session"] = session
            async with TestServer(app) as server, TestClient(server) as client:
                result = await (await client.get("/v1/models")).json()
                assert result["data"][0]["id"] == name
                first_calls = len(session.calls)
                result = await (await client.get("/v1/models")).json()
                assert result["data"][0]["id"] == name
            assert first_calls >= 1
            assert len(session.calls) == first_calls
    asyncio.run(run())


def test_responses_route_translates_nonstream_tool_reply_and_usage():
    reply = {"status": "completed", "output": [
        {"type": "function_call", "call_id": "call_1", "name": "read", "arguments": '{"path":"x"}'}
    ], "usage": {"input_tokens": 30, "input_tokens_details": {"cached_tokens": 10}, "output_tokens": 5}}
    status, raw, session = asyncio.run(call_proxy(
        "/v1/messages",
        {"model": "gpt-test", "max_tokens": 200, "messages": [{"role": "user", "content": "hi"}]},
        upstream={"/responses": response(reply)},
    ))
    assert status == 200
    message = json.loads(raw)
    assert message["stop_reason"] == "tool_use"
    assert message["content"] == [{"type": "tool_use", "id": "call_1", "name": "read", "input": {"path": "x"}}]
    assert message["usage"] == {"input_tokens": 20, "output_tokens": 5, "cache_read_input_tokens": 10}
    request = json.loads(session.calls[-1][2]["data"])
    assert request["max_output_tokens"] == 200
    assert request["store"] is False
    assert request["input"][0]["content"][0]["text"] == "hi"


def test_translated_count_is_explicitly_an_estimate_without_generation():
    status, raw, session = asyncio.run(call_proxy(
        "/v1/messages/count_tokens", {"model": "gpt-test", "messages": [{"role": "user", "content": "abcdefgh"}]}
    ))
    assert status == 200
    assert json.loads(raw) == {"input_tokens": 2}
    assert all(call[1].endswith("/models") for call in session.calls)


def translate(body, endpoint="/responses", efforts=None):
    translator = getattr(cc, "translate_request", None)
    assert translator is not None, "cross-provider request translation is missing"
    return translator(body, endpoint, model(body["model"], endpoint, efforts))


@pytest.mark.parametrize("endpoint", ["/responses", "/chat/completions"])
def test_translate_tools_results_images_and_system(endpoint):
    body = {
        "model": "gpt-test", "max_tokens": 1000,
        "system": [{"type": "text", "text": "Be concise", "cache_control": {"type": "ephemeral"}}],
        "tools": [{"name": "read", "description": "Read a file", "input_schema": {"type": "object"}}],
        "tool_choice": {"type": "any", "disable_parallel_tool_use": True},
        "messages": [
            {"role": "assistant", "content": [{"type": "tool_use", "id": "call_1", "name": "read", "input": {}}]},
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "call_1", "is_error": True, "content": "not found"},
                {"type": "text", "text": "Try the picture"},
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "AAAA"}},
            ]},
        ],
    }
    request = translate(body, endpoint)
    assert request["parallel_tool_calls"] is False
    assert request["tool_choice"] == "required"
    assert "data:image/png;base64,AAAA" in json.dumps(request)
    assert "Tool error: not found" in json.dumps(request)
    if endpoint == "/responses":
        assert [item.get("type", "message") for item in request["input"]] == [
            "message", "function_call", "function_call_output", "message"
        ]
    else:
        assert [item["role"] for item in request["messages"]] == ["system", "assistant", "tool", "user"]


@pytest.mark.parametrize("effort", ["low", "medium", "high", "xhigh", "max"])
@pytest.mark.parametrize("endpoint", ["/responses", "/chat/completions"])
def test_efforts_pass_through_or_map_to_backend_max_with_log(endpoint, effort, caplog):
    body = {"model": "test", "max_tokens": 1024, "messages": [],
            "output_config": {"effort": effort}, "thinking": {"type": "adaptive"}}
    request = translate(body, endpoint, ["low", "medium", "high"])
    expected = effort if effort in ("low", "medium") else "high"
    actual = request["reasoning"]["effort"] if endpoint == "/responses" else request["reasoning_effort"]
    assert actual == expected
    assert "thinking" not in request
    if effort in ("xhigh", "max"):
        assert effort in caplog.text and "high" in caplog.text


def test_unknown_effort_and_unsupported_content_are_not_silently_discarded():
    base = {"model": "test", "messages": [], "max_tokens": 10}
    with pytest.raises(ValueError, match="effort"):
        translate({**base, "output_config": {"effort": "ultracode"}})
    with pytest.raises(ValueError, match="document"):
        translate({**base, "messages": [{"role": "user", "content": [{"type": "document", "source": {}}]}]})


def test_gemini_opaque_reasoning_survives_message_tool_result_roundtrip():
    convert = getattr(cc, "translate_response", None)
    assert convert is not None, "cross-provider response translation is missing"
    source = {"choices": [{"finish_reason": "tool_calls", "message": {
        "role": "assistant", "content": "", "reasoning_text": "Need a tool.",
        "reasoning_opaque": "encrypted",
        "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "read", "arguments": "{}"},
                        "extra_content": {"google": {"thought_signature": "sig"}}}],
    }}], "usage": {"prompt_tokens": 4, "completion_tokens": 5}}
    result = convert(source, "/chat/completions", "gemini-test")
    followup = translate({
        "model": "gemini-test", "max_tokens": 100,
        "messages": [
            {"role": "assistant", "content": result["content"]},
            {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "call_1", "content": "ok"}]},
        ],
    }, "/chat/completions")
    assistant = followup["messages"][0]
    assert assistant["reasoning_opaque"] == "encrypted"
    assert assistant["reasoning_text"] == "Need a tool."
    assert assistant["tool_calls"][0]["extra_content"]["google"]["thought_signature"] == "sig"


def test_responses_encrypted_reasoning_and_phase_survive_followup():
    convert = getattr(cc, "translate_response", None)
    assert convert is not None, "cross-provider response translation is missing"
    reasoning = {"type": "reasoning", "id": "rs_1", "encrypted_content": "secret", "summary": []}
    source = {"status": "completed", "output": [
        reasoning,
        {"type": "message", "phase": "commentary", "content": [{"type": "output_text", "text": "Reading."}]},
        {"type": "function_call", "call_id": "call_1", "name": "read", "arguments": "{}"},
    ], "usage": {"input_tokens": 2, "output_tokens": 3}}
    result = convert(source, "/responses", "gpt-test")
    request = translate({"model": "gpt-test", "max_tokens": 20, "messages": [
        {"role": "assistant", "content": result["content"]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "call_1", "content": "OK"}]},
    ]})
    assert request["input"][0] == reasoning
    assert request["input"][1]["phase"] == "commentary"
    assert request["input"][2]["call_id"] == "call_1"


def sse(*events):
    return b"".join(b"data: " + json.dumps(event).encode() + b"\r\n\r\n" for event in events)


def parse_events(raw):
    return [json.loads(line[6:]) for line in raw.splitlines() if line.startswith(b"data: ")]


def test_responses_stream_handles_changing_ids_parallel_tools_and_split_bytes():
    chunks = sse(
        {"type": "response.created", "response": {"id": "changing-one"}},
        {"type": "response.output_item.added", "output_index": 0,
         "item": {"type": "function_call", "id": "changing-two", "call_id": "call_1", "name": "read", "arguments": ""}},
        {"type": "response.output_item.added", "output_index": 1,
         "item": {"type": "function_call", "id": "changing-three", "call_id": "call_2", "name": "read", "arguments": ""}},
        {"type": "response.function_call_arguments.delta", "output_index": 0, "item_id": "new-id", "delta": '{"x":'},
        {"type": "response.function_call_arguments.delta", "output_index": 1, "delta": '{"x":2}'},
        {"type": "response.function_call_arguments.delta", "output_index": 0, "delta": '1}'},
        {"type": "response.completed", "response": {"status": "completed", "output": [
            {"type": "function_call", "call_id": "call_1", "name": "read", "arguments": '{"x":1}'},
            {"type": "function_call", "call_id": "call_2", "name": "read", "arguments": '{"x":2}'},
        ], "usage": {"input_tokens": 10, "output_tokens": 20}}},
    )
    upstream = _FakeUpstreamResponse(200, {"Content-Type": "text/event-stream"}, [bytes([b]) for b in chunks])
    status, raw, _ = asyncio.run(call_proxy("/v1/messages",
        {"model": "gpt-test", "max_tokens": 100, "stream": True, "messages": []},
        upstream={"/responses": upstream}))
    assert status == 200
    events = parse_events(raw)
    assert events[0]["type"] == "message_start"
    assert events[-1]["type"] == "message_stop"
    starts = [event for event in events if event["type"] == "content_block_start"]
    assert [event["content_block"]["id"] for event in starts] == ["call_1", "call_2"]
    args = {}
    for event in events:
        if event["type"] == "content_block_delta":
            args[event["index"]] = args.get(event["index"], "") + event["delta"].get("partial_json", "")
    assert [json.loads(args[i]) for i in (0, 1)] == [{"x": 1}, {"x": 2}]
    assert events[-2]["delta"]["stop_reason"] == "tool_use"


@pytest.mark.parametrize("endpoint,name", [("/responses", "gpt-test"), ("/chat/completions", "gemini-test")])
def test_truncated_stream_emits_error_not_success(endpoint, name):
    partial = {"type": "response.created", "response": {}} if endpoint == "/responses" else {
        "choices": [{"index": 0, "delta": {"content": "hello"}, "finish_reason": None}]}
    status, raw, _ = asyncio.run(call_proxy("/v1/messages",
        {"model": name, "max_tokens": 100, "stream": True, "messages": []},
        models=[model(name, endpoint)], upstream={endpoint: response(sse(partial), stream=True)}))
    assert status == 200
    events = parse_events(raw)
    assert events[-1]["type"] == "error"
    assert not any(event["type"] == "message_stop" for event in events)


def test_upstream_http_failure_preserves_status_and_anthropic_error_shape():
    status, raw, _ = asyncio.run(call_proxy("/v1/messages",
        {"model": "gpt-test", "messages": [], "max_tokens": 100},
        upstream={"/responses": response({"error": {"message": "rate limited"}}, 429)}))
    assert status == 429
    assert json.loads(raw)["error"]["message"] == "rate limited"


def test_chat_stream_preserves_opaque_state_and_tool_usage_after_finish_reason():
    wire = sse(
        {"choices": [{"index": 0, "delta": {"reasoning_text": "Need a tool."}, "finish_reason": None}]},
        {"choices": [{"index": 0, "delta": {"tool_calls": [
            {"index": 0, "id": "call_1", "type": "function", "function": {"name": "read", "arguments": '{"p":'}}
        ]}, "finish_reason": None}]},
        {"choices": [{"index": 0, "delta": {"reasoning_opaque": "opaque", "tool_calls": [
            {"index": 0, "function": {"arguments": '"x"}'}}
        ]}, "finish_reason": "tool_calls"}]},
        {"choices": [], "usage": {"prompt_tokens": 30, "completion_tokens": 10, "reasoning_tokens": 5}},
    ) + b"data: [DONE]\n\n"
    status, raw, _ = asyncio.run(call_proxy("/v1/messages",
        {"model": "gemini-test", "messages": [], "max_tokens": 100, "stream": True},
        models=[model("gemini-test", "/chat/completions")],
        upstream={"/chat/completions": response(wire, stream=True)}))
    assert status == 200
    events = parse_events(raw)
    assert events[-2]["usage"]["output_tokens"] == 15
    state = next(e["content_block"] for e in events if e["type"] == "content_block_start"
                 and e["content_block"]["type"] == "redacted_thinking")
    body = {"model": "gemini-test", "max_tokens": 100, "messages": [
        {"role": "assistant", "content": [
            {"type": "tool_use", "id": "call_1", "name": "read", "input": {"p": "x"}}, state]},
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "call_1", "content": "done"}]},
    ]}
    followup = translate(body, "/chat/completions")
    assert followup["messages"][0]["reasoning_opaque"] == "opaque"
    assert followup["messages"][0]["tool_calls"][0]["function"]["arguments"] == '{"p":"x"}'


def test_opaque_state_does_not_leak_into_prior_adjacent_assistant_messages():
    convert = getattr(cc, "translate_response", None)
    assert convert is not None
    source = {"choices": [{"finish_reason": "stop", "message": {
        "role": "assistant", "content": "second", "reasoning_opaque": "only-second",
    }}]}
    result = convert(source, "/chat/completions", "gemini-test")
    request = translate({"model": "gemini-test", "max_tokens": 100, "messages": [
        {"role": "assistant", "content": "first"},
        {"role": "assistant", "content": result["content"]},
    ]}, "/chat/completions")
    assert "reasoning_opaque" not in request["messages"][0]
    assert request["messages"][1]["reasoning_opaque"] == "only-second"


def test_structured_output_and_provider_refusal_translation():
    metadata = model()
    metadata["capabilities"]["supports"]["structured_outputs"] = True
    request = cc.translate_request({"model": "gpt-test", "max_tokens": 100, "messages": [],
        "output_config": {"format": {"type": "json_schema", "schema": {"type": "object"}}}},
        "/responses", metadata)
    assert request["text"]["format"]["schema"] == {"type": "object"}
    reply = cc.translate_response({"status": "completed", "output": [
        {"type": "message", "content": [{"type": "refusal", "refusal": "Cannot help."}]}
    ]}, "/responses", "gpt-test")
    assert reply["stop_reason"] == "refusal"


def test_effort_none_and_grok_max_mapping(caplog):
    body = {"model": "grok-test", "max_tokens": 100, "messages": [], "output_config": {"effort": "max"}}
    assert translate(body, efforts=["low", "medium", "high", "xhigh"])["reasoning"]["effort"] == "xhigh"
    assert "max -> xhigh" in caplog.text
    body["model"] = "gpt-test"
    body["output_config"]["effort"] = "none"
    assert translate(body, efforts=["none", "low", "high"])["reasoning"]["effort"] == "none"


@pytest.mark.parametrize("endpoint", ["/responses", "/chat/completions"])
def test_claude_inline_system_messages_retain_role_and_order(endpoint):
    request = translate({"model": "test", "max_tokens": 100, "system": "base", "messages": [
        {"role": "user", "content": "hello"},
        {"role": "system", "content": [{"type": "text", "text": "runtime reminder"}]},
    ]}, endpoint)
    messages = request["input" if endpoint == "/responses" else "messages"]
    assert [message["role"] for message in messages] == ["system", "user", "system"]
    assert messages[-1]["content"][0]["text"] == "runtime reminder"


def test_malformed_catalog_returns_anthropic_error():
    status, raw, _ = asyncio.run(call_proxy("/model-picker", upstream={
        "/models": response(b"not json"),
    }))
    assert status == 502
    assert json.loads(raw)["type"] == "error"


def test_chat_trailing_signature_only_state_survives_followup():
    reply = cc.translate_response({"choices": [{"finish_reason": "tool_calls", "message": {
        "tool_calls": [{"id": "call_1", "type": "function",
                        "function": {"name": "read", "arguments": "{}"},
                        "extra_content": {"google": {"thought_signature": "signature"}}}],
    }}]}, "/chat/completions", "gemini-test")
    state, tool = reply["content"]
    request = translate({"model": "gemini-test", "messages": [
        {"role": "assistant", "content": [tool, state]},
    ]}, "/chat/completions")
    call = request["messages"][0]["tool_calls"][0]
    assert call["extra_content"]["google"]["thought_signature"] == "signature"


@pytest.mark.parametrize("nullable", [False, True])
def test_chat_stream_waits_for_complete_tool_identity(nullable):
    fragments = [
        {"index": 0, "id": "call_1", "function": {"name": "get_", "arguments": ""}},
        {"index": 1, "id": "call_2", "function": {"name": "get_weather", "arguments": '{"city":"Rome"}'}},
        {"index": 0, "function": {"name": "weather", "arguments": '{"city":'}},
        {"index": 0, "function": {"arguments": '"Paris"}'}},
    ]
    if nullable:
        fragments[-1].update(id=None, type=None)
        fragments[-1]["function"]["name"] = None
        fragments[0]["function"]["arguments"] = None
    wire = sse(*({"choices": [{"index": 0, "delta": {"tool_calls": [fragment]}}]}
                 for fragment in fragments),
               {"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]}
               ) + b"data: [DONE]\n\n"
    _, raw, _ = asyncio.run(call_proxy("/v1/messages",
        {"model": "gemini-test", "messages": [], "stream": True},
        models=[model("gemini-test", "/chat/completions")],
        upstream={"/chat/completions": response(wire, stream=True)}))
    events = parse_events(raw)
    assert events[-1]["type"] == "message_stop"
    starts = [event for event in events if event["type"] == "content_block_start"
              and event["content_block"]["type"] == "tool_use"]
    assert [(event["content_block"]["id"], event["content_block"]["name"]) for event in starts] == [
        ("call_1", "get_weather"), ("call_2", "get_weather"),
    ]
    arguments = {}
    for event in events:
        if event["type"] == "content_block_delta" and event["delta"]["type"] == "input_json_delta":
            arguments[event["index"]] = arguments.get(event["index"], "") + event["delta"]["partial_json"]
    assert [json.loads(arguments[event["index"]]) for event in starts] == [
        {"city": "Paris"}, {"city": "Rome"},
    ]


@pytest.mark.parametrize("stream", [False, True])
def test_responses_replay_restores_phase_and_order_after_claude_moves_state(stream):
    output = [
        {"type": "message", "phase": "commentary", "content": [{"type": "output_text", "text": "Repeated."}]},
        {"type": "reasoning", "id": "rs_1", "encrypted_content": "opaque", "summary": []},
        {"type": "function_call", "call_id": "call_1", "name": "read", "arguments": "{}"},
        {"type": "message", "phase": "final_answer", "content": [{"type": "output_text", "text": "Repeated."}]},
    ]
    source = {"status": "completed", "output": output}
    if stream:
        wire = sse(
            {"type": "response.output_item.added", "output_index": 0,
             "item": {"type": "message", "content": []}},
            {"type": "response.output_text.delta", "output_index": 0, "delta": "Repeated."},
            {"type": "response.output_item.done", "output_index": 0, "item": output[0]},
            {"type": "response.completed", "response": source},
        )
        _, raw, _ = asyncio.run(call_proxy("/v1/messages",
            {"model": "gpt-test", "messages": [], "stream": True},
            upstream={"/responses": response(wire, stream=True)}))
        events = parse_events(raw)
        assert events[-1]["type"] == "message_stop"
        by_index = {}
        for event in events:
            if event["type"] == "content_block_start":
                by_index[event["index"]] = event["content_block"]
            elif event["type"] == "content_block_delta" and event["delta"]["type"] == "text_delta":
                by_index[event["index"]]["text"] += event["delta"]["text"]
        content = list(by_index.values())
    else:
        content = cc.translate_response(source, "/responses", "gpt-test")["content"]
    reordered = sorted(content, key=lambda block: block["type"] != "redacted_thinking")
    request = translate({"model": "gpt-test", "messages": [
        {"role": "assistant", "content": reordered},
    ]})
    assert request["input"] == [
        {"role": "assistant", "phase": "commentary", "content": [{"type": "output_text", "text": "Repeated."}]},
        output[1], output[2],
        {"role": "assistant", "phase": "final_answer", "content": [{"type": "output_text", "text": "Repeated."}]},
    ]


def test_responses_edited_history_omits_stale_replay_with_warning(caplog):
    content = cc.translate_response({"status": "completed", "output": [
        {"type": "reasoning", "encrypted_content": "old-reasoning", "summary": []},
        {"type": "message", "phase": "final_answer", "content": [{"type": "output_text", "text": "Original"}]},
    ]}, "/responses", "gpt-test")["content"]
    next(block for block in content if block["type"] == "text")["text"] = "Edited"
    request = translate({"model": "gpt-test", "messages": [{"role": "assistant", "content": content}]})
    assert request["input"] == [{"role": "assistant", "content": [{"type": "output_text", "text": "Edited"}]}]
    assert "omitting stale Responses replay metadata" in caplog.text


class _TimedUpstreamContent:
    def __init__(self, steps):
        self._steps = list(steps)

    async def iter_any(self):
        for delay, chunk in self._steps:
            if delay:
                await asyncio.sleep(delay)
            yield chunk


def test_translated_stream_emits_ping_during_silent_wait_and_buffered_reasoning(monkeypatch):
    monkeypatch.setattr(cc, "STREAM_PING_INTERVAL", 0.025)
    steps = [
        (0.06, sse({"choices": [{"index": 0, "delta": {"reasoning_text": "step 1"}}]})),
        (0.015, sse({"choices": [{"index": 0, "delta": {"reasoning_text": "step 2"}}]})),
        (0.015, sse({"choices": [{"index": 0, "delta": {"reasoning_text": "step 3"}}]})),
        (0.015, sse({"choices": [{"index": 0, "delta": {"tool_calls": [{
            "index": 0, "id": "call_1", "type": "function",
            "function": {"name": "read", "arguments": '{"path":"a.py"}'},
        }]}}]})),
        (0.0, sse({"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]}) + b"data: [DONE]\n\n"),
    ]
    upstream_resp = _FakeUpstreamResponse(200, {"Content-Type": "text/event-stream"}, [])
    upstream_resp.content = _TimedUpstreamContent(steps)
    status, raw, _ = asyncio.run(call_proxy(
        "/v1/messages",
        {"model": "gemini-4-neon[1m]", "messages": [], "stream": True},
        models=[model("gemini-4-neon", "/chat/completions", ["low", "medium", "high", "xhigh"])],
        upstream={"/chat/completions": upstream_resp},
    ))
    assert status == 200
    events = parse_events(raw)
    assert events[0]["type"] == "message_start"
    assert events[-1]["type"] == "message_stop"
    pings = [event for event in events if event["type"] == "ping"]
    assert len(pings) >= 2
    tool_starts = [event for event in events if event["type"] == "content_block_start"
                   and event["content_block"]["type"] == "tool_use"]
    assert [(event["content_block"]["id"], event["content_block"]["name"]) for event in tool_starts] == [
        ("call_1", "read"),
    ]


@pytest.mark.parametrize("status_code,raw_body,expected", [
    (400, b"invalid tool schema: missing properties", "invalid tool schema: missing properties"),
    (400, b'{"error":{"message":"bad request payload"}}', "bad request payload"),
    (502, b"", "Copilot returned HTTP 502"),
])
def test_translated_error_preserves_and_logs_non_json_or_text_body(status_code, raw_body, expected, caplog):
    upstream_resp = _FakeUpstreamResponse(status_code, {"Content-Type": "text/plain"}, [raw_body])
    status, raw, _ = asyncio.run(call_proxy(
        "/v1/messages",
        {"model": "gemini-4-neon[1m]", "messages": [], "stream": True},
        models=[model("gemini-4-neon", "/chat/completions")],
        upstream={"/chat/completions": upstream_resp},
    ))
    assert status == status_code
    assert json.loads(raw)["error"]["message"] == expected
    assert expected in caplog.text


class _SequentialModelsSession(_FakeUpstreamSession):
    def __init__(self, responses):
        super().__init__({})
        self._responses = list(responses)

    def request(self, method, url, **kwargs):
        self.calls.append((method, url, kwargs))
        reply = self._responses.pop(0) if len(self._responses) > 1 else self._responses[0]
        from test_unit import _FakeUpstreamRequestContext
        return _FakeUpstreamRequestContext(reply, self.recorder)


def test_catalog_reconciles_partial_replica_dropping_gemini():
    partial = [model("claude-opus-5.5", "/v1/messages")]
    full = [
        model("claude-opus-5.5", "/v1/messages",
              capabilities={"type": "chat", "limits": {"max_context_window_tokens": 1000000},
                            "supports": {"streaming": True, "tool_calls": True,
                                         "reasoning_effort": ["low", "medium", "high", "xhigh", "max"]}}),
        model("gemini-4-neon", "/chat/completions", ["low", "medium", "high", "xhigh"]),
    ]
    async def run():
        app = cc.create_app()
        app["token_manager"] = _FakeTokenManager("https://api.example.test")
        session = _SequentialModelsSession([
            response({"data": partial}),
            response({"data": full}),
            response({"data": partial}),
        ])
        app["upstream_session"] = session
        async with TestServer(app) as server, TestClient(server) as client:
            reply = await client.get("/model-picker")
            assert reply.status == 200
            options = (await reply.json())["modelPicker"]["options"]
            assert [row["model"] for row in options] == ["claude-opus-5.5[1m]", "gemini-4-neon[1m]"]
            assert "context 1,000,000" in options[0]["description"]
    asyncio.run(run())


def test_identity_headers_request_long_context_api_version():
    assert cc.IDENTITY_HEADERS["X-GitHub-Api-Version"] == "2026-08-01"


def test_chat_tool_result_images_move_to_following_user_message():
    body = {
        "model": "gemini-4-neon",
        "messages": [
            {"role": "assistant", "content": [
                {"type": "tool_use", "id": "call_1", "name": "Read", "input": {"file_path": "a.png"}},
                {"type": "tool_use", "id": "call_2", "name": "Read", "input": {"file_path": "b.png"}},
            ]},
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "call_1", "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "AAA"}},
                ]},
                {"type": "tool_result", "tool_use_id": "call_2", "is_error": True, "content": [
                    {"type": "text", "text": "Partial render"},
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "BBB"}},
                ]},
                {"type": "text", "text": "Compare them"},
            ]},
        ],
    }
    chat = translate(body, "/chat/completions")
    msgs = chat["messages"]
    assert [m["role"] for m in msgs] == ["assistant", "tool", "tool", "user"]
    assert isinstance(msgs[1]["content"], str) and "AAA" not in msgs[1]["content"]
    assert isinstance(msgs[2]["content"], str) and "Tool error: Partial render" in msgs[2]["content"]
    assert "BBB" not in msgs[2]["content"]
    user_parts = msgs[3]["content"]
    urls = [p["image_url"]["url"] for p in user_parts if p.get("type") == "image_url"]
    assert urls == ["data:image/png;base64,AAA", "data:image/png;base64,BBB"]
    assert any(p.get("type") == "text" and p.get("text") == "Compare them" for p in user_parts)

    # /responses handles function_call_output input_image natively without base64 text tokenization.
    resp = translate(body, "/responses")
    outputs = [item for item in resp["input"] if item.get("type") == "function_call_output"]
    assert len(outputs) == 2
    assert any(part.get("type") == "input_image" for part in outputs[0]["output"])
