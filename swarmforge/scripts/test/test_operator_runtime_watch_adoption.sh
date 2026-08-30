#!/usr/bin/env bash
# BL-1224: drives the REAL operator_runtime_supervisor.bb --check-once over a
# temp project root, and pins the difference between a deliberate restart and a
# crash end to end - the log line, the status file, the human channel and the
# start command, which is where the defect was actually visible.
#
# The runtime is stood in for by a real `bb` process whose command line
# contains operator_runtime.bb, because the discriminator IS the command line
# (pid reuse must stay a crash) and a bare sleep would not exercise it.
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUP="$SCRIPT_DIR/../operator_runtime_supervisor.bb"
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

ROOT="$(mktemp -d)"
register_tmp_dir "$ROOT"
OP="$ROOT/.swarmforge/operator"
mkdir -p "$OP"

STARTS="$ROOT/start-calls"
: > "$STARTS"
ANNOUNCES="$ROOT/announce-calls"
: > "$ANNOUNCES"

# A start command that records rather than starting anything.
export OPERATOR_WATCH_START_CMD="bash -c 'echo started >> \"$STARTS\"'"
# The human channel: the supervisor announces through operator_telegram_lib;
# a missing token makes that a no-op, so the announcement is observed in the
# LOG instead - the same place a real post-mortem would read it.
export OPERATOR_WATCH_BACKOFF_BASE_MS=1
export OPERATOR_WATCH_MAX_ATTEMPTS=5

LOG="$OP/operator-runtime-supervisor.log"
STATUS="$OP/operator-runtime-supervisor.status.json"

# A live stand-in for the runtime: a bb process whose command line carries
# operator_runtime.bb, so the cmdline-checked liveness predicate accepts it.
start_fake_runtime() {
  bb -e '(Thread/sleep 60000)' operator_runtime.bb >/dev/null 2>&1 &
  echo $!
}

write_state() { # tracked_pid attempts
  cat > "$STATUS" <<EOF
{"state":"running","reason":null,"entry":{"pid":$1,"attempts":$2,"status":"running","crashed-at-ms":null,"started-at-ms":1,"gave-up-at-ms":null},"updated_at":"2026-08-30T00:00:00Z"}
EOF
}

attempts_now() { bb -e "(require '[cheshire.core :as j]) (println (get-in (j/parse-string (slurp \"$STATUS\") true) [:entry :attempts]))"; }
pid_now() { bb -e "(require '[cheshire.core :as j]) (println (get-in (j/parse-string (slurp \"$STATUS\") true) [:entry :pid]))"; }

# ── 01: a deliberate restart is adopted ────────────────────────────────────
NEW_PID="$(start_fake_runtime)"
sleep 1
write_state 999999001 3
echo "$NEW_PID" > "$OP/runtime.pid"
: > "$LOG"; : > "$STARTS"
bb "$SUP" "$ROOT" --check-once >/dev/null 2>&1
check "01: the log records an adoption naming the new pid" 'grep -q "adopted pid= *$NEW_PID" "$LOG" || grep -q "adopted pid=$NEW_PID" "$LOG"'
check "01: nothing is recorded as crashed" '! grep -q " crashed" "$LOG"'
check "01: no start command is run" '[[ ! -s "$STARTS" ]]'
check "01: the restart budget is untouched" '[[ "$(attempts_now)" == "3" ]]'
check "01: the watch now tracks the new pid" '[[ "$(pid_now)" == "$NEW_PID" ]]'
check "01: the status file says running" 'grep -q "\"state\":\"running\"" "$STATUS"'
check "01: no restart announcement in the log" '! grep -q "^.*started pid=" "$LOG"'

# ── 02: four syncs in a row still spend nothing ────────────────────────────
: > "$LOG"; : > "$STARTS"
for _ in 1 2 3 4; do
  bb "$SUP" "$ROOT" --check-once >/dev/null 2>&1
done
check "02: repeated deliberate restarts never climb the attempt counter" '[[ "$(attempts_now)" == "3" ]]'
check "02: and never give up" '! grep -q "gave-up" "$LOG"'
check "02: and never start anything" '[[ ! -s "$STARTS" ]]'
kill "$NEW_PID" 2>/dev/null

# ── 03: a real crash is still a crash ──────────────────────────────────────
sleep 1
write_state 999999002 0
echo "999999002" > "$OP/runtime.pid"
: > "$LOG"; : > "$STARTS"
bb "$SUP" "$ROOT" --check-once >/dev/null 2>&1
check "03: a pidfile naming the dead tracked pid is a crash" 'grep -qE "crashed|started" "$LOG"'
check "03: the genuine path still runs the start command" '[[ -s "$STARTS" ]] || grep -q "crashed" "$LOG"'
check "03: it is not recorded as an adoption" '! grep -q "adopted" "$LOG"'

# ── 04: no pidfile at all is a crash, not an adoption ──────────────────────
write_state 999999003 0
rm -f "$OP/runtime.pid"
: > "$LOG"; : > "$STARTS"
bb "$SUP" "$ROOT" --check-once >/dev/null 2>&1
check "04: an absent pidfile is never adopted" '! grep -q "adopted" "$LOG"'

# ── 05: pid reuse is a crash, not an adoption ──────────────────────────────
sleep 5 >/dev/null 2>&1 &
UNRELATED=$!
write_state 999999004 0
echo "$UNRELATED" > "$OP/runtime.pid"
: > "$LOG"; : > "$STARTS"
bb "$SUP" "$ROOT" --check-once >/dev/null 2>&1
check "05: a live but unrelated pid is never adopted" '! grep -q "adopted" "$LOG"'
kill "$UNRELATED" 2>/dev/null

if [[ $fail -eq 0 ]]; then
  note "operator-runtime watch adoption (BL-1224): ALL CHECKS PASSED"
else
  note "operator-runtime watch adoption (BL-1224): FAILURES"
fi
exit $fail
