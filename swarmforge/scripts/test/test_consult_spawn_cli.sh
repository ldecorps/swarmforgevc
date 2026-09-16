#!/usr/bin/env bash
# Hotfix 2026-09-16: consult_spawn_cli.bb - the standalone spawn entry an
# external caller (night-closing-ceremony-run.ts's rotateDocumenter
# fallback) uses to get a mono-router dormant role a live, ephemeral
# session without touching the resident. Drives the REAL CLI against an
# isolated fixture root and a fake tmux on PATH - same fixture shape
# test_chase_departing_mid_parcel_gate.sh uses for the sibling gate.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL_SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI="$REAL_SCRIPTS_DIR/consult_spawn_cli.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

make_fake_tmux() {
  local bin_dir="$1"
  mkdir -p "$bin_dir"
  cat > "$bin_dir/tmux" <<'TMUX'
#!/usr/bin/env bash
# Tracks session existence via a marker file per session name under
# TMUX_STATE_DIR - has-session reads it, new-session creates it (and logs
# the full invocation for assertion).
args=("$@")
if [[ "${args[0]:-}" == "-S" ]]; then
  socket="${args[1]}"
  sub="${args[2]:-}"
  case "$sub" in
    has-session)
      # -t NAME is always args[4] in this CLI's own calls.
      name="${args[4]:-}"
      [[ -f "$TMUX_STATE_DIR/$name.exists" ]] && exit 0
      exit 1
      ;;
    new-session)
      printf '%s\n' "${args[*]}" >> "$TMUX_LOG"
      # shape: -S sock new-session -d -s NAME -n swarm <launch> -> NAME is
      # args[5] (0-indexed: -S=0 sock=1 new-session=2 -d=3 -s=4 NAME=5).
      name="${args[5]:-}"
      touch "$TMUX_STATE_DIR/$name.exists"
      exit 0
      ;;
    *)
      printf '%s\n' "${args[*]}" >> "$TMUX_LOG"
      exit 0
      ;;
  esac
fi
echo "unexpected tmux invocation: $*" >&2
exit 1
TMUX
  chmod +x "$bin_dir/tmux"
}

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
cleanup() { rm -rf "$ROOT"; }
trap cleanup EXIT

DOC_WT="$ROOT/wt-documenter"
mkdir -p "$DOC_WT/.swarmforge/handoffs/inbox/new" \
         "$DOC_WT/.swarmforge/handoffs/inbox/in_process" \
         "$ROOT/.swarmforge/launch" \
         "$ROOT/.swarmforge/daemon/consult"

printf 'documenter\tdocumenter\t%s\tswarmforge-documenter\tDocumenter\tclaude\ttask\n' "$DOC_WT" > "$ROOT/.swarmforge/roles.tsv"

touch "$ROOT/fake.sock"
echo "$ROOT/fake.sock" > "$ROOT/.swarmforge/tmux-socket"

printf '#!/bin/sh\nexit 0\n' > "$ROOT/.swarmforge/launch/documenter.sh"
chmod +x "$ROOT/.swarmforge/launch/documenter.sh"

FAKE_BIN="$ROOT/bin"
make_fake_tmux "$FAKE_BIN"
export TMUX_LOG="$ROOT/tmux-calls.log"
export TMUX_STATE_DIR="$ROOT/tmux-state"
mkdir -p "$TMUX_STATE_DIR"
touch "$TMUX_LOG"

run_cli() {
  PATH="$FAKE_BIN:$PATH" bb "$CLI" "$ROOT" "documenter" "coordinator"
}

# 01: no session, no marker -> spawns, writes marker, logs the atomic
# new-session command (never a create-then-respawn sequence).
out="$(run_cli)"
echo "$out" | grep -q '"status":"spawned"' || fail "01: expected spawned status, got: $out"
[[ -f "$ROOT/.swarmforge/daemon/consult/documenter.json" ]] || fail "01: expected consult marker written"
grep -q '"requested_by":"coordinator"' "$ROOT/.swarmforge/daemon/consult/documenter.json" || fail "01: marker missing requested_by"
new_session_calls="$(grep -c 'new-session' "$TMUX_LOG" || true)"
[[ "$new_session_calls" == "1" ]] || fail "01: expected exactly one new-session call, got $new_session_calls"
respawn_calls="$(grep -c 'respawn-pane' "$TMUX_LOG" || true)"
[[ "$respawn_calls" == "0" ]] || fail "01: expected zero respawn-pane calls (never create-then-respawn), got $respawn_calls"
pass "01: no session, no marker - spawns via one atomic new-session, writes marker"

# 02: marker already exists (from 01) -> no-op, no second spawn attempt,
# even though the CLI is invoked again (idempotent under retry/race).
: > "$TMUX_LOG"
out="$(run_cli)"
echo "$out" | grep -q '"status":"already-exists"' || fail "02: expected already-exists status (session from 01 still live), got: $out"
[[ -s "$TMUX_LOG" ]] && fail "02: expected zero new tmux calls on a repeat invocation, got: $(cat "$TMUX_LOG")"
pass "02: session already live - idempotent no-op, no second spawn"

# 03: session torn down (simulating the existing consult-teardown-sweep
# having cleaned it up) but the marker was somehow left behind -> refuses
# to spawn a second time under the same marker rather than risk a double
# spawn race.
rm -f "$TMUX_STATE_DIR/swarmforge-documenter.exists"
: > "$TMUX_LOG"
out="$(run_cli)"
echo "$out" | grep -q '"status":"already-consulting"' || fail "03: expected already-consulting status, got: $out"
[[ -s "$TMUX_LOG" ]] && fail "03: expected zero tmux calls when a stale marker is present, got: $(cat "$TMUX_LOG")"
pass "03: stale marker present, session gone - refuses a second spawn rather than racing"

# 04: unknown role -> refuses loudly (nonzero exit), never a fabricated
# session name.
rm -f "$ROOT/.swarmforge/daemon/consult/documenter.json"
if PATH="$FAKE_BIN:$PATH" bb "$CLI" "$ROOT" "nonexistent-role" "coordinator" > "$ROOT/out04.txt" 2>&1; then
  fail "04: expected nonzero exit for an unknown role"
fi
grep -q '"status":"no-such-role"' "$ROOT/out04.txt" || fail "04: expected no-such-role status, got: $(cat "$ROOT/out04.txt")"
pass "04: unknown role refuses loudly, never fabricates a session"

echo "test_consult_spawn_cli: ALL CHECKS PASSED"
