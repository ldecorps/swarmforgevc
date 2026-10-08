#!/usr/bin/env bash
# BL-1917: the tool-call shim's unit tests pass; a local-model seat's URL
# is its tool-call shim's (the endpoint itself when the shim is switched
# off); working out that URL starts nothing; and the pane-script line
# starts the shim, reuses a running one, and says so on stderr when
# something else holds its port.
#
# The functions are EXTRACTED from the live swarmforge.sh and eval'd
# (test_bl1829_local_model_qwen_settings.sh's posture): sourcing
# swarmforge.sh outright would run the launcher.
set -uo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$TEST_DIR/lib/tmp_cleanup.sh"
SWARMFORGE_SH="$TEST_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

for fn in local_model_shim_port local_model_seat_url local_model_shim_start_line; do
  fn_text="$(awk -v fn="$fn" '$0 ~ "^"fn"\\(\\) \\{" { flag=1 } flag { print } flag && /^\}/ { exit }' "$SWARMFORGE_SH")"
  [[ -n "$fn_text" ]] || fail "$fn not found in $SWARMFORGE_SH"
  eval "$fn_text"
done

free_port() { python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'; }
serving() { pgrep -fc "local_model_tool_call_shim.py serve --port $1 " 2>/dev/null || true; }

STATE_DIR="$(mktemp -d)"
register_tmp_dir "$STATE_DIR"
mkdir -p "$STATE_DIR/launch"
SCRIPT_DIR="$(cd "$TEST_DIR/.." && pwd)"   # the start line runs the shim from here
LM_URL="http://127.0.0.1:1/v1"
STARTED_PORT=""
BLOCKER_PID=""
cleanup_bl1917() {
  [[ -n "$STARTED_PORT" ]] && pkill -f "local_model_tool_call_shim.py serve --port $STARTED_PORT " 2>/dev/null
  [[ -n "$BLOCKER_PID" ]] && kill "$BLOCKER_PID" 2>/dev/null
  return 0
}
trap 'cleanup_bl1917; __swarmforge_cleanup_tmp_dirs' EXIT

# 0. The shim's own unit tests (text-to-tool-call rewriting, SSE, health),
# run from here so the standing suite reaches them.
python3 -m unittest "$TEST_DIR/test_local_model_tool_call_shim.py" >/dev/null 2>&1 \
  || fail "test_local_model_tool_call_shim.py failed: python3 -m unittest $TEST_DIR/test_local_model_tool_call_shim.py"
pass "the shim's unit tests pass"

# 1. The seat URL: the shim's by default, the endpoint when switched off.
# BL-2076: the shim URL names the seat (second argument).
STARTED_PORT="$(free_port)"
out="$(SWARMFORGE_LOCAL_MODEL_SHIM=off local_model_seat_url "$LM_URL" coder)"
[[ "$out" == "$LM_URL" ]] || fail "off: expected $LM_URL, got $out"
out="$(SWARMFORGE_LOCAL_MODEL_SHIM_PORT="$STARTED_PORT" local_model_seat_url "$LM_URL" coder)"
[[ "$out" == "http://127.0.0.1:$STARTED_PORT/seat/coder/v1" ]] || fail "on: expected the seat-named shim URL, got $out"
out="$(SWARMFORGE_LOCAL_MODEL_SHIM_PORT="$STARTED_PORT" local_model_seat_url "$LM_URL" 'coder@2')"
[[ "$out" == "http://127.0.0.1:$STARTED_PORT/seat/coder@2/v1" ]] || fail "on: expected the seat-named shim URL for coder@2, got $out"
[[ "$(serving "$STARTED_PORT")" == "0" ]] || fail "working out the seat URL started a shim"
pass "the seat URL is the shim's (the endpoint when off), and working it out starts nothing"

# 2. The pane line starts the shim, which names its upstream.
line="$(SWARMFORGE_LOCAL_MODEL_SHIM_PORT="$STARTED_PORT" local_model_shim_start_line "$LM_URL" coder)"
eval "$line"
health="$(curl -sS -m 3 "http://127.0.0.1:$STARTED_PORT/shim/health")"
[[ "$health" == *'"shim": "local-model-tool-call-shim"'* && "$health" == *"$LM_URL"* ]] \
  || fail "start: health answer names neither the shim nor its upstream: $health"
pass "the pane line starts a shim that names its upstream"

# 3. Run again (a respawn): the running shim is reused, not doubled.
eval "$line"
[[ "$(serving "$STARTED_PORT")" == "1" ]] || fail "respawn: expected one shim serving, got $(serving "$STARTED_PORT")"
pass "a respawn reuses the running shim"

# 4. A port something else holds: the pane is told, and no shim starts.
BLOCK_PORT="$(free_port)"
python3 -m http.server "$BLOCK_PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
BLOCKER_PID=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s -m 1 -o /dev/null "http://127.0.0.1:$BLOCK_PORT/" && break; sleep 0.2; done
line="$(SWARMFORGE_LOCAL_MODEL_SHIM_PORT="$BLOCK_PORT" local_model_shim_start_line "$LM_URL" coder)"
err="$(eval "$line" 2>&1 >/dev/null)"
[[ "$err" == *"tool-call shim is not up"* ]] || fail "foreign port: the pane was not told, got: $err"
grep -q "held by something else" "$STATE_DIR/launch/coder.shim.log" || fail "foreign port: launch log names no reason"
[[ "$(serving "$BLOCK_PORT")" == "0" ]] || fail "foreign port: a shim was started"
pass "a port held by something else is reported on the pane and in the launch log"

echo "ALL PASS: BL-1917 local_model_seat_url"
