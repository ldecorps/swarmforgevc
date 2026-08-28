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

# ── QA finding: a `forward` verdict advances (real documenter outcome) ──────
echo "QA: forward verdict"
RF="$(mkfix tf --active BL-567)"
cat > "$RF/.swarmforge/expedite-fixture/documenter.verdict" <<'JSON'
{"verdict":"forward","reason":"internal change; nothing user-facing to document"}
JSON
cat > "$RF/.swarmforge/expedite-fixture/architect.verdict" <<'JSON'
{"verdict":"approved"}
JSON
OUTF="$(run "$RF" BL-567 --no-restart)"; EXITF=$?
check "QA: a real documenter 'forward' advances rather than failing the run" "$EXITF" "0"
check "QA: and the ticket reaches done/" "$(ls "$RF/backlog/done/" | tr -d '\n')" "BL-567-fixture.yaml"
contains "QA: 'approved' also advances" "$OUTF" "ticket done"
RU="$(mkfix tu --active BL-567)"
cat > "$RU/.swarmforge/expedite-fixture/cleaner.verdict" <<'JSON'
{"verdict":"probably-fine"}
JSON
OUTU="$(run "$RU" BL-567 --no-restart)"; EXITU=$?
check "QA: an UNKNOWN verdict fails closed rather than being guessed as advance" "$EXITU" "1"
check "QA: and that ticket does not reach done/" "$(ls "$RU/backlog/done/" | wc -l | tr -d ' ')" "0"

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

# ── BL-1024 (architect send-back): the closing summary survives every ───────
# PRE-FLIGHT refusal, not only the endings that fall through -main's let chain.
#
# park-others! stages real `git mv` moves for every sibling ticket BEFORE three
# refusals that each terminate the process. Until this fix all three ended with
# a sibling genuinely parked and staged in the shared master checkout and
# NOTHING saying so - the 2026-08-21 incident reached by a different trigger,
# and on the common path: a host with a live swarm refuses teardown unless
# --override, which is every host this pipeline actually runs on.
#
# Every case here PINS the probe. The real probe reads the HOST, not the
# fixture, so an unpinned case passes or fails depending on whether this
# machine happens to be running a swarm. (That host-dependence is pre-existing
# and affects the unpinned cases above; it is not this ticket's to fix, but a
# new regression gate must not inherit it.)
echo "BL-1024: the summary survives the pre-flight refusals"
cat > "$TMPROOT/bl1024-probe-stopped.json" <<'JSON'
{"tmux-servers-answering":0,"role-agents":0}
JSON
cat > "$TMPROOT/bl1024-probe-live.json" <<'JSON'
{"tmux-servers-answering":1,"handoffd":true,"role-agents":8}
JSON

# Every refusal below must say the same three things, because a reader on the
# terminal needs all three: what is held, where, and who picks it up.
assert_named_the_leavings() {
  local label="$1" out="$2"
  contains "$label: the summary reaches the terminal" "$out" "OUTSTANDING"
  # Assert against the SUMMARY, not the whole run log. `expedite park BL-590 ->
  # backlog/hold/` already spells both the ticket id and the folder, so the
  # same two assertions over the whole output pass even when no summary is
  # printed at all - measured, they did, against the unfixed driver.
  local summary; summary="$(sed -n '/OUTSTANDING/,$p' <<<"$out")"
  contains "$label: it names the parked ticket" "$summary" "BL-590"
  contains "$label: and the folder holding it" "$summary" "backlog/hold/"
  contains "$label: it names who decides whether the ticket returns" "$summary" "Article 3.1"
  contains "$label: it names the uncommitted move" "$summary" "backlog/active/ -> backlog/hold/"
  contains "$label: and who must commit it" "$summary" "whoever next commits in the master checkout"
}

# (a) initiate!: the stop invocation carries a forbidden flag.
#
# BL-1030 changed what this case asserts, and the change IS the ticket. It used
# to pass STOP_CMD="--sweep-inbox" - a bare flag, not a runnable command, and
# the ONE input the old guard could catch - and then assert the sibling really
# was parked, because the guard sat downstream of park-others!. Both halves
# were the defect: the realistic `./stop-swarm.sh --sweep-inbox` sailed
# straight through, and a refusal that only had to read an env var still left
# half the backlog moved to hold/.
#
# So: the realistic command, and the opposite residue assertion. BL-1024's own
# contract is untouched and still checked below - a refused run reports its
# leavings honestly - it is just that an honest report of THIS refusal is now
# "nothing outstanding", because nothing was parked.
RA="$(mkfix ta --active BL-567 --active BL-590)"
OUTA="$(EXPEDITE_PROBE_FILE="$TMPROOT/bl1024-probe-stopped.json" STOP_CMD="./stop-swarm.sh --sweep-inbox" \
        run "$RA" BL-567 --no-restart)"; EXITA=$?
check "BL-1024a: a forbidden stop flag still refuses" "$EXITA" "1"
contains "BL-1024a: naming the refusal" "$OUTA" "REFUSE stop command carries a forbidden flag"
contains "BL-1030a: and naming the flag itself, not just the command" "$OUTA" "--sweep-inbox"
check "BL-1030a: the sibling was never parked - the refusal is decided first" \
  "$(ls "$RA/backlog/hold/" | wc -l | tr -d ' ')" "0"
check "BL-1030a: and it is still active" \
  "$(ls "$RA/backlog/active/" | tr -d '\n')" "BL-567-fixture.yamlBL-590-fixture.yaml"
check "BL-1030a: the stop command never ran" \
  "$(cat "$RA/.swarmforge/expedite-fixture/stop-invocations.log" 2>/dev/null | wc -l | tr -d ' ')" "0"
check "BL-1030a: and the parcels a parked ticket would need are all still there" \
  "$(find "$RA/.swarmforge/handoffs" -name '*.handoff' | wc -l | tr -d ' ')" "2"
# BL-1024's register is untouched by this ticket, and this is that register's
# OWN rule reaching a new case: `leavings` is "nil until something is actually
# left, so a run that exits before parking reports nothing rather than an empty
# handover". Before BL-1030 this refusal had parked a sibling, so it had a real
# handover to report. Now it has none, so it reports none - which is the same
# rule, not a weaker one. What the operator needs is on the terminal above:
# the refusal, and the flag that caused it.
absent "BL-1030a: a run that left nothing hands over nothing" "$OUTA" "OUTSTANDING"
check "BL-1030a: and writes no refused-run record, because no run happened" \
  "$(test -e "$RA/.swarmforge/expedite/BL-567/run.json" && echo present || echo absent)" "absent"

# (a2) BL-1030: the look-alike must NOT be refused. A target path that merely
#      spells a forbidden flag is a path, and a guard that refused it would be
#      a guard an operator learns to work around.
RA2="$(mkfix ta2 --active BL-567)"
OUTA2="$(EXPEDITE_PROBE_FILE="$TMPROOT/bl1024-probe-stopped.json" \
         STOP_CMD="./stop-swarm.sh /repos/full-sweep-inbox-fix" \
         run "$RA2" BL-567 --no-restart)"
absent "BL-1030a2: a substring look-alike is not a forbidden flag" "$OUTA2" "REFUSE stop command"
check "BL-1030a2: and the stop command really did run" \
  "$(cat "$RA2/.swarmforge/expedite-fixture/stop-invocations.log" 2>/dev/null | wc -l | tr -d ' ')" "1"

# (a3) BL-1030: a command the guard cannot read is refused, not admitted.
RA3="$(mkfix ta3 --active BL-567 --active BL-590)"
OUTA3="$(EXPEDITE_PROBE_FILE="$TMPROOT/bl1024-probe-stopped.json" \
         STOP_CMD="./stop-swarm.sh '--sweep-inbox" \
         run "$RA3" BL-567 --no-restart)"; EXITA3=$?
check "BL-1030a3: an unreadable stop command refuses" "$EXITA3" "1"
contains "BL-1030a3: naming the command it could not read" "$OUTA3" "could not be read as a command line"
check "BL-1030a3: nothing was parked" "$(ls "$RA3/backlog/hold/" | wc -l | tr -d ' ')" "0"
check "BL-1030a3: and the stop command never ran" \
  "$(cat "$RA3/.swarmforge/expedite-fixture/stop-invocations.log" 2>/dev/null | wc -l | tr -d ' ')" "0"

# (b) initiate!: the teardown did not reach a clean slate (the common path)
RB="$(mkfix tb --active BL-567 --active BL-590)"
OUTB="$(EXPEDITE_PROBE_FILE="$TMPROOT/bl1024-probe-live.json" run "$RB" BL-567 --no-restart)"; EXITB=$?
check "BL-1024b: an unstoppable swarm still refuses" "$EXITB" "1"
contains "BL-1024b: naming the refusal" "$OUTB" "REFUSE teardown did not reach a clean slate"
check "BL-1024b: and the sibling really is parked, so the leavings are real" \
  "$(ls "$RB/backlog/hold/" | tr -d '\n')" "BL-590-fixture.yaml"
assert_named_the_leavings "BL-1024b" "$OUTB"

# (c) ensure-worktree!: `git worktree add` cannot create the run worktree
RC="$(mkfix tc --active BL-567 --active BL-590)"
git -C "$RC" branch "expedite/BL-567" main >/dev/null 2>&1
OUTC="$(EXPEDITE_PROBE_FILE="$TMPROOT/bl1024-probe-stopped.json" run "$RC" BL-567 --no-restart)"; EXITC=$?
check "BL-1024c: a worktree that cannot be created still refuses" "$EXITC" "1"
contains "BL-1024c: naming the refusal" "$OUTC" "REFUSE could not create the run worktree"
check "BL-1024c: and the sibling really is parked, so the leavings are real" \
  "$(ls "$RC/backlog/hold/" | tr -d '\n')" "BL-590-fixture.yaml"
assert_named_the_leavings "BL-1024c" "$OUTC"

# (d) honest in the other direction on a refusal too: a run that parked nothing
#     must not manufacture a handover just because it ended badly.
RD="$(mkfix td --active BL-567)"
OUTD="$(EXPEDITE_PROBE_FILE="$TMPROOT/bl1024-probe-live.json" run "$RD" BL-567 --no-restart)"
contains "BL-1024d: a refused run that parked nothing claims nothing" "$OUTD" "nothing outstanding"
absent "BL-1024d: and invents no parked ticket" "$OUTD" "BL-590"

# (e) the gate that keeps it closed. This defect existed because a refusal
#     could terminate the process from inside a helper, three frames below the
#     code that reports the leavings. One exit point is what makes "every
#     ending reports" structural rather than a convention a future edit forgets.
#     Derived from the source, never a hand list of the exits we know about.
echo "BL-1024: one exit point"
CLI_EXITS="$(grep -v '^[[:space:]]*;;' "$CLI" | grep -c '(System/exit')"
check "BL-1024e: expedite_cli.bb terminates the process in exactly one place" "$CLI_EXITS" "1"
contains "BL-1024e: and that one place is the reporting exit" \
  "$(sed -n '/defn- exit!/,/^$/p' "$CLI")" "(System/exit"

# ── 15: a stage that overruns its budget is KILLED, not merely reported ────
echo "15: stage timeout"
R10="$(mkfix t10 --active BL-567)"
# The fixture's hung runner never returns and spawns a grandchild. A report-only
# timeout blocks here forever; the first implementation did exactly that and its
# scenario passed anyway because the old runner slept and RETURNED.
before_orphans="$(ps -eo args= | grep -c '^sleep 3600' || true)"
SECONDS=0
OUT10="$(EXPEDITE_STAGE_RUNNER="$R10/stage-runner-hung.sh" EXPEDITE_STOP_CMD=./stop-swarm.sh \
         EXPEDITE_START_CMD=./start-swarm.sh timeout 60 bb "$CLI" "$R10" BL-567 --no-restart --stage-timeout-ms 1500 2>&1)"
EXIT10=$?
elapsed=$SECONDS
check "15: a hung stage exits non-zero" "$EXIT10" "1"
contains "15: and names the timeout" "$OUT10" "stage-timeout"
check "15: the ticket did not reach done/" "$(ls "$R10/backlog/done/" | wc -l | tr -d ' ')" "0"
if [[ "$elapsed" -lt 30 ]]; then pass "15: the driver terminated in ${elapsed}s rather than blocking"; else fail "15: the driver blocked for ${elapsed}s - the timeout is not enforced"; fi
sleep 1
after_orphans="$(ps -eo args= | grep -c '^sleep 3600' || true)"
check "15: no grandchild survived the kill (process GROUP, not just the child)" "$after_orphans" "$before_orphans"
# Kill leftovers by EXACT argv rather than pkill -f: `pkill -f 'sleep 3600'`
# matches any shell whose own command line mentions that string, including the
# one running this suite. Same self-match trap that makes `pgrep -f handoffd`
# invent phantom survivors.
ps -eo pid=,args= | awk '$2=="sleep" && $3=="3600" {print $1}' | xargs -r kill -KILL 2>/dev/null || true

# ── BL-1023: run ticket not in active/ must not silent-succeed unmoved ─────
echo "BL-1023: bookkeep adopt / refuse"
# Pin a stopped probe: the live host swarm must not steal these cases.
PROBE_STOPPED="$TMPROOT/probe-stopped-bl1023.json"
cat > "$PROBE_STOPPED" <<'JSON'
{"tmux-servers-answering":0,"handoffd":false,"handoffd-supervisor":false,"babysitterd":false,"operator":false,"role-agents":0}
JSON
export EXPEDITE_PROBE_FILE="$PROBE_STOPPED"
RP="$(mkfix tp --paused BL-1023)"
OUTP="$(run "$RP" BL-1023 --no-restart)"; EXITP=$?
check "BL-1023a: paused run ticket still exits 0 when stages pass" "$EXITP" "0"
check "BL-1023a: and lands in done/ (adopted then closed)" "$(ls "$RP/backlog/done/" | tr -d '\n')" "BL-1023-fixture.yaml"
check "BL-1023a: paused/ is empty afterwards" "$(ls "$RP/backlog/paused/" | wc -l | tr -d ' ')" "0"
contains "BL-1023a: initiation names the adopt from paused" "$OUTP" "ADOPT run ticket BL-1023 from backlog/paused/"

RH="$(mkfix th --hold BL-1023 --active BL-590)"
OUTH="$(run "$RH" BL-1023 --no-restart)"; EXITH=$?
check "BL-1023b: hold run ticket exits 0" "$EXITH" "0"
check "BL-1023b: lands in done/" "$(ls "$RH/backlog/done/" | tr -d '\n')" "BL-1023-fixture.yaml"
check "BL-1023b: sibling still parked to hold/" "$(ls "$RH/backlog/hold/" | tr -d '\n')" "BL-590-fixture.yaml"
contains "BL-1023b: park record names the sibling" "$(cat "$RH/.swarmforge/expedite/BL-1023/park-record.json")" "BL-590"

RD="$(mkfix td --paused BL-1023)"
OUTD23="$(run "$RD" BL-1023 --no-restart --dry-run)" || true
check "BL-1023c: dry-run leaves ticket in paused/" "$(ls "$RD/backlog/paused/" | tr -d '\n')" "BL-1023-fixture.yaml"
check "BL-1023c: dry-run writes nothing to done/" "$(ls "$RD/backlog/done/" | wc -l | tr -d ' ')" "0"
check "BL-1023c: dry-run writes nothing to active/" "$(ls "$RD/backlog/active/" | wc -l | tr -d ' ')" "0"
contains "BL-1023c: dry-run still decides adopt from paused" "$OUTD23" "ADOPT run ticket BL-1023 from backlog/paused/"

RM="$(mkfix tm --active BL-590)"
OUTM="$(run "$RM" BL-1023 --no-restart)"; EXITM=$?
check "BL-1023d: missing run ticket refuses" "$EXITM" "1"
contains "BL-1023d: refusal names the ticket" "$OUTM" "REFUSE run ticket BL-1023"
check "BL-1023d: no stage ran" "$([[ -f "$RM/.swarmforge/expedite-fixture/ran.log" ]] && echo yes || echo no)" "no"
check "BL-1023d: sibling stays in active/ (nothing parked before refuse)" \
  "$(ls "$RM/backlog/active/" | tr -d '\n')" "BL-590-fixture.yaml"
unset EXPEDITE_PROBE_FILE

# ── no-verdict recovery: first cleaner exit writes no verdict, second does ──
# Mirrors BL-1248: claude -p exited 0 after a Monitor wait with no verdict.json.
echo "no-verdict recovery"
RNV="$(mkfix tnv --active BL-567)"
cat > "$RNV/stage-runner-no-verdict-once.sh" <<'SH'
#!/usr/bin/env bash
# argv: <role> <ticket> <prompt-file> <verdict-file> <transcript>
set -euo pipefail
ROLE="$1"; TICKET="$2"; PROMPT="$3"; VERDICT="$4"; TRANSCRIPT="$5"
ROOT="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$ROOT/.swarmforge/expedite-fixture"
echo "$ROLE" >> "$ROOT/.swarmforge/expedite-fixture/ran.log"
ATTEMPTS="$ROOT/.swarmforge/expedite-fixture/${ROLE}.attempts"
n=0
[[ -f "$ATTEMPTS" ]] && n="$(cat "$ATTEMPTS")"
n=$((n + 1))
echo "$n" > "$ATTEMPTS"
echo "stage $ROLE attempt $n for $TICKET" > "$TRANSCRIPT"
# First cleaner call: exit 0, no verdict (the Monitor-wait failure class).
if [[ "$ROLE" == "cleaner" && "$n" -eq 1 ]]; then
  echo "waiting on Monitor; will finalize later" > "$TRANSCRIPT"
  exit 0
fi
DIRECTIVE="$ROOT/.swarmforge/expedite-fixture/$ROLE.verdict"
if [[ -f "$DIRECTIVE" ]]; then
  cat "$DIRECTIVE" > "$VERDICT"
else
  echo '{"verdict":"pass"}' > "$VERDICT"
fi
SH
chmod +x "$RNV/stage-runner-no-verdict-once.sh"
OUTNV="$(EXPEDITE_STAGE_RUNNER="$RNV/stage-runner-no-verdict-once.sh" \
         EXPEDITE_STOP_CMD=./stop-swarm.sh EXPEDITE_START_CMD=./start-swarm.sh \
         bb "$CLI" "$RNV" BL-567 --no-restart 2>&1)"; EXITNV=$?
check "no-verdict: recovery run exits 0" "$EXITNV" "0"
check "no-verdict: ticket reaches done/" "$(ls "$RNV/backlog/done/" | tr -d '\n')" "BL-567-fixture.yaml"
check "no-verdict: cleaner invoked twice (miss then recover)" \
  "$(grep -c '^cleaner$' "$RNV/.swarmforge/expedite-fixture/ran.log")" "2"
contains "no-verdict: driver logs the recovery" "$OUTNV" "no-verdict recovery"

# Permanent miss: every cleaner attempt writes nothing.
# After recovery, miss becomes a same-stage bounce (not an immediate ticket fail).
# Default bounce bound 3 => 4 stage entries × (recover + bounce attempt) = 8 cleaner runs,
# then bounce-bound-exhausted.
RNV2="$(mkfix tnv2 --active BL-567)"
cat > "$RNV2/stage-runner-never-verdict.sh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
ROLE="$1"; TICKET="$2"; PROMPT="$3"; VERDICT="$4"; TRANSCRIPT="$5"
ROOT="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$ROOT/.swarmforge/expedite-fixture"
echo "$ROLE" >> "$ROOT/.swarmforge/expedite-fixture/ran.log"
echo "stage $ROLE for $TICKET - no verdict" > "$TRANSCRIPT"
# Only cleaner withholds; earlier stages must pass so we reach cleaner.
if [[ "$ROLE" != "cleaner" ]]; then
  echo '{"verdict":"pass"}' > "$VERDICT"
fi
exit 0
SH
chmod +x "$RNV2/stage-runner-never-verdict.sh"
OUTNV2="$(EXPEDITE_STAGE_RUNNER="$RNV2/stage-runner-never-verdict.sh" \
          EXPEDITE_STOP_CMD=./stop-swarm.sh EXPEDITE_START_CMD=./start-swarm.sh \
          bb "$CLI" "$RNV2" BL-567 --no-restart 2>&1)"; EXITNV2=$?
check "no-verdict permanent: exits non-zero" "$EXITNV2" "1"
contains "no-verdict permanent: recovers at least once" "$OUTNV2" "no-verdict recovery"
contains "no-verdict permanent: bounces rather than hard-failing the first double-miss" "$OUTNV2" "bounce cleaner"
contains "no-verdict permanent: eventually exhausts the bounce bound" "$OUTNV2" "EXHAUSTED"
check "no-verdict permanent: cleaner re-entered via bounce bound (8 invokes)" \
  "$(grep -c '^cleaner$' "$RNV2/.swarmforge/expedite-fixture/ran.log")" "8"
check "no-verdict permanent: ticket not done" \
  "$(ls "$RNV2/backlog/done/" | wc -l | tr -d ' ')" "0"

# ── report ─────────────────────────────────────────────────────────────────
echo
if [[ "$fails" -eq 0 ]]; then
  echo "test_expedite_cli: ALL PASS"
else
  echo "test_expedite_cli: $fails FAILURE(S)"
  exit 1
fi
