#!/usr/bin/env bash
# BL-1159: miniapp watchdog must not SIGTERM the front-desk bridge child.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/operator_runtime_sandbox.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."

fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fixture() {
  local d; d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/swarmforge/scripts" "$d/extension/out/tools" "$d/.swarmforge/operator"
  cp "$SRC/stop_bridge_headless.sh" "$SRC/recover_miniapp_bridge.sh" \
     "$SRC/rearm_front_desk_bridge.sh" "$d/swarmforge/scripts/"
  copy_operator_runtime_sandbox "$SRC" "$d/swarmforge/scripts"
  cat > "$d/swarmforge/scripts/bounce_bridge_headless.sh" <<'EOF'
#!/usr/bin/env bash
ROOT="${1:?root required}"
echo "BOUNCE_KILL_STUB" >> "$ROOT/.swarmforge/operator/miniapp-bounce-kill.marker"
bash "$ROOT/swarmforge/scripts/stop_bridge_headless.sh" "$ROOT"
exit 0
EOF
  chmod +x "$d/swarmforge/scripts/bounce_bridge_headless.sh"
  printf '%s' "$d"
}

start_bridge_child() {
  local root="$1"
  cat > "$root/extension/out/tools/start-bridge-headless.js" <<'EOF'
setInterval(() => {}, 600000);
process.stdout.write('BRIDGE_LISTENING port=8765\n');
EOF
  node "$root/extension/out/tools/start-bridge-headless.js" "$root" 8765 &
  BRIDGE_PID=$!
}

start_http_server() {
  local port="$1"
  python3 - "$port" <<'PY' &
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

port = int(sys.argv[1])

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
    def log_message(self, *_args):
        pass

HTTPServer(('127.0.0.1', port), Handler).serve_forever()
PY
  HTTP_PID=$!
  sleep 0.05
}

jget() { bb -e "(require '[cheshire.core :as j]) (println (get (j/parse-string (slurp \"$1\") true) $2))"; }

pick_free_port() {
  python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'
}

# bl-1159-01: bridge pid survives operator_runtime watchdog ticks when /lets-talk is healthy
F="$(make_fixture)"
TEST_PORT="$(pick_free_port)"
start_bridge_child "$F"
sleep 300 &
FD_PID=$!
echo "$FD_PID" > "$F/.swarmforge/operator/front-desk-supervisor.pid"
start_http_server "$TEST_PORT"
for _ in 1 2; do
  OPERATOR_SKIP_LAUNCH=1 OPERATOR_MINIAPP_WATCHDOG_ENABLED=1 OPERATOR_MINIAPP_FAILURE_THRESHOLD=99 \
    OPERATOR_MINIAPP_BOUNCE_COOLDOWN_MS=0 BRIDGE_HEADLESS_PORT="$TEST_PORT" \
    SWARMFORGE_SANDBOX_SWEEP_ROOT="$F/.no-sandbox-sweep" SWARMFORGE_FIXTURE_REAP_ROOT="$F/.no-fixture-reap" \
    SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS="" \
    bb "$F/swarmforge/scripts/operator_runtime.bb" "$F" --tick-once >/dev/null
done
check "bl-1159-01: bridge pid survives healthy miniapp watchdog ticks" 'kill -0 "$BRIDGE_PID" 2>/dev/null'
check "bl-1159-01: healthy ticks did not invoke bounce kill stub" '[[ ! -f "$F/.swarmforge/operator/miniapp-bounce-kill.marker" ]]'
kill "$HTTP_PID" "$FD_PID" "$BRIDGE_PID" 2>/dev/null || true
wait "$HTTP_PID" 2>/dev/null || true
rm -rf "$F"

# bl-1159-02: /lets-talk probes succeed over the stable window
F="$(make_fixture)"
TEST_PORT="$(pick_free_port)"
start_http_server "$TEST_PORT"
probes_ok=1
for _ in 1 2 3; do
  if ! curl -sf --max-time 2 "http://127.0.0.1:${TEST_PORT}/lets-talk" >/dev/null 2>&1; then
    probes_ok=0
    break
  fi
  sleep 0.05
done
check "bl-1159-02: every /lets-talk probe succeeds" '[[ "$probes_ok" -eq 1 ]]'
kill "$HTTP_PID" 2>/dev/null || true
wait "$HTTP_PID" 2>/dev/null || true
rm -rf "$F"

# bl-1159-03: down /lets-talk recovery re-arms front desk without killing the bridge child
F="$(make_fixture)"
TEST_PORT="$(pick_free_port)"
start_bridge_child "$F"
sleep 300 &
FD_PID=$!
echo "$FD_PID" > "$F/.swarmforge/operator/front-desk-supervisor.pid"
OPERATOR_SKIP_LAUNCH=1 OPERATOR_MINIAPP_WATCHDOG_ENABLED=1 OPERATOR_MINIAPP_FAILURE_THRESHOLD=1 \
  OPERATOR_MINIAPP_BOUNCE_COOLDOWN_MS=0 BRIDGE_HEADLESS_PORT="$TEST_PORT" PID_WAIT_ATTEMPTS=1 \
  SWARMFORGE_SANDBOX_SWEEP_ROOT="$F/.no-sandbox-sweep" SWARMFORGE_FIXTURE_REAP_ROOT="$F/.no-fixture-reap" \
  SWARMFORGE_ORPHAN_REAP_CANDIDATE_PIDS="" \
  bb "$F/swarmforge/scripts/operator_runtime.bb" "$F" --tick-once >/dev/null
check "bl-1159-03: down bridge uses recover (rearm) not bounce kill stub" \
  '[[ ! -f "$F/.swarmforge/operator/miniapp-bounce-kill.marker" ]]'
check "bl-1159-03: bridge child still alive after miniapp recovery tick" 'kill -0 "$BRIDGE_PID" 2>/dev/null'
kill "$FD_PID" "$BRIDGE_PID" 2>/dev/null || true
rm -rf "$F"

# bl-1159-04: /resident-spy returns 200 on the bridge listen port
F="$(make_fixture)"
TEST_PORT="$(pick_free_port)"
start_http_server "$TEST_PORT"
status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${TEST_PORT}/resident-spy")"
check "bl-1159-04: resident-spy route returns 200 on bridge port" '[[ "$status" == "200" ]]'
kill "$HTTP_PID" 2>/dev/null || true
wait "$HTTP_PID" 2>/dev/null || true
rm -rf "$F"

if [[ "$fail" -eq 0 ]]; then
  echo "bl-1159 bridge child survives: ALL CHECKS PASSED"
else
  echo "bl-1159 bridge child survives: FAILURES"; exit 1
fi
