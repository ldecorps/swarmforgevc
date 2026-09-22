#!/usr/bin/env bash
# BL-1688 acceptance driver: drives the REAL start_handoff_daemon.sh against
# a throwaway mkdtemp fixture root (BL-971/BL-1390 - removed in a trap on
# every exit path) - never a reimplementation of its marker-gate or status
# rewrite logic. The daemon command is replaced by a RECORDED FAKE bb (the
# same interception shape test_start_handoff_daemon.sh already uses) that
# never launches a real daemon; the real HANDOFFD_BB/HANDOFFD_SUPERVISOR_BB
# env seams point at fake targets, and a fake `bb` on PATH intercepts those
# two names, recording an invocation and claiming the pid file, while
# falling through to the REAL bb for anything else (this script's own
# python3-based status rewrite never goes through `bb` at all, so it is
# unaffected either way).
#
# Env in:
#   BL1688_MARKER=1            write the handoffd.stopped marker first
#   BL1688_STOPFILE=1           write the supervisor's stop file first
#   BL1688_RESTART_HISTORY=1    seed one restart_history entry in status.json
#   BL1688_CALLER=<value>       SWARMFORGE_DAEMON_START_CALLER for the run
#
# Stdout out (one KEY=VALUE line each, no embedded newlines):
#   EXIT_CODE=<n>
#   FAKE_LAUNCH_COUNT=<n>
#   MARKER_PRESENT_AFTER=<0|1>
#   STOPFILE_PRESENT_AFTER=<0|1>
#   STATUS_BYTE_IDENTICAL=<0|1>
#   AUDIT_LAST_LINE=<text>
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
START_HANDOFF="$SRC/start_handoff_daemon.sh"
# shellcheck disable=SC1091
source "$SRC/freshness_stop_marker_lib.sh"

ROOT="$(mktemp -d)"
FAKE_BIN="$(mktemp -d)"
cleanup() {
  rm -rf "$ROOT" "$FAKE_BIN"
}
trap cleanup EXIT

DAEMON_DIR="$ROOT/.swarmforge/daemon"
mkdir -p "$DAEMON_DIR"
STATUS_FILE="$DAEMON_DIR/handoffd.status.json"

if [[ "${BL1688_RESTART_HISTORY:-0}" == "1" ]]; then
  printf '{"state":"dead","restart_history":[{"at":1,"result":"failed","reason":"dead"}]}' > "$STATUS_FILE"
else
  printf '{"state":"healthy"}' > "$STATUS_FILE"
fi

if [[ "${BL1688_MARKER:-0}" == "1" ]]; then
  freshness_mark_stopped "$ROOT" "handoffd"
fi
if [[ "${BL1688_STOPFILE:-0}" == "1" ]]; then
  : > "$DAEMON_DIR/stop"
fi

MARKER_FILE="$(freshness_stopped_marker "$ROOT" "handoffd")"
STOP_FILE="$DAEMON_DIR/stop"
MARKER_BEFORE=""
[[ -f "$MARKER_FILE" ]] && MARKER_BEFORE="$(cat "$MARKER_FILE")"
STATUS_BEFORE="$(cat "$STATUS_FILE")"

LAUNCH_LOG="$ROOT/fake-launch.log"

# The recorded fake: matches the two names the real script launches by
# HANDOFFD_BB/HANDOFFD_SUPERVISOR_BB, records one line per invocation, and
# claims its own pid file immediately so the real script's own claim-wait
# loop succeeds fast - it never actually launches a daemon (a
# short-lived `sleep`, killed by the trap above tearing down $ROOT).
cat > "$FAKE_BIN/bb" <<EOF
#!/usr/bin/env bash
for arg in "\$@"; do
  if [[ "\$arg" == *fake-handoffd.bb ]]; then
    echo launched-handoffd >> "$LAUNCH_LOG"
    sleep 60 &
    echo \$! > "$DAEMON_DIR/handoffd.pid"
    exit 0
  fi
  if [[ "\$arg" == *fake-supervisor.bb ]]; then
    echo launched-supervisor >> "$LAUNCH_LOG"
    sleep 60 &
    echo \$! > "$DAEMON_DIR/handoffd-supervisor.pid"
    exit 0
  fi
done
exec true
EOF
chmod +x "$FAKE_BIN/bb"

SWARMFORGE_DAEMON_START_CALLER="${BL1688_CALLER:-unknown}" \
HANDOFFD_BB="$ROOT/bin/fake-handoffd.bb" \
HANDOFFD_SUPERVISOR_BB="$ROOT/bin/fake-supervisor.bb" \
PID_WAIT_ATTEMPTS=30 \
PATH="$FAKE_BIN:$PATH" \
  bash "$START_HANDOFF" "$ROOT" >/dev/null 2>&1
EXIT_CODE=$?

# "the recorded fake" (Background: "the start owner's daemon command") is
# HANDOFFD_BB specifically - the supervisor is a separate companion
# process, counted only informationally (not what "launched exactly once"
# in the feature text refers to).
FAKE_LAUNCH_COUNT=0
[[ -f "$LAUNCH_LOG" ]] && FAKE_LAUNCH_COUNT="$(grep -c '^launched-handoffd$' "$LAUNCH_LOG" 2>/dev/null || echo 0)"

MARKER_PRESENT_AFTER=0
[[ -f "$MARKER_FILE" ]] && MARKER_PRESENT_AFTER=1

STOPFILE_PRESENT_AFTER=0
[[ -f "$STOP_FILE" ]] && STOPFILE_PRESENT_AFTER=1

STATUS_AFTER="$(cat "$STATUS_FILE" 2>/dev/null || echo "")"
STATUS_BYTE_IDENTICAL=0
[[ "$STATUS_BEFORE" == "$STATUS_AFTER" ]] && STATUS_BYTE_IDENTICAL=1

AUDIT_LAST_LINE="$(tail -n 1 "$DAEMON_DIR/daemon-start-audit.log" 2>/dev/null || echo "")"

# Kill whichever fake process this run's own pid files claim, if any -
# defensive: the trap above only removes the tree, it does not itself
# confirm the process is gone first.
for pf in "$DAEMON_DIR/handoffd.pid" "$DAEMON_DIR/handoffd-supervisor.pid"; do
  if [[ -f "$pf" ]]; then
    pid="$(cat "$pf" 2>/dev/null || echo "")"
    [[ "$pid" =~ ^[0-9]+$ ]] && kill "$pid" 2>/dev/null || true
  fi
done

printf 'EXIT_CODE=%s\n' "$EXIT_CODE"
printf 'FAKE_LAUNCH_COUNT=%s\n' "$FAKE_LAUNCH_COUNT"
printf 'MARKER_PRESENT_AFTER=%s\n' "$MARKER_PRESENT_AFTER"
printf 'STOPFILE_PRESENT_AFTER=%s\n' "$STOPFILE_PRESENT_AFTER"
printf 'STATUS_BYTE_IDENTICAL=%s\n' "$STATUS_BYTE_IDENTICAL"
printf 'AUDIT_LAST_LINE=%s\n' "$AUDIT_LAST_LINE"
