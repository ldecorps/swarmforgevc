#!/usr/bin/env bash
# BL-458: wiring smoke test for operator_runtime.bb's fixture-reaper-sweep!
# (via fixture_reaper_sweep_lib.bb). Points the sweep at a PRIVATE fixture
# directory via SWARMFORGE_FIXTURE_REAP_ROOT and the legacy socket-dir
# guardrail at SWARMFORGE_LEGACY_SOCKET_DIR - the same test-only override
# convention kill_all_swarm.sh / BL-413's own sandbox-sweep test already
# established for this exact guardrail. NEVER runs against the real /tmp or
# a live swarm (the engineering "LIVE shared runtime path" rule).
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
     "$SRC/daemon_alarm_lib.bb" "$SRC/disk_space_lib.bb" "$SRC/sandbox_sweep_lib.bb" "$SRC/bounded_delete_sweep_lib.bb" "$SRC/proc_fd_scan_lib.bb" \
     "$SRC/fixture_reaper_lib.bb" "$SRC/fixture_reaper_sweep_lib.bb" \
     "$d/swarmforge/scripts/"
  printf '%s' "$d"
}

LIVE_PIDS=()
cleanup() {
  for p in "${LIVE_PIDS[@]:-}"; do
    [[ -n "$p" ]] && kill -TERM "$p" 2>/dev/null || true
  done
}
trap cleanup EXIT

PROJECT="$(make_project_fixture)"
REAP_ROOT="$(mktemp -d)"

old_mtime() { touch -d "2 hours ago" "$1"; }

STALE_ORPHAN="$REAP_ROOT/aps-stale-orphan"
FRESH="$REAP_ROOT/aps-fresh"
STALE_OPEN_FD="$REAP_ROOT/aps-stale-open-fd"
UNKNOWN_STALE="$REAP_ROOT/tmp.unknown-stale"
SOCKET_ROOT="$REAP_ROOT/swarmforge-9999"

mkdir -p "$STALE_ORPHAN" "$FRESH" "$STALE_OPEN_FD" "$UNKNOWN_STALE" "$SOCKET_ROOT"
echo placeholder > "$STALE_OPEN_FD/logfile"

# A disposable orphan process (never the test's own PID) rooted in
# STALE_ORPHAN - the reaper must kill it, not just remove the directory.
(cd "$STALE_ORPHAN" && exec sleep 30) &
ORPHAN_PID=$!
LIVE_PIDS+=("$ORPHAN_PID")

# Architect bounce (on this scan's BL-413 sibling): liveness/kill coverage
# must also catch a process whose CWD sits elsewhere entirely but that holds
# a FILE OPEN inside the candidate root - `tail -f` keeps its target file's
# fd open for as long as it runs, with cwd fixed at /tmp, never
# STALE_OPEN_FD itself. The reaper must still find and kill it via the open
# fd, not just cwd.
(cd /tmp && exec tail -f "$STALE_OPEN_FD/logfile") &
OPEN_FD_PID=$!
LIVE_PIDS+=("$OPEN_FD_PID")

# A disposable process rooted in the socket root - must survive untouched,
# regardless of matching a known prefix or being stale (it never does match
# a known prefix here, but the socket-root guardrail must hold even if it
# somehow did - defense in depth, mirrors the pure predicate's own test).
(cd "$SOCKET_ROOT" && exec sleep 30) &
SOCKET_PID=$!
LIVE_PIDS+=("$SOCKET_PID")

# A real tmux server whose socket lives under STALE_ORPHAN - the reaper
# must kill the tmux server too (fixture-process-leak-02's own "no tmux
# server for that fixture's socket survives" claim). Created BEFORE the
# old_mtime calls below - adding a file to a directory bumps ITS OWN mtime,
# so setting the fixture's age first and creating the socket after would
# silently un-stale it again.
TMUX_SOCK="$STALE_ORPHAN/role.sock"
tmux -S "$TMUX_SOCK" new-session -d -s reaper-test-session

for _ in 1 2 3 4 5; do
  [[ -e "/proc/$ORPHAN_PID/cwd" && -e "/proc/$OPEN_FD_PID/cwd" && -e "/proc/$SOCKET_PID/cwd" ]] && break
  sleep 0.1
done

# Ages set LAST, after every fixture-creating step above (mkdir/tmux) that
# would otherwise bump these directories' own mtimes back to "now".
old_mtime "$STALE_ORPHAN"
old_mtime "$STALE_OPEN_FD"
old_mtime "$UNKNOWN_STALE"
old_mtime "$SOCKET_ROOT"
# FRESH keeps its just-created mtime.

# ── run one reaper tick ───────────────────────────────────────────────────────
SWARMFORGE_FIXTURE_REAP_ROOT="$REAP_ROOT" \
  SWARMFORGE_LEGACY_SOCKET_DIR="$SOCKET_ROOT" \
  SWARMFORGE_FIXTURE_REAP_STALE_HOURS=1 \
  SWARMFORGE_SANDBOX_SWEEP_ROOT="$PROJECT/.no-sandbox-sweep" \
  OPERATOR_SKIP_LAUNCH=1 \
  bb "$PROJECT/swarmforge/scripts/operator_runtime.bb" "$PROJECT" --tick-once > /dev/null

sleep 0.3 # let SIGKILL delivery + tmux server exit settle

# ── assertions ─────────────────────────────────────────────────────────────────
check "the orphaned process rooted in the stale known-prefix root is killed" \
  '! kill -0 "$ORPHAN_PID" 2>/dev/null'
check "the stale known-prefix root itself is removed" \
  '[[ ! -e "$STALE_ORPHAN" ]]'
check "the tmux server whose socket lived under the reaped root is killed" \
  '! tmux -S "$TMUX_SOCK" list-sessions 2>/dev/null'
check "a process with cwd elsewhere but an OPEN FILE inside a reaped root is killed too" \
  '! kill -0 "$OPEN_FD_PID" 2>/dev/null'
check "the root that process's open file lived under is removed" \
  '[[ ! -e "$STALE_OPEN_FD" ]]'
check "a fresh known-prefix root is kept (not stale)" \
  '[[ -e "$FRESH" ]]'
check "a stale UNKNOWN-prefix entry is kept (allowlist-only)" \
  '[[ -e "$UNKNOWN_STALE" ]]'
check "the swarm's legacy socket root directory is kept regardless of age" \
  '[[ -e "$SOCKET_ROOT" ]]'
check "the process rooted in the socket root survives untouched" \
  'kill -0 "$SOCKET_PID" 2>/dev/null'

# Deliberately NOT clearing LIVE_PIDS or killing SOCKET_PID here - the EXIT
# trap's cleanup() already kills every entry in LIVE_PIDS (a no-op against
# one the reaper already killed) and would silently leak SOCKET_PID here if
# it ever ran with an empty array first. That gap bit this test's own
# reviewer: a deliberate break-then-fix run (reaper unfixed, so ORPHAN_PID's
# sibling OPEN_FD_PID survived) leaked a real `tail -f` process because this
# line used to blank LIVE_PIDS before the trap could reach it.
rm -rf "$PROJECT" "$REAP_ROOT"

if [[ "$fail" -eq 0 ]]; then
  echo "operator_runtime fixture-reaper-sweep smoke: ALL CHECKS PASSED"
else
  echo "operator_runtime fixture-reaper-sweep smoke: FAILURES"; exit 1
fi
