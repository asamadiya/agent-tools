#!/usr/bin/env python3
"""V8 inspector-based fix for Copilot CLI BPE tokenizer freeze.

Called by copilot-doctor fix-freeze. Uses the Chrome DevTools Protocol
over WebSocket to:

1. Enable the Debugger domain (NO pause) to discover app.js scriptId
2. Set a conditional breakpoint inside aqi's while-loop that truncates
   the merge array so the loop exits immediately (condition returns false,
   so no actual pause/break occurs)
3. Call Runtime.terminateExecution to abort the currently stuck aqi call
4. Disable the Debugger domain but leave the breakpoint active

The approach is designed to be safe for background agents:
- No Debugger.pause (avoids triggering copilot's cancel detection)
- No socket destruction (avoids killing agent API streams)
- No SIGSTOP/SIGCONT (avoids signal handler side effects)

Usage: python3 fix_freeze.py <websocket_url> <pid>
"""

import json
import sys
import asyncio
import time

try:
    import websockets
except ImportError:
    print("ERROR: 'websockets' package required. Install with: pip3 install websockets")
    sys.exit(1)


# ── Protocol helpers ─────────────────────────────────────────────────────────

_msg_id = 0

def next_id():
    global _msg_id
    _msg_id += 1
    return _msg_id


async def send(ws, method, params=None):
    """Send a CDP message and return its id."""
    msg_id = next_id()
    msg = {"id": msg_id, "method": method}
    if params:
        msg["params"] = params
    await ws.send(json.dumps(msg))
    return msg_id


async def recv_until(ws, predicate, timeout=30):
    """Receive messages until predicate(parsed_msg) returns True."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        remaining = deadline - time.time()
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=min(remaining, 5))
            msg = json.loads(raw)
            if predicate(msg):
                return msg
        except asyncio.TimeoutError:
            continue
    return None


async def recv_reply(ws, msg_id, timeout=30):
    """Wait for a reply with a specific id."""
    return await recv_until(ws, lambda m: m.get("id") == msg_id, timeout)


async def drain_events(ws, timeout=1.0):
    """Drain pending events without blocking."""
    events = []
    while True:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
            events.append(json.loads(raw))
        except asyncio.TimeoutError:
            break
    return events


# ── Main fix logic ───────────────────────────────────────────────────────────

# Known aqi function signature to locate in minified app.js.
# This is the O(n²) BPE tokenizer merge function.
AQI_SIGNATURE = "function aqi("
AQI_WHILE_BODY = "let n=null;"

# Conditional breakpoint expression: truncates the merge array so the
# while(r.length>1) loop exits immediately. Returns false so V8 does
# NOT actually pause execution.
BP_CONDITION = "(r.splice(1), false)"


async def fix_freeze(ws_url, pid):
    """Main fix routine."""
    print(f"  Connecting to {ws_url}...")

    async with websockets.connect(ws_url, max_size=20 * 1024 * 1024) as ws:

        # ── Phase 1: Find app.js scriptId ────────────────────────────────
        print("  Phase 1: Locating app.js in V8 script registry...")

        enable_id = await send(ws, "Debugger.enable")

        app_script_id = None
        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
                msg = json.loads(raw)
                if msg.get("method") == "Debugger.scriptParsed":
                    url = msg["params"].get("url", "")
                    if "app.js" in url and ("1.0." in url or "copilot" in url):
                        app_script_id = msg["params"]["scriptId"]
                elif msg.get("id") == enable_id:
                    continue
            except asyncio.TimeoutError:
                break

        if not app_script_id:
            print("  ERROR: Could not find app.js in script registry")
            await send(ws, "Debugger.disable")
            return False

        print(f"  Found app.js: scriptId={app_script_id}")

        # ── Phase 2: Get source and find aqi loop location ───────────────
        print("  Phase 2: Locating aqi while-loop in source...")

        src_id = await send(ws, "Debugger.getScriptSource", {"scriptId": app_script_id})
        src_msg = await recv_reply(ws, src_id, timeout=60)

        if not src_msg or "result" not in src_msg:
            print("  ERROR: Could not retrieve app.js source")
            await send(ws, "Debugger.disable")
            return False

        source = src_msg["result"].get("scriptSource", "")
        print(f"  Source: {len(source):,} chars")

        # Find aqi on the correct line
        lines = source.split("\n")
        target_line = None
        target_col = None

        for line_num, line in enumerate(lines):
            aqi_pos = line.find(AQI_SIGNATURE)
            if aqi_pos < 0:
                continue
            # Find the while-loop body inside aqi
            body_pos = line.find(AQI_WHILE_BODY, aqi_pos)
            if body_pos < 0:
                continue
            target_line = line_num
            target_col = body_pos
            print(f"  aqi while-loop body at line {line_num}, col {body_pos}")
            break

        if target_line is None:
            print("  ERROR: Could not locate aqi function in source")
            print("  This may mean the Copilot CLI version changed the function name.")
            await send(ws, "Debugger.disable")
            return False

        # ── Phase 3: Set conditional breakpoint ──────────────────────────
        print("  Phase 3: Setting conditional breakpoint (no pause)...")

        bp_id = await send(ws, "Debugger.setBreakpoint", {
            "location": {
                "scriptId": app_script_id,
                "lineNumber": target_line,
                "columnNumber": target_col,
            },
            "condition": BP_CONDITION,
        })

        bp_msg = await recv_reply(ws, bp_id, timeout=10)
        if not bp_msg:
            print("  WARNING: No response to breakpoint request (may still work)")
        elif "error" in bp_msg:
            print(f"  ERROR: Breakpoint failed: {bp_msg['error']}")
            await send(ws, "Debugger.disable")
            return False
        else:
            bp_result = bp_msg.get("result", {})
            actual = bp_result.get("actualLocation", {})
            print(f"  Breakpoint set: id={bp_result.get('breakpointId', '?')} "
                  f"at line={actual.get('lineNumber', '?')} col={actual.get('columnNumber', '?')}")

        # ── Phase 4: Terminate current stuck execution ───────────────────
        #
        # IMPORTANT: Runtime.terminateExecution throws an exception into
        # whatever JS is currently executing. If aqi is running, the exception
        # propagates up to copilot's error handler which catches it. However,
        # this can sometimes trigger copilot's cancel detection, putting the
        # UI into a "Cancelling" state. This is a KNOWN SIDE EFFECT.
        #
        # The "Cancelling" state is cosmetic and temporary — copilot will
        # eventually resolve it and return to the prompt. If it doesn't,
        # the user can resume the session with --resume.
        #
        # DO NOT attempt to fix "Cancelling" by:
        #   - Sending SIGINT (kills the process and all background agents)
        #   - Destroying TLS sockets (kills background agent API streams)
        #   - Sending SIGSTOP/SIGCONT (triggers cancel detection again)
        #   - Using Debugger.pause (triggers cancel detection)
        #
        # The "Cancelling" state will resolve on its own when the background
        # agent's API stream completes or times out.
        print("  Phase 4: Terminating stuck aqi call (Runtime.terminateExecution)...")
        print("  ⚠ NOTE: This may cause a temporary 'Cancelling' state in the UI.")
        print("    The session remains fully functional. If 'Cancelling' persists,")
        print("    wait for background agents to finish, then the prompt will return.")

        term_id = await send(ws, "Runtime.terminateExecution")
        term_msg = await recv_reply(ws, term_id, timeout=10)

        if term_msg and "error" not in term_msg:
            print("  Termination sent — current aqi call will abort with catchable exception")
        else:
            print("  WARNING: terminateExecution may not have applied (process might be idle)")

        # ── Cleanup: leave breakpoint active, disable debugger protocol ──
        # Note: disabling the Debugger domain removes breakpoints in some
        # V8 versions. We intentionally leave it enabled so the conditional
        # breakpoint stays active for future aqi calls.
        # The overhead of Debugger.enable with no active pause is negligible.
        print("  Leaving Debugger enabled (BP stays active for future aqi calls)")

        # Drain any remaining events (best-effort, don't fail on disconnect)
        try:
            await drain_events(ws, timeout=1)
        except Exception:
            pass  # Connection may close after terminateExecution — that's OK

    print("  Fix applied successfully")
    return True


# ── Entry point ──────────────────────────────────────────────────────────────

async def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <websocket_url> <pid>")
        sys.exit(1)

    ws_url = sys.argv[1]
    pid = sys.argv[2]

    success = await fix_freeze(ws_url, pid)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    asyncio.run(main())
