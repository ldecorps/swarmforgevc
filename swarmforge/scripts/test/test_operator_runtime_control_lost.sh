#!/usr/bin/env bash
# BL-368: "Losing the tmux socket is misread as all 8 agents dying - and the
# scripted recovery would have corrupted the repo." Proves layer 1 of the
# fix: a control channel that used to exist but stopped responding produces
# ONE loud SWARM_CONTROL_LOST event, never N x AGENT_EXITED - and that the
# REAL agent-death detection still fires when the socket is genuinely fine
# and a role's session is genuinely gone (the ticket's own "do not break the
# real path" requirement).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fixture() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/.swarmforge/operator" "$d/swarmforge/scripts" "$d/swarmforge/roles"
  cp "$SRC/operator_lib.bb" "$SRC/operator_runtime.bb" "$SRC/telegram_topic_lib.bb" \
     "$SRC/support_lib.bb" "$SRC/support_thread_store.bb" \
     "$SRC/operator_memory_lib.bb" "$SRC/operator_memory_store.bb" \
     "$SRC/ticket_status_lib.bb" "$SRC/operator_ask.bb" "$SRC/handoff_lib.bb" \
     "$SRC/daemon_alarm_lib.bb" \
     "$d/swarmforge/scripts/"
  printf '%s' "$d"
}
tick() { OPERATOR_SKIP_LAUNCH=1 bb "$1/swarmforge/scripts/operator_runtime.bb" "$1" --tick-once; }

write_roles_tsv() {
  local d="$1"
  printf 'coder\tcoder\t%s/.worktrees/coder\tswarmforge-coder\tCoder\tclaude\ttask\toff\n' "$d" > "$d/.swarmforge/roles.tsv"
  printf 'QA\tQA\t%s/.worktrees/QA\tswarmforge-QA\tQA\tclaude\ttask\toff\n' "$d" >> "$d/.swarmforge/roles.tsv"
}

events_text() {
  cat "$1/.swarmforge/operator/events.jsonl" 2>/dev/null
  cat "$1/.swarmforge/operator/events.inflight.jsonl" 2>/dev/null
}

# ── 1. pointer file present, points at a socket that does not exist ────────
# Exactly the incident shape: .swarmforge/tmux-socket still names a path
# (the pointer survived), but the underlying unix socket special file was
# unlinked out from under a running server.
F1="$(make_fixture)"
write_roles_tsv "$F1"
echo "$F1/.swarmforge/tmux/nonexistent.sock" > "$F1/.swarmforge/tmux-socket"
tick "$F1" >/dev/null
check "control-lost-01: a stale-but-present socket pointer produces SWARM_CONTROL_LOST" \
  '[[ "$(events_text "$F1")" == *"SWARM_CONTROL_LOST"* ]]'
check "control-lost-01: it does NOT also produce AGENT_EXITED for coder" \
  '[[ "$(events_text "$F1")" != *'"'"'"AGENT_EXITED","subject":"coder"'"'"'* ]]'
check "control-lost-01: it does NOT also produce AGENT_EXITED for QA" \
  '[[ "$(events_text "$F1")" != *'"'"'"AGENT_EXITED","subject":"QA"'"'"'* ]]'
check "control-lost-01: exactly one control-lost event, not one per role" \
  '[[ "$(events_text "$F1" | grep -c SWARM_CONTROL_LOST)" -eq 1 ]]'
# BL-368 scenario 04: logged UNCONDITIONALLY to the durable audit trail,
# independent of any LLM Operator ever launching or noticing.
check "control-lost-01: the loss is logged loudly to runtime.log, unconditionally" \
  '[[ -f "$F1/.swarmforge/operator/runtime.log" ]] && grep -q "SWARM_CONTROL_LOST" "$F1/.swarmforge/operator/runtime.log"'
rm -rf "$F1"

# ── 2. no pointer file at all (ordinary pre-launch / never-had-tmux state) ──
# Must NOT be misread as control-lost - you cannot lose control of a channel
# that was never established. This is the normal state every existing tick
# fixture already relies on.
F2="$(make_fixture)"
write_roles_tsv "$F2"
tick "$F2" >/dev/null
check "control-lost-02: no socket pointer at all is the ordinary empty-sessions case, never control-lost" \
  '[[ "$(events_text "$F2")" != *"SWARM_CONTROL_LOST"* ]]'
check "control-lost-02: dead-agent-events still runs normally (both expected roles reported exited)" \
  '[[ "$(events_text "$F2" | grep -c AGENT_EXITED)" -eq 2 ]]'
rm -rf "$F2"

# ── 3. THE REAL DETECTION MUST SURVIVE THE FIX: a genuinely reachable socket
#    with one role's session genuinely gone still reports exactly that role
#    exited - a real tmux server, real sessions, one killed for real. ──────
F3="$(make_fixture)"
write_roles_tsv "$F3"
SOCK_DIR="$(mktemp -d)"
SOCK="$SOCK_DIR/bl368.sock"
tmux -S "$SOCK" new-session -d -s swarmforge-coder -n agent 2>/dev/null
tmux -S "$SOCK" new-session -d -s swarmforge-QA -n agent 2>/dev/null
echo "$SOCK" > "$F3/.swarmforge/tmux-socket"
tmux -S "$SOCK" kill-session -t swarmforge-QA 2>/dev/null
tick "$F3" >/dev/null
check "control-lost-03: a genuinely reachable socket produces NO SWARM_CONTROL_LOST" \
  '[[ "$(events_text "$F3")" != *"SWARM_CONTROL_LOST"* ]]'
check "control-lost-03: the genuinely-dead role (QA) IS reported AGENT_EXITED" \
  '[[ "$(events_text "$F3")" == *'"'"'"AGENT_EXITED","subject":"QA"'"'"'* ]]'
check "control-lost-03: the genuinely-alive role (coder) is NOT reported exited" \
  '[[ "$(events_text "$F3")" != *'"'"'"AGENT_EXITED","subject":"coder"'"'"'* ]]'
tmux -S "$SOCK" kill-server 2>/dev/null || true
rm -rf "$SOCK_DIR" "$F3"

if [[ "$fail" -eq 0 ]]; then
  echo "operator_runtime control-lost smoke: ALL CHECKS PASSED"
else
  echo "operator_runtime control-lost smoke: FAILURES ABOVE"
  exit 1
fi
