#!/usr/bin/env bash
# BL-1703: ensure_ollama_ancillary_for_launch's own DETECTION logic, through
# the real swarmforge.sh launch path (parse_config + the gate itself) -
# never the lib in isolation. Two real pack shapes both count as "uses the
# local endpoint" and must both be caught: the local-model-mono-router
# agent keyword, AND an aider seat naming the endpoint on its own window
# line via --openai-api-base (every ollama-*-mono-router.conf pack today -
# checking only the agent keyword would miss all of them). A Claude-only
# pack must trigger neither probe nor record.

set -euo pipefail

export PACK_STAFFING_SKIP_GATE=1
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

mk_root() {
  local root; root="$(cd "$(mktemp -d)" && pwd -P)"
  register_tmp_dir "$root"
  mkdir -p "$root/swarmforge/roles" "$root/.swarmforge/launch" "$root/.swarmforge/prompts" "$root/bin"
  printf 'constitution\n' > "$root/swarmforge/constitution.prompt"
  printf 'role prompt\n' > "$root/swarmforge/roles/coder.prompt"
  echo "$root"
}

# A stand-in ollama: records its own invocation, then execs a tiny HTTP
# responder on OLLAMA_FIXTURE_PORT - never the real server, never 11434.
write_standin_ollama() {
  local root="$1" marker="$2"
  cat > "$root/bin/ollama" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" = "serve" ]; then
  echo "\$\$" >> "$marker"
  exec node -e "require('http').createServer((req,res)=>{res.end('{}')}).listen(process.env.OLLAMA_FIXTURE_PORT)"
fi
exit 0
EOF
  chmod +x "$root/bin/ollama"
}

free_port() {
  node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"
}

PORT="$(free_port)"
URL="http://127.0.0.1:$PORT/v1"

# ── 01: an aider seat naming the endpoint on its own window line ────────
ROOT1="$(mk_root)"
MARKER1="$ROOT1/ollama-invoked"
write_standin_ollama "$ROOT1" "$MARKER1"
cat > "$ROOT1/swarmforge/swarmforge.conf" <<EOF
window coder aider coder --model openai/qwen2.5-coder:latest --openai-api-base $URL --no-gitignore
EOF

PATH="$ROOT1/bin:$PATH" OLLAMA_FIXTURE_PORT="$PORT" \
  SWARMFORGE_LOCAL_MODEL_ENDPOINT_URL="$URL" \
  SWARMFORGE_OLLAMA_WAIT_SECONDS=5 SWARMFORGE_OLLAMA_POLL_INTERVAL_SECONDS=1 \
  zsh -c "source '$SWARMFORGE_SH' '$ROOT1'; parse_config; ensure_ollama_ancillary_for_launch" \
  || fail "01: ensure_ollama_ancillary_for_launch refused an aider+ollama pack it should have started"

[[ -f "$MARKER1" ]] || fail "01: the stand-in ollama binary was never invoked for an aider seat naming the endpoint"
RECORD1="$ROOT1/.swarmforge/ollama/serve.json"
[[ -f "$RECORD1" ]] || fail "01: expected an ollama record for a pack whose aider seat uses the local endpoint"
grep -q '"owner": "swarm-owned"' "$RECORD1" || fail "01: expected owner swarm-owned, got: $(cat "$RECORD1")"
STARTED_PID="$(cat "$MARKER1")"
kill -9 "$STARTED_PID" 2>/dev/null || true
pass "01: an aider seat's --openai-api-base window line is recognized as using the local endpoint"

# ── 02: a Claude-only pack triggers no probe and no record ──────────────
ROOT2="$(mk_root)"
MARKER2="$ROOT2/ollama-invoked"
write_standin_ollama "$ROOT2" "$MARKER2"
cat > "$ROOT2/swarmforge/swarmforge.conf" <<'EOF'
window coder claude coder --model claude-haiku-4-5-20251001 --dangerously-skip-permissions
EOF

PATH="$ROOT2/bin:$PATH" OLLAMA_FIXTURE_PORT="$PORT" \
  zsh -c "source '$SWARMFORGE_SH' '$ROOT2'; parse_config; ensure_ollama_ancillary_for_launch" \
  || fail "02: a Claude-only pack must never be refused by the ollama ancillary gate"

[[ -f "$MARKER2" ]] && fail "02: the stand-in ollama binary must never run for a Claude-only pack"
[[ -f "$ROOT2/.swarmforge/ollama/serve.json" ]] && fail "02: a Claude-only pack must write no ollama record"
pass "02: a Claude-only pack triggers no probe and no record"

echo "ALL PASS"
