#!/usr/bin/env bash
# Mono-router (config rotation router): role-context-clear-sweep! is a no-op.
# rotate_to_role already respawns the resident with a fresh launch script;
# injecting /clear into the one standing pane is redundant and harmful.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1
DAEMON_PID=""
cleanup() {
  if [[ -n "$DAEMON_PID" ]]; then
    mkdir -p "$ROOT/.swarmforge/daemon" 2>/dev/null || true
    touch "$ROOT/.swarmforge/daemon/stop" 2>/dev/null || true
    wait "$DAEMON_PID" 2>/dev/null || true
    kill "$DAEMON_PID" 2>/dev/null || true
  fi
  rm -rf "$ROOT"
}
trap cleanup EXIT

TODAY_DAY_KEY="$(date -u +%Y-%m-%d)"
SOCK="$ROOT/fake.sock"
touch "$SOCK"

CODER_WT="$ROOT/.worktrees/coder"
mkdir -p "$ROOT/.swarmforge" "$ROOT/docs/briefings" \
  "$ROOT/backlog/active" "$ROOT/backlog/paused" "$ROOT/backlog/done" \
  "$ROOT/.swarmforge/handoffs/coordinator/inbox/completed" \
  "$CODER_WT/.swarmforge/handoffs/inbox/new" \
  "$CODER_WT/.swarmforge/handoffs/inbox/in_process" \
  "$CODER_WT/.swarmforge/handoffs/inbox/completed"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

printf 'rotation\trouter\n' > "$ROOT/.swarmforge/swarm-identity"

cat > "$ROOT/.swarmforge/roles.tsv" <<TSV
coordinator	master	$ROOT	swarmforge-coordinator	Coordinator	claude	task
coder	coder	$CODER_WT	swarmforge-coder	Coder	aider	task
TSV

printf 'Headline: unrelated\n' > "$ROOT/docs/briefings/${TODAY_DAY_KEY}.md"

printf 'from: coder\nto: cleaner\npriority: 50\ntype: git_handoff\ntask: t\ncommit: abc\ncompleted_at: %s\n\nbody\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$CODER_WT/.swarmforge/handoffs/inbox/completed/00_a.handoff"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
CALL_LOG="$ROOT/tmux-calls.log"
cat > "$FAKE_BIN/tmux" <<TMUX
#!/usr/bin/env bash
echo "\$*" >> "$CALL_LOG"
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

LOG_FILE="$ROOT/.swarmforge/daemon/handoffd.log"
start_handoffd() {
  if command -v setsid >/dev/null 2>&1; then
    env -u RESEND_API_KEY PATH="$FAKE_BIN:$PATH" setsid bb "$HANDOFFD" "$ROOT" &
  else
    env -u RESEND_API_KEY PATH="$FAKE_BIN:$PATH" nohup bb "$HANDOFFD" "$ROOT" >/dev/null 2>&1 &
  fi
  DAEMON_PID=$!
}

wait_for_log() {
  local pattern="$1" timeout_s="$2" waited=0
  while (( waited < timeout_s * 4 )); do
    [[ -f "$LOG_FILE" ]] && grep -q "$pattern" "$LOG_FILE" 2>/dev/null && return 0
    sleep 0.25
    waited=$((waited + 1))
  done
  return 1
}

start_handoffd

wait_for_log "role-context-clear-skip-rotation-router" 30 \
  || fail "expected rotation-router skip log; got: $(cat "$LOG_FILE" 2>/dev/null)"
pass "rotation-router mode skips the per-role context-clear sweep"

grep -q "role-context-clear-fired" "$LOG_FILE" \
  && fail "expected no role-context-clear-fired under rotation router; got: $(cat "$LOG_FILE" 2>/dev/null)"
pass "no /clear is injected for pipeline roles under rotation router"

grep -q "/clear" "$CALL_LOG" \
  && fail "expected fake tmux to never receive /clear; got: $(cat "$CALL_LOG" 2>/dev/null)"
pass "fake tmux received no clear injection"

echo "ALL PASS"
