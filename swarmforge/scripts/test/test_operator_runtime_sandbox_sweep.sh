#!/usr/bin/env bash
# BL-413: wiring smoke test for operator_runtime.bb's sandbox-sweep!. Points
# the sweep at a PRIVATE fixture directory via SWARMFORGE_SANDBOX_SWEEP_ROOT
# and the legacy socket-dir guardrail at SWARMFORGE_LEGACY_SOCKET_DIR - the
# same test-only override convention kill_all_swarm.sh already established
# for this exact guardrail. NEVER runs against the real /tmp (the engineering
# "LIVE shared runtime path" rule).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_project_fixture() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/.swarmforge/operator" "$d/swarmforge/scripts" "$d/swarmforge/roles"
  cp "$SRC/operator_lib.bb" "$SRC/operator_runtime.bb" "$SRC/telegram_topic_lib.bb" \
     "$SRC/support_lib.bb" "$SRC/support_thread_store.bb" \
     "$SRC/operator_memory_lib.bb" "$SRC/operator_memory_store.bb" \
     "$SRC/ticket_status_lib.bb" "$SRC/operator_ask.bb" "$SRC/handoff_lib.bb" \
     "$SRC/daemon_alarm_lib.bb" "$SRC/disk_space_lib.bb" "$SRC/sandbox_sweep_lib.bb" "$SRC/fixture_reaper_lib.bb" "$SRC/fixture_reaper_sweep_lib.bb" \
     "$d/swarmforge/scripts/"
  printf '%s' "$d"
}

LIVE_CHILD_PID=""
OPEN_FD_CHILD_PID=""
cleanup() {
  if [[ -n "$LIVE_CHILD_PID" ]]; then
    kill -TERM "$LIVE_CHILD_PID" 2>/dev/null || true
  fi
  if [[ -n "$OPEN_FD_CHILD_PID" ]]; then
    kill -TERM "$OPEN_FD_CHILD_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

PROJECT="$(make_project_fixture)"
SANDBOX_ROOT="$(mktemp -d)"

# ── build the fixture entries ────────────────────────────────────────────────
old_mtime() { touch -d "2 hours ago" "$1"; }

STALE_IDLE="$SANDBOX_ROOT/sfvc-stale-idle"
FRESH="$SANDBOX_ROOT/sfvc-fresh"
STALE_LIVE="$SANDBOX_ROOT/sfvc-stale-live"
STALE_OPEN_FD="$SANDBOX_ROOT/sfvc-stale-open-fd"
UNKNOWN_STALE="$SANDBOX_ROOT/tmp.unknown-stale"
SOCKET_DIR="$SANDBOX_ROOT/swarmforge-9999"

mkdir -p "$STALE_IDLE" "$FRESH" "$STALE_LIVE" "$STALE_OPEN_FD" "$UNKNOWN_STALE" "$SOCKET_DIR"
echo placeholder > "$STALE_OPEN_FD/logfile"
old_mtime "$STALE_IDLE"
old_mtime "$STALE_LIVE"
old_mtime "$STALE_OPEN_FD"
old_mtime "$UNKNOWN_STALE"
old_mtime "$SOCKET_DIR"
# FRESH keeps its just-created mtime.

# A disposable child process (never the test's own PID - engineering rule)
# rooted in STALE_LIVE, so live-process-rooted-in? finds it via /proc/<pid>/cwd.
(cd "$STALE_LIVE" && exec sleep 30) &
LIVE_CHILD_PID=$!

# Architect bounce: liveness must also catch a process whose CWD sits
# elsewhere entirely but that holds a FILE OPEN inside the candidate root -
# `tail -f` keeps its target file's fd open for as long as it runs, with cwd
# fixed at /tmp, never STALE_OPEN_FD itself.
(cd /tmp && exec tail -f "$STALE_OPEN_FD/logfile") &
OPEN_FD_CHILD_PID=$!

# Give /proc a moment to reflect both new processes' cwd/fd state.
for _ in 1 2 3 4 5; do
  [[ -e "/proc/$LIVE_CHILD_PID/cwd" && -e "/proc/$OPEN_FD_CHILD_PID/cwd" ]] && break
  sleep 0.1
done

# ── run one sweep tick ────────────────────────────────────────────────────────
# SWARMFORGE_FIXTURE_REAP_ROOT is isolated too (BL-458's own sweep, wired
# into the SAME tick since that ticket) - a nonexistent path under this
# test's own throwaway PROJECT root, so it no-ops rather than touching the
# real /tmp as a side effect of a test that is only about sandbox-sweep!.
SWARMFORGE_SANDBOX_SWEEP_ROOT="$SANDBOX_ROOT" \
  SWARMFORGE_LEGACY_SOCKET_DIR="$SOCKET_DIR" \
  SWARMFORGE_SANDBOX_STALE_HOURS=1 \
  SWARMFORGE_FIXTURE_REAP_ROOT="$PROJECT/.no-fixture-reap" \
  OPERATOR_SKIP_LAUNCH=1 \
  bb "$PROJECT/swarmforge/scripts/operator_runtime.bb" "$PROJECT" --tick-once > /dev/null

# ── assertions: ONLY the stale idle sfvc- sandbox is gone ───────────────────
check "the stale, idle, known-prefix sandbox is removed" \
  '[[ ! -e "$STALE_IDLE" ]]'
check "a fresh known-prefix sandbox is kept (not stale)" \
  '[[ -e "$FRESH" ]]'
check "a stale known-prefix sandbox with a live process rooted in it is kept" \
  '[[ -e "$STALE_LIVE" ]]'
check "a stale known-prefix sandbox with a live process holding an OPEN FILE inside it (cwd elsewhere) is kept" \
  '[[ -e "$STALE_OPEN_FD" ]]'
check "a stale UNKNOWN-prefix entry is kept (allowlist-only)" \
  '[[ -e "$UNKNOWN_STALE" ]]'
check "the swarm's legacy socket directory is kept regardless of age" \
  '[[ -e "$SOCKET_DIR" ]]'

kill -TERM "$LIVE_CHILD_PID" "$OPEN_FD_CHILD_PID" 2>/dev/null || true
LIVE_CHILD_PID=""
OPEN_FD_CHILD_PID=""
rm -rf "$PROJECT" "$SANDBOX_ROOT"

if [[ "$fail" -eq 0 ]]; then
  echo "operator_runtime sandbox-sweep smoke: ALL CHECKS PASSED"
else
  echo "operator_runtime sandbox-sweep smoke: FAILURES"; exit 1
fi
