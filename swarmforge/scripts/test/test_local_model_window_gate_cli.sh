#!/usr/bin/env bash
# BL-1801: local_model_window_gate_cli.bb's fact-gathering (a fake Ollama
# for /api/show, a real prompt file) - the pure decision itself is
# local_model_window_gate_lib_test_runner.bb's job.
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$SCRIPT_DIR/../local_model_window_gate_cli.bb"
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

WORK="$(mktemp -d)"
register_tmp_dir "$WORK"

# A fake Ollama: answers /api/show with a `parameters` blob naming
# num_ctx when FAKE_NUM_CTX is non-empty, or omits the line entirely when
# it is "none" - the real /api/show shape (a text blob, not a structured
# field), never a reimplementation of the real server otherwise.
#
# Path-sensitive by design (BL-1801 hardening): the real Ollama serves
# /api/show only on its NATIVE base, never under the OpenAI-compat /v1
# prefix the seat's own launch endpoint carries - so this fixture 404s
# any request whose path is not exactly /api/show, discriminating
# whether the CLI actually stripped the /v1 suffix before calling it
# (case 08 below) rather than accepting any path unconditionally.
FAKE_PORT=$(( (RANDOM % 20000) + 20000 ))
cat > "$WORK/fake-ollama.js" <<'EOF'
const http = require('http');
const port = Number(process.env.FAKE_PORT);
const numCtx = process.env.FAKE_NUM_CTX || 'none';
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url !== '/api/show') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `unknown path ${req.url}` }));
      return;
    }
    const parameters = numCtx === 'none' ? 'stop                            "</s>"' : `num_ctx                        ${numCtx}`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ parameters }));
  });
});
server.listen(port, '127.0.0.1');
EOF

start_fake_ollama() {
  FAKE_PORT="$FAKE_PORT" FAKE_NUM_CTX="$1" node "$WORK/fake-ollama.js" &
  FAKE_PID=$!
  sleep 0.3
}
stop_fake_ollama() {
  kill "$FAKE_PID" 2>/dev/null || true
  wait "$FAKE_PID" 2>/dev/null || true
}

make_prompt() {
  local n="$1"
  local path="$WORK/prompt-$n.txt"
  python3 -c "import sys; open(sys.argv[1], 'w').write('x' * int(sys.argv[2]))" "$path" "$n"
  printf '%s' "$path"
}

ENDPOINT="http://127.0.0.1:$FAKE_PORT/v1"

# 01: known window, well under half -> proceeds silently, exit 0
start_fake_ollama 32768
P="$(make_prompt 6000)"
OUT="$(bb "$CLI" check --role coder --model m --prompt-file "$P" --endpoint-url "$ENDPOINT" --overhead-chars 3000 2>&1)"
RC=$?
stop_fake_ollama
[[ "$RC" -eq 0 ]] || fail "01: expected exit 0, got $RC: $OUT"
[[ -z "$OUT" ]] || fail "01: expected no output, got: $OUT"
pass "01: known window well under half proceeds silently"

# 02: known window, over half but under budget -> warns, exit 0
start_fake_ollama 8192
P="$(make_prompt 15000)"
OUT="$(bb "$CLI" check --role coder --model m --prompt-file "$P" --endpoint-url "$ENDPOINT" --overhead-chars 3000 2>&1)"
RC=$?
stop_fake_ollama
[[ "$RC" -eq 0 ]] || fail "02: expected exit 0, got $RC: $OUT"
[[ "$OUT" == WARN:* ]] || fail "02: expected a WARN line, got: $OUT"
pass "02: known window over half but under budget warns and proceeds"

# 03: known window, over budget -> refuses, exit 1
start_fake_ollama 4096
P="$(make_prompt 15000)"
OUT="$(bb "$CLI" check --role coder --model m --prompt-file "$P" --endpoint-url "$ENDPOINT" --overhead-chars 3000 2>&1)"
RC=$?
stop_fake_ollama
[[ "$RC" -eq 1 ]] || fail "03: expected exit 1, got $RC: $OUT"
[[ "$OUT" == REFUSE:* ]] || fail "03: expected a REFUSE line, got: $OUT"
pass "03: known window over budget refuses the launch"

# 04: no num_ctx from Ollama, swarm context length stands in -> refuses
start_fake_ollama none
P="$(make_prompt 15000)"
OUT="$(bb "$CLI" check --role coder --model m --prompt-file "$P" --endpoint-url "$ENDPOINT" --context-length 4096 --overhead-chars 3000 2>&1)"
RC=$?
stop_fake_ollama
[[ "$RC" -eq 1 ]] || fail "04: expected exit 1, got $RC: $OUT"
pass "04: the swarm's own context length stands in when Ollama reports none"

# 05: unknown window (no num_ctx, no context length) -> warns, never refuses
start_fake_ollama none
P="$(make_prompt 60000)"
OUT="$(bb "$CLI" check --role coder --model m --prompt-file "$P" --endpoint-url "$ENDPOINT" --overhead-chars 3000 2>&1)"
RC=$?
stop_fake_ollama
[[ "$RC" -eq 0 ]] || fail "05: expected exit 0 (unknown window never refuses), got $RC: $OUT"
[[ "$OUT" == WARN:* ]] || fail "05: expected a WARN line, got: $OUT"
[[ "$OUT" == *unknown* ]] || fail "05: expected the warning to say unknown, got: $OUT"
pass "05: an unknown window warns and never refuses"

# 06: over budget with the override -> warns (not refuse), exit 0
start_fake_ollama 4096
P="$(make_prompt 15000)"
OUT="$(bb "$CLI" check --role coder --model m --prompt-file "$P" --endpoint-url "$ENDPOINT" --overhead-chars 3000 --override 1 2>&1)"
RC=$?
stop_fake_ollama
[[ "$RC" -eq 0 ]] || fail "06: expected exit 0, got $RC: $OUT"
[[ "$OUT" == WARN:* ]] || fail "06: expected a WARN line, got: $OUT"
[[ "$OUT" == *SWARMFORGE_LOCAL_WINDOW_OVERRIDE* ]] || fail "06: expected the override to be named, got: $OUT"
pass "06: the override turns a refusal into a warning"

# 07: an unreachable endpoint (no fake server running) falls back to the
#     swarm's own context length, never crashes.
P="$(make_prompt 15000)"
OUT="$(bb "$CLI" check --role coder --model m --prompt-file "$P" --endpoint-url "http://127.0.0.1:1/v1" --context-length 4096 --overhead-chars 3000 2>&1)"
RC=$?
[[ "$RC" -eq 1 ]] || fail "07: expected exit 1 (context length stands in), got $RC: $OUT"
pass "07: an unreachable Ollama falls back to the swarm's own context length"

echo "ALL PASS"
