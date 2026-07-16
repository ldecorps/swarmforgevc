#!/usr/bin/env bash
# BL-423: kill_all_swarm.sh must reap a REPARENTED pane descendant - the
# exact orphan class behind the BL-422 OOM-spiral (a killed parent leaves a
# detached `node (vitest N)` worker behind: tmux kill-server hangs up the
# pane's own shell, but a job the shell no longer forwards its own SIGHUP
# to survives untouched and gets reparented to init). This drives the real
# script against a real tmux session on a private socket and a real
# disowned descendant process - never a broad name/pattern match against
# the live host's process table (the process-table-is-a-shared-global
# trap): the descendant's pid is recorded by the test itself, from a
# fixture-private tmux session, so this can never observe (or reap) any
# OTHER process on the box.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KILL_ALL="$SCRIPT_DIR/../kill_all_swarm.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

FIXTURE_BASE="$HOME/.sfvc-test-bl423-vitest-reap"
mkdir -p "$FIXTURE_BASE"
ROOT="$(cd "$(mktemp -d "$FIXTURE_BASE/root.XXXXXXXX")" && pwd -P)"
SOCK="$ROOT/.swarmforge/tmux/fixture.sock"
mkdir -p "$ROOT/.swarmforge/tmux" "$ROOT/.swarmforge/daemon"

cleanup() {
  tmux -S "$SOCK" kill-server >/dev/null 2>&1 || true
  [[ -n "${SURVIVOR_PID:-}" ]] && kill -9 "$SURVIVOR_PID" 2>/dev/null || true
  rm -rf "$ROOT" "$FIXTURE_BASE"
}
trap cleanup EXIT

# A real one-window tmux session on a private, fixture-scoped socket -
# never the swarm's own real socket.
tmux -S "$SOCK" new-session -d -s fixture-role -x 80 -y 24
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

PANE_PID="$(tmux -S "$SOCK" list-panes -a -F '#{pane_pid}' | head -1)"
[[ "$PANE_PID" =~ ^[0-9]+$ ]] || fail "setup: could not resolve a real pane pid from the fixture session"

# Simulate the exact orphan class: a backgrounded process the pane's own
# shell no longer forwards its own SIGHUP to (`disown`) - the same
# observable symptom a vitest worker pool's own child leaves behind when
# ITS parent dies (reparented to init, untouched by tmux kill-server's
# hangup of the pane's shell). Recorded as a direct child of the pane's
# shell BEFORE teardown, while that parent/child link is still live to walk.
tmux -S "$SOCK" send-keys -t fixture-role 'sleep 300 & disown; echo READY' Enter
READY=0
for _ in $(seq 1 30); do
  if tmux -S "$SOCK" capture-pane -p -t fixture-role | grep -q READY; then
    READY=1
    break
  fi
  sleep 0.1
done
[[ "$READY" -eq 1 ]] || fail "setup: the fixture's disowned survivor process never reported ready"

# The shell's own echo of "READY" can be observed a hair before pgrep's
# /proc scan catches up with the just-forked child - poll briefly rather
# than a single immediate attempt.
SURVIVOR_PID=""
for _ in $(seq 1 30); do
  SURVIVOR_PID="$(pgrep -P "$PANE_PID" 2>/dev/null | head -1 || true)"
  if [[ -n "$SURVIVOR_PID" ]]; then
    break
  fi
  sleep 0.1
done
[[ -n "$SURVIVOR_PID" ]] || fail "setup: could not resolve the disowned survivor's own pid as a child of the fixture pane"
kill -0 "$SURVIVOR_PID" 2>/dev/null || fail "setup: the disowned survivor process is not actually running"

bash "$KILL_ALL" "$ROOT" >/dev/null 2>&1 || true

# tmux kill-server never reaches a disowned grandchild - if the reap step
# were absent, this process would still be alive after kill_all_swarm.sh
# returns (the exact BL-422 orphan symptom).
sleep 0.3
if kill -0 "$SURVIVOR_PID" 2>/dev/null; then
  fail "kill_all_swarm.sh left the disowned pane descendant (pid=$SURVIVOR_PID) alive - the exact BL-422 orphan class"
fi
pass "kill_all_swarm.sh reaped a disowned pane descendant that tmux kill-server alone could not reach"

grep -q "reaped orphaned pane descendant pid=$SURVIVOR_PID" "$ROOT/.swarmforge/daemon/kill-all-audit.log" \
  || fail "expected the audit log to record the reap of pid=$SURVIVOR_PID; got: $(cat "$ROOT/.swarmforge/daemon/kill-all-audit.log" 2>/dev/null)"
pass "the reap is logged to the audit trail, naming the exact pid reaped"

echo "ALL PASS: kill_all_swarm.sh vitest/pane-descendant orphan reap (BL-423)"
