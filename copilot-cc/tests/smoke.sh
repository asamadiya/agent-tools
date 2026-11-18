#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${ANTHROPIC_BASE_URL:-http://127.0.0.1:4141}"
MODEL="${ANTHROPIC_MODEL:-claude-opus-5.5}"

fail() {
  printf 'smoke: %s\n' "$1" >&2
  exit 1
}

python3 - <<'PY' "$BASE_URL" || fail "proxy is not listening on 127.0.0.1:4141"
import socket, sys
from urllib.parse import urlparse
u = urlparse(sys.argv[1])
host = u.hostname or '127.0.0.1'
port = u.port or 4141
s = socket.socket()
s.settimeout(2)
try:
    s.connect((host, port))
finally:
    s.close()
PY

stream_payload=$(cat <<JSON
{"model":"$MODEL","max_tokens":16,"stream":true,"messages":[{"role":"user","content":"reply with OK"}]}
JSON
)

stream_output=$(curl -sS --no-buffer --max-time 30 \
  -H 'content-type: application/json' \
  -H 'anthropic-version: 2023-06-01' \
  -d "$stream_payload" \
  "$BASE_URL/v1/messages") || fail "streaming request failed"

for event in message_start content_block_delta message_stop; do
  printf '%s' "$stream_output" | grep -q "$event" || fail "missing streaming event: $event"
done

count_payload=$(cat <<JSON
{"model":"$MODEL","messages":[{"role":"user","content":"hi"}]}
JSON
)

count_output=$(curl -sS --max-time 30 \
  -H 'content-type: application/json' \
  -d "$count_payload" \
  "$BASE_URL/v1/messages/count_tokens") || fail "count_tokens request failed"

python3 - <<'PY' "$count_output" || fail "count_tokens response did not include input_tokens"
import json, sys
body = json.loads(sys.argv[1])
if not isinstance(body.get('input_tokens'), int):
    raise SystemExit(1)
print(body['input_tokens'])
PY

printf 'smoke: ok\n'
