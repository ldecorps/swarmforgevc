#!/usr/bin/env bash
# BL-657: wiring tests for start-swarm.sh's wait_for_ready sustained-
# readiness check and its failure-path diagnostics, against a REAL
# throwaway tmux server (not a faked `tmux` on PATH) - the failure
# signature this reproduces (sessions alive at t+2s, tmux server gone at
# t+3s) is exactly what a single-snapshot readiness check missed three
# times in one night, reporting the bare "ERROR: swarm did not become
# ready" with no clue the server had briefly come up at all.
#
# Also proves start-swarm.sh can be sourced (as this file does) without
# executing main() - the BASH_SOURCE/$0 guard added for testability holds.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

cleanup_socks=()
cleanup() {
  local sock
  for sock in "${cleanup_socks[@]:-}"; do
    [[ -n "$sock" ]] && tmux -S "$sock" kill-server 2>/dev/null || true
  done
}
trap cleanup EXIT

# ═══════════════════════════════════════════════════════════════════════════
# Sourcing start-swarm.sh must not launch anything - proves the guard.
# ═══════════════════════════════════════════════════════════════════════════

START_SWARM="$SCRIPT_DIR/../../../start-swarm.sh"
[[ -f "$START_SWARM" ]] || fail "00: start-swarm.sh not found at $START_SWARM"

# shellcheck disable=SC1091
source "$START_SWARM"
# start-swarm.sh's own top-level `set -euo pipefail` executes on source (it
# is outside main(), so the BASH_SOURCE guard does not shield it) and leaks
# errexit into THIS script's shell, since `source` runs in the current shell
# rather than a subshell. Without resetting it here, this test script would
# abort the instant a scenario below legitimately expects wait_for_ready to
# return non-zero (scenario 02), rather than asserting on that return code.
set +e

[[ "$(type -t wait_for_ready)" == "function" ]] \
  || fail "00: expected sourcing start-swarm.sh to define wait_for_ready without executing main()"
pass "00: start-swarm.sh can be sourced for testing without launching anything (main() guard holds)"

# ═══════════════════════════════════════════════════════════════════════════
# 01: a session that STAYS ready across the confirmation window is reported
# ready (the ordinary, non-failing case must still pass).
# ═══════════════════════════════════════════════════════════════════════════

TARGET_01="$(mktemp -d)"
register_tmp_dir "$TARGET_01"
mkdir -p "$TARGET_01/.swarmforge"
SOCK_01="$TARGET_01/.swarmforge/fixture.sock"
cleanup_socks+=("$SOCK_01")
tmux -S "$SOCK_01" new-session -d -s fixture-role 'sleep 30'
printf '%s' "$SOCK_01" > "$TARGET_01/.swarmforge/tmux-socket"

SOCKET_FILE="$TARGET_01/.swarmforge/tmux-socket"
DAEMON_PID_FILE="$TARGET_01/.swarmforge/daemon/handoffd.pid"
TARGET="$TARGET_01"
WAIT_FOR_READY_CONFIRMATIONS=2 WAIT_FOR_READY_POLL_INTERVAL=1 WAIT_FOR_READY_MAX_POLLS=5 \
  wait_for_ready 1 >/tmp/bl657-wfr-01.out 2>&1
RC_01=$?
[[ "$RC_01" -eq 0 ]] || fail "01: expected wait_for_ready to succeed for a session that stays up, got exit $RC_01: $(cat /tmp/bl657-wfr-01.out)"
grep -qi "confirmed stable" /tmp/bl657-wfr-01.out \
  || fail "01: expected the success message to name the sustained confirmation, got: $(cat /tmp/bl657-wfr-01.out)"
pass "01: a session that stays up across the confirmation window is correctly reported ready"

tmux -S "$SOCK_01" kill-server 2>/dev/null || true
rm -f /tmp/bl657-wfr-01.out

# ═══════════════════════════════════════════════════════════════════════════
# 02 (THE FAILURE SIGNATURE): a session set that IS ready on the first poll
# but dies before the confirmation poll must NOT be reported ready - this is
# the exact race that let three identical server deaths go unnoticed as
# anything but a plain timeout. The sustained check must reset on the death
# and correctly run out and fail, capturing diagnostics.
# ═══════════════════════════════════════════════════════════════════════════

TARGET_02="$(mktemp -d)"
register_tmp_dir "$TARGET_02"
mkdir -p "$TARGET_02/.swarmforge"
SOCK_02="$TARGET_02/.swarmforge/fixture.sock"
cleanup_socks+=("$SOCK_02")
tmux -S "$SOCK_02" new-session -d -s fixture-role 'sleep 30'
printf '%s' "$SOCK_02" > "$TARGET_02/.swarmforge/tmux-socket"
echo "some prior launch output" > "$TARGET_02/.swarmforge/start-swarm-launch.log"

SOCKET_FILE="$TARGET_02/.swarmforge/tmux-socket"
DAEMON_PID_FILE="$TARGET_02/.swarmforge/daemon/handoffd.pid"
TARGET="$TARGET_02"

# Kill the server ~0.5s in - after the first poll (at t=0, sock exists,
# n=1>=1, confirm=1, then sleeps 1s) but BEFORE the second poll (at t=1)
# would otherwise confirm it and return success.
( sleep 0.5; tmux -S "$SOCK_02" kill-server 2>/dev/null || true ) &
KILLER_PID=$!

WAIT_FOR_READY_CONFIRMATIONS=2 WAIT_FOR_READY_POLL_INTERVAL=1 WAIT_FOR_READY_MAX_POLLS=4 \
  wait_for_ready 1 >/tmp/bl657-wfr-02.out 2>&1
RC_02=$?
wait "$KILLER_PID" 2>/dev/null || true

[[ "$RC_02" -ne 0 ]] \
  || fail "02: expected wait_for_ready to FAIL for a session that dies inside the confirmation window (the exact BL-657 failure signature), but it reported success: $(cat /tmp/bl657-wfr-02.out)"
pass "02: a session that dies inside the confirmation window is correctly NOT reported as ready - the sustained check catches the race a single snapshot would miss"

grep -qi "did not become ready" /tmp/bl657-wfr-02.out \
  || fail "02: expected the bare readiness-failure message to still be present, got: $(cat /tmp/bl657-wfr-02.out)"
grep -qi "launch failure diagnostics" /tmp/bl657-wfr-02.out \
  || fail "02: expected diagnostics beyond the bare message on failure, got: $(cat /tmp/bl657-wfr-02.out)"
grep -qi "NOT responding" /tmp/bl657-wfr-02.out \
  || fail "02: expected the diagnostics to name the dead tmux server explicitly, got: $(cat /tmp/bl657-wfr-02.out)"
grep -qi "some prior launch output" /tmp/bl657-wfr-02.out \
  || fail "02: expected the diagnostics to tail the launch log, got: $(cat /tmp/bl657-wfr-02.out)"
pass "02: a failed launch leaves readable diagnostics (dead-server state + launch log tail), never only the bare 'did not become ready'"

rm -f /tmp/bl657-wfr-02.out

echo "ALL PASS"
