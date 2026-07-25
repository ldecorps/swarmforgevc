#!/usr/bin/env bash
# BL-567: CLI-level tests for expedite_cli.bb against a throwaway fixture repo.
# The pure decisions are covered by expedite_lib_test_runner.bb; this exercises
# the driver end to end - park, teardown verification, stage walk, bounce
# accounting, bookkeeping, and the non-blocking restart.
#
# Every case runs for real against a fixture. Nothing here is --dry-run, because
# the cases that matter (a teardown that lied, a restart that failed) are exactly
# the ones a dry-run cannot exercise.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$SCRIPT_DIR/../expedite_cli.bb"
FIXTURE="$SCRIPT_DIR/expedite_fixture.sh"
TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT

fails=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; fails=$((fails + 1)); }
check() { if [[ "$2" == "$3" ]]; then pass "$1"; else fail "$1 (expected '$3', got '$2')"; fi; }
contains() { if grep -qF -- "$3" <<<"$2"; then pass "$1"; else fail "$1 (missing '$3')"; fi; }
absent() { if grep -qF -- "$3" <<<"$2"; then fail "$1 (unexpectedly found '$3')"; else pass "$1"; fi; }

mkfix() {
  local name="$1"; shift
  bash "$FIXTURE" "$TMPROOT/$name" "$@" >/dev/null
  echo "$TMPROOT/$name"
}

run() {
  local root="$1"; shift
  EXPEDITE_STAGE_RUNNER="$root/stage-runner.sh" \
  EXPEDITE_STOP_CMD="${STOP_CMD:-./stop-swarm.sh}" \
  EXPEDITE_START_CMD="${START_CMD:-./start-swarm.sh}" \
    bb "$CLI" "$root" "$@" 2>&1
}

# ── 01 / 12 / 13: a clean traverse parks, preserves, and reaches done ────────
echo "01/12/13: clean traverse"
R="$(mkfix t1 --active BL-567 --active BL-590)"
BEFORE_TIP="$(git -C "$R" rev-parse --short HEAD)"
OUT="$(run "$R" BL-567 --no-restart)"; EXIT=$?
check "01: exit 0 when every gate passes and no restart is attempted" "$EXIT" "0"
check "01: the ticket reached done/" "$(ls "$R/backlog/done/" | tr -d '\n')" "BL-567-fixture.yaml"
check "12: the other active ticket parked to hold/" "$(ls "$R/backlog/hold/" | tr -d '\n')" "BL-590-fixture.yaml"
check "12: nothing was parked to paused/" "$(ls "$R/backlog/paused/" | wc -l | tr -d ' ')" "0"
check "12: the run's OWN ticket was not parked" "$(ls "$R/backlog/hold/" | grep -c BL-567)" "0"
check "13: both pending parcels survived" "$(find "$R/.swarmforge/handoffs" -name '*.handoff' | wc -l | tr -d ' ')" "2"
check "01: every stage ran, in chain order" \
  "$(tr '\n' ' ' < "$R/.swarmforge/expedite-fixture/ran.log" | sed 's/ $//')" \
  "specifier coder cleaner architect hardender documenter QA"
contains "01: a park record was written" "$(cat "$R/.swarmforge/expedite/BL-567/park-record.json")" "role-branch-tips"

# ── 08: work landed on the run's own branch, never on main ──────────────────
echo "08: branch discipline"
check "08: main did not move" "$(git -C "$R" rev-parse --short HEAD)" "$BEFORE_TIP"
contains "08: the run used its own expedite branch" \
  "$(git -C "$R" branch --format='%(refname:short)' | tr '\n' ' ')" "expedite/BL-567"

# ── 10: a stale socket file is not liveness ─────────────────────────────────
echo "10: stale socket file"
absent "10: proceeded without refusing (the fixture ships a server-less .sock)" "$OUT" "REFUSE"
contains "10: and it read as stopped" "$OUT" ":stopped? true"

# ── 09 / 11: the live-swarm interlock ───────────────────────────────────────
echo "09/11: live-swarm interlock"
R2="$(mkfix t2 --active BL-567)"
cat > "$TMPROOT/probe-live.json" <<'JSON'
{"tmux-servers-answering":1,"handoffd":true,"role-agents":8}
JSON
# One gate: initiation STOPS a live swarm, then refuses only if the stop could
# not bring it down. The fixture's stop is a no-op while the probe stays live, so
# this is a swarm that cannot be stopped - genuinely unresolved contention.
OUT2="$(EXPEDITE_PROBE_FILE="$TMPROOT/probe-live.json" run "$R2" BL-567 --no-restart)"; EXIT2=$?
check "09: refuses a live swarm the stop path cannot bring down" "$EXIT2" "1"
contains "09: names what is still alive" "$OUT2" "REFUSE teardown did not reach a clean slate"
contains "09: and says it tried to stop it first" "$OUT2" "initiation will stop it"
check "09: no stage ran" "$([[ -f "$R2/.swarmforge/expedite-fixture/ran.log" ]] && echo yes || echo no)" "no"

OUT3="$(EXPEDITE_PROBE_FILE="$TMPROOT/probe-live.json" run "$R2" BL-567 --no-restart --override)"; EXIT3=$?
contains "11: --override proceeds with a warning naming the override" "$OUT3" "WARNING override in force"
check "11: and the run completes" "$EXIT3" "0"
contains "11: the override is recorded in the run record" \
  "$(cat "$R2/.swarmforge/expedite/BL-567/run.json")" '"override-used?" : true'

# ── 14: a teardown that exits 0 while a survivor lives must REFUSE ──────────
echo "14: lying teardown"
R3="$(mkfix t3 --active BL-567)"
cat > "$TMPROOT/probe-survivor.json" <<'JSON'
{"tmux-servers-answering":0,"babysitterd":true,"role-agents":0}
JSON
OUT4="$(EXPEDITE_PROBE_FILE="$TMPROOT/probe-survivor.json" STOP_CMD="./stop-swarm-lying.sh" \
        run "$R3" BL-567 --no-restart)"; EXIT4=$?
check "14: refuses when the teardown left a survivor" "$EXIT4" "1"
contains "14: names the survivor" "$OUT4" "babysitterd"
contains "14: and flags that the exit code lied" "$OUT4" "exited 0 but these survived"
check "14: no stage ran" "$([[ -f "$R3/.swarmforge/expedite-fixture/ran.log" ]] && echo yes || echo no)" "no"

# ── 04 / 05 / 05b: bounce, bound of 3, and the spec-defect reading ──────────
echo "04/05/05b: bounces"
R4="$(mkfix t4 --active BL-567)"
cat > "$R4/.swarmforge/expedite-fixture/architect.verdict" <<'JSON'
{"verdict":"bounce","target":"coder","reason":"same concern again","class":"resume-identity"}
JSON
OUT5="$(run "$R4" BL-567 --no-restart)"; EXIT5=$?
check "05: exhausting the bound exits non-zero" "$EXIT5" "1"
contains "05: after three rounds against that gate" "$OUT5" ":rounds 3"
contains "05: naming the gate" "$OUT5" ":gate \"architect\""
contains "05b: a repeated class is a probable spec defect" "$OUT5" ":probable-spec-defect"
contains "05b: it names the repeated class" "$OUT5" ":repeated-class \"resume-identity\""
contains "05b: and routes to the specifier" "$OUT5" ":route-to \"specifier\""
contains "05b: without blaming a stage" "$OUT5" ":blame-stage nil"
check "04: the coder re-ran after each bounce" \
  "$(grep -c '^coder$' "$R4/.swarmforge/expedite-fixture/ran.log")" "4"
check "05: the ticket did NOT reach done/" "$(ls "$R4/backlog/done/" | wc -l | tr -d ' ')" "0"

# ── 05c: a raised bound is explicit and recorded ────────────────────────────
echo "05c: raised bound"
R5="$(mkfix t5 --active BL-567)"
cp "$R4/.swarmforge/expedite-fixture/architect.verdict" "$R5/.swarmforge/expedite-fixture/architect.verdict"
OUT6="$(run "$R5" BL-567 --no-restart --bounce-bound 5)"
contains "05c: the raise is announced" "$OUT6" "bounce bound 5 (RAISED explicitly)"
contains "05c: and reached five rounds before exhausting" "$OUT6" ":rounds 5"
OUT7="$(run "$(mkfix t6 --active BL-567)" BL-567 --no-restart)"
contains "05c: the default stays 3 when no bound is given" "$OUT7" "bounce bound 3 (default)"

# ── 16 / 17: the restart is non-blocking ────────────────────────────────────
echo "16/17: non-blocking restart"
R7="$(mkfix t7 --active BL-567)"
OUT8="$(START_CMD="./start-swarm-broken.sh" run "$R7" BL-567)"; EXIT8=$?
check "16: a failed restart exits non-zero" "$EXIT8" "1"
check "16: but the ticket still reached done/" "$(ls "$R7/backlog/done/" | tr -d '\n')" "BL-567-fixture.yaml"
RUN_JSON="$(cat "$R7/.swarmforge/expedite/BL-567/run.json")"
contains "16: the ticket verdict is still done" "$RUN_JSON" '"ticket" : "done"'
contains "16: and the two halves are distinguished" "$RUN_JSON" '"failed-half" : "restart"'
contains "16: the restart half is named failed" "$RUN_JSON" '"outcome" : "failed"'
contains "17: the live-set delta is reported" "$RUN_JSON" '"live-set-delta"'

R8="$(mkfix t8 --active BL-567)"
OUT9="$(run "$R8" BL-567)"
contains "17: a start that works but comes up short reads degraded, not failed" "$OUT9" "restart degraded"

# ── 18: parked work is reported, never re-promoted ──────────────────────────
echo "18: parked work reported"
R9="$(mkfix t9 --active BL-567 --active BL-590)"
run "$R9" BL-567 >/dev/null 2>&1
RUN9="$(cat "$R9/.swarmforge/expedite/BL-567/run.json")"
contains "18: the report names what is still held" "$RUN9" '"still-held"'
contains "18: and promotes nothing" "$RUN9" '"promoted" : [ ]'
check "18: the parked ticket is still in hold/ after the restart" \
  "$(ls "$R9/backlog/hold/" | tr -d '\n')" "BL-590-fixture.yaml"

# ── 15: a stage that overruns its budget fails loudly ──────────────────────
echo "15: stage timeout"
R10="$(mkfix t10 --active BL-567)"
cat > "$R10/stage-runner-slow.sh" <<'SH'
#!/usr/bin/env bash
sleep 2
echo '{"verdict":"pass"}' > "$4"
SH
chmod +x "$R10/stage-runner-slow.sh"
OUT10="$(EXPEDITE_STAGE_RUNNER="$R10/stage-runner-slow.sh" EXPEDITE_STOP_CMD=./stop-swarm.sh \
         EXPEDITE_START_CMD=./start-swarm.sh bb "$CLI" "$R10" BL-567 --no-restart --stage-timeout-ms 1 2>&1)"
EXIT10=$?
check "15: a stage past its budget exits non-zero" "$EXIT10" "1"
contains "15: and names the timeout" "$OUT10" "stage-timeout"
check "15: the ticket did not reach done/" "$(ls "$R10/backlog/done/" | wc -l | tr -d ' ')" "0"

# ── report ─────────────────────────────────────────────────────────────────
echo
if [[ "$fails" -eq 0 ]]; then
  echo "test_expedite_cli: ALL PASS"
else
  echo "test_expedite_cli: $fails FAILURE(S)"
  exit 1
fi
