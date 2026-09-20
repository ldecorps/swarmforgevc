#!/usr/bin/env bash
# BL-146: chase/nudge sweep decision logic, ported from
# extension/src/swarm/inboxChaser.ts into chase_sweep_lib.bb so the SAME
# babashka process that already owns handoff delivery also owns this duty.
# Exercised here through chase_sweep_test_runner.bb with an explicit fake
# now-ms and fake adapters (no live tmux, no real timers) - the sidecar
# files (.chase.json, .nudge) and the fake adapters' call log are the
# observable state asserted on.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNER="$SCRIPT_DIR/chase_sweep_test_runner.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

make_fixture() {
  ROOT="$(mktemp -d)"
  # BL-499: completed/ and abandoned/ - the terminal-basename dirs the
  # reap check reads (chase_sweep_test_runner.bb wires them alongside
  # new/in_process for every scenario, including the pre-existing ones
  # above that never touch them - reading an empty completed/abandoned/
  # is indistinguishable from a role whose mailbox never created them).
  mkdir -p "$ROOT/inbox/new" "$ROOT/inbox/in_process" "$ROOT/inbox/completed" "$ROOT/inbox/abandoned"
}

set_mtime() {
  # $1 = file, $2 = epoch seconds
  python3 -c "import os,sys; os.utime(sys.argv[1], (int(sys.argv[2]), int(sys.argv[2])))" "$1" "$2"
}

write_handoff() {
  local path="$1"
  printf 'id: t\nfrom: specifier\nto: coder\npriority: 50\ntype: note\nmessage: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n' > "$path"
}

write_deferred_note() {
  # BL-1494: a note carrying wake: defer, otherwise identical to write_handoff.
  local path="$1"
  printf 'id: t\nfrom: coordinator\nto: coder\npriority: 10\ntype: note\nmessage: hi\nwake: defer\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n' > "$path"
}

trap 'rm -rf "${ROOT:-}"' EXIT

NOW_MS=$((1751500000 * 1000))
CHASE_TIMEOUT_S=30
STUCK_TIMEOUT_S=60
MAX_CHASES=3

run_sweep() {
  CHASE_TIMEOUT_SECONDS="$CHASE_TIMEOUT_S" STUCK_TIMEOUT_SECONDS="$STUCK_TIMEOUT_S" MAX_CHASES="$MAX_CHASES" \
    bb "$RUNNER" "$ROOT" "$NOW_MS" "$1" "$2"
}

# ── 01: a stale item (no recent activity, liveness alive, under maxChases) is chased ─
make_fixture
write_handoff "$ROOT/inbox/new/00_item.handoff"
set_mtime "$ROOT/inbox/new/00_item.handoff" $(( (NOW_MS / 1000) - CHASE_TIMEOUT_S - 5 ))
# no recent activity: lastActivityMs far in the past
run_sweep "alive" $(( NOW_MS - (STUCK_TIMEOUT_S + 100) * 1000 ))

grep -q "^wake-up coder$" "$ROOT/calls.log" || fail "01: stale item under maxChases was not chased (no wake-up)"
CHASE_COUNT="$(python3 -c "import json; print(json.load(open('$ROOT/inbox/new/00_item.handoff.chase.json'))['chaseCount'])")"
[[ "$CHASE_COUNT" == "1" ]] || fail "01: chaseCount not incremented to 1 (got $CHASE_COUNT)"
pass "01: a stale item under maxChases is chased and its chaseCount incremented"

# BL-098 telemetry-01: one chase event line, count matching the incremented sidecar.
grep -q "^telemetry chase coder 00_item.handoff 1$" "$ROOT/calls.log" \
  || fail "01: expected a BL-098 chase telemetry event; got: $(cat "$ROOT/calls.log")"
pass "01 (BL-098 telemetry-01): a chase decision emits one telemetry event"

# ── 02: an exhausted item (chaseCount >= maxChases) with unresponsive liveness is respawned ─
make_fixture
write_handoff "$ROOT/inbox/new/00_item.handoff"
set_mtime "$ROOT/inbox/new/00_item.handoff" $(( (NOW_MS / 1000) - CHASE_TIMEOUT_S - 5 ))
python3 -c "import json; json.dump({'chaseCount': 3}, open('$ROOT/inbox/new/00_item.handoff.chase.json','w'))"
run_sweep "unknown" $(( NOW_MS - (STUCK_TIMEOUT_S + 100) * 1000 ))

grep -q "^respawn coder item=00_item.handoff" "$ROOT/calls.log" || fail "02: exhausted item with unresponsive liveness was not respawned"
pass "02: an exhausted item with unresponsive (unknown) liveness is respawned"

# BL-1652: the respawn call carries the readings it was decided on.
grep -qE "^respawn coder item=00_item\.handoff liveness=unknown heartbeat-age-s= activity-age-s=[0-9.]+ busy=false lane=false$" \
  "$ROOT/calls.log" || fail "02 (BL-1652): respawn call is missing/wrong readings; got: $(cat "$ROOT/calls.log")"
pass "02 (BL-1652): a respawn call names liveness, heartbeat age, activity age, busy and lane"

# BL-098: a respawn decision also emits a telemetry event.
grep -q "^telemetry respawn coder 00_item.handoff 3$" "$ROOT/calls.log" \
  || fail "02: expected a BL-098 respawn telemetry event; got: $(cat "$ROOT/calls.log")"
pass "02 (BL-098): a respawn decision emits one telemetry event"

# ── 03: an exhausted item with ALIVE liveness is dead-lettered, never respawned ─
make_fixture
write_handoff "$ROOT/inbox/new/00_item.handoff"
set_mtime "$ROOT/inbox/new/00_item.handoff" $(( (NOW_MS / 1000) - CHASE_TIMEOUT_S - 5 ))
python3 -c "import json; json.dump({'chaseCount': 3}, open('$ROOT/inbox/new/00_item.handoff.chase.json','w'))"
run_sweep "alive" $(( NOW_MS - (STUCK_TIMEOUT_S + 100) * 1000 ))

grep -q "respawn" "$ROOT/calls.log" && fail "03: an exhausted item with alive liveness must never be respawned"
grep -q "^dead-letter coder 00_item.handoff$" "$ROOT/calls.log" || fail "03: exhausted alive-liveness item was not dead-lettered"
[[ -f "$ROOT/inbox/new/00_item.handoff.dead" ]] || fail "03: item file was not renamed to .dead"
pass "03: an exhausted item with alive liveness is dead-lettered, never respawned"

# BL-098: a dead-letter decision also emits a telemetry event (count = the
# chase-count already on the sidecar, i.e. 3 from the fixture above).
grep -q "^telemetry dead-letter coder 00_item.handoff 3$" "$ROOT/calls.log" \
  || fail "03: expected a BL-098 dead-letter telemetry event; got: $(cat "$ROOT/calls.log")"
pass "03 (BL-098): a dead-letter decision emits one telemetry event"

# ── 04: an item younger than chaseTimeoutSeconds is skipped entirely ────────
make_fixture
write_handoff "$ROOT/inbox/new/00_item.handoff"
set_mtime "$ROOT/inbox/new/00_item.handoff" $(( NOW_MS / 1000 ))
run_sweep "alive" $(( NOW_MS - (STUCK_TIMEOUT_S + 100) * 1000 ))

grep -qE "^(wake-up|respawn|dead-letter)" "$ROOT/calls.log" 2>/dev/null && fail "04: a fresh item (younger than chaseTimeoutSeconds) must not be touched"
[[ -f "$ROOT/inbox/new/00_item.handoff.chase.json" ]] && fail "04: a fresh item must not have its chase sidecar written"
pass "04: a fresh item younger than chaseTimeoutSeconds is left alone"

# ── 05: in_process work with no activity for stuckInProcessTimeoutSeconds is nudged ─
make_fixture
write_handoff "$ROOT/inbox/in_process/00_item.handoff"
run_sweep "alive" $(( NOW_MS - (STUCK_TIMEOUT_S + 100) * 1000 ))

grep -q "^wake-up coder$" "$ROOT/calls.log" || fail "05: a stuck in_process item was not nudged"
NUDGE_COUNT="$(python3 -c "import json; print(json.load(open('$ROOT/inbox/in_process/00_item.handoff.nudge'))['nudgeCount'])")"
[[ "$NUDGE_COUNT" == "1" ]] || fail "05: nudgeCount not incremented (got $NUDGE_COUNT)"
pass "05: a stuck in_process item is nudged and its nudgeCount incremented"

# BL-098 telemetry-02: one nudge event line, count matching the incremented sidecar.
grep -q "^telemetry nudge coder 00_item.handoff 1$" "$ROOT/calls.log" \
  || fail "05: expected a BL-098 nudge telemetry event; got: $(cat "$ROOT/calls.log")"
pass "05 (BL-098 telemetry-02): a nudge decision emits one telemetry event"

# 2026-07-19 flood: nudge cleared on-stuck-escalation!(false), re-arming the
# stuck email on the next alert. Nudge is still inside the stuck episode.
grep -q "^escalation coder false$" "$ROOT/calls.log" \
  && fail "05b: a stuck nudge must NOT clear the escalation edge (got: $(cat "$ROOT/calls.log"))"
pass "05b: a stuck nudge does not clear on-stuck-escalation! (no email re-arm)"

# ── 06: in_process work stuck across maxChases nudges escalates AND keeps waking ─
# 2026-08-03: mono-router dormant holders starved forever once alert armed and
# wakes stopped. Escalation must still fire; resume attempts must continue.
make_fixture
write_handoff "$ROOT/inbox/in_process/00_item.handoff"
python3 -c "import json; json.dump({'nudgeCount': 3}, open('$ROOT/inbox/in_process/00_item.handoff.nudge','w'))"
run_sweep "alive" $(( NOW_MS - (STUCK_TIMEOUT_S + 100) * 1000 ))

grep -q "^escalation coder true$" "$ROOT/calls.log" || fail "06: exhausted in_process work did not escalate"
grep -q "^wake-up coder$" "$ROOT/calls.log" || fail "06: alert must keep attempting resume (got: $(cat "$ROOT/calls.log"))"
NUDGE_AFTER="$(python3 -c "import json; print(json.load(open('$ROOT/inbox/in_process/00_item.handoff.nudge'))['nudgeCount'])")"
[[ "$NUDGE_AFTER" == "4" ]] || fail "06: expected nudgeCount to advance on post-alert resume (got $NUDGE_AFTER)"
pass "06: in_process work exhausted across maxChases escalates and keeps waking"

# ── 07: an item with recent activity is chased once, then backed off (not re-chased immediately) ─
make_fixture
write_handoff "$ROOT/inbox/new/00_item.handoff"
set_mtime "$ROOT/inbox/new/00_item.handoff" $(( (NOW_MS / 1000) - CHASE_TIMEOUT_S - 5 ))
python3 -c "import json; json.dump({'chaseCount': 1, 'lastChasedAtMs': $NOW_MS - 5000}, open('$ROOT/inbox/new/00_item.handoff.chase.json','w'))"
# recent activity: lastActivityMs just now
run_sweep "alive" "$NOW_MS"

grep -qE "^(wake-up|respawn|dead-letter)" "$ROOT/calls.log" 2>/dev/null && fail "07: a just-chased, still-busy item must be backed off, not re-chased immediately"
pass "07: a recently-chased item with recent activity is backed off (skipped), not hammered"

# ── BL-209 suppress-wake-02: an active rate-limit cooldown suppresses the
#     whole sweep for that role, even for an otherwise-stale item ──────────
make_fixture
write_handoff "$ROOT/inbox/new/00_item.handoff"
set_mtime "$ROOT/inbox/new/00_item.handoff" $(( (NOW_MS / 1000) - CHASE_TIMEOUT_S - 5 ))
echo "{\"coder\":{\"untilMs\":$(( NOW_MS + 60000 ))}}" > "$ROOT/rate-limit-cooldown.json"
run_sweep "unknown" $(( NOW_MS - (STUCK_TIMEOUT_S + 100) * 1000 ))

[[ ! -s "$ROOT/calls.log" ]] || fail "08: expected no wake-up/respawn/chase/telemetry calls at all while cooling down; got: $(cat "$ROOT/calls.log")"
[[ ! -f "$ROOT/inbox/new/00_item.handoff.chase.json" ]] || fail "08: expected the stale item's chase sidecar to be untouched while cooling down"
pass "08 (BL-209 suppress-wake-02): an active rate-limit cooldown suppresses the whole sweep, even for a stale item"

# ── BL-209 resume-at-reset-03: once the reset time passes, the role is
#     woken exactly once, its cooldown marked woken (not re-triggered next
#     sweep), and normal sweep processing resumes the same cycle ──────────
make_fixture
write_handoff "$ROOT/inbox/new/00_item.handoff"
set_mtime "$ROOT/inbox/new/00_item.handoff" $(( (NOW_MS / 1000) - CHASE_TIMEOUT_S - 5 ))
echo "{\"coder\":{\"untilMs\":$(( NOW_MS - 1000 ))}}" > "$ROOT/rate-limit-cooldown.json"
run_sweep "unknown" $(( NOW_MS - (STUCK_TIMEOUT_S + 100) * 1000 ))

grep -q "^wake-up coder$" "$ROOT/calls.log" || fail "09: expected the expired cooldown to wake the role once; got: $(cat "$ROOT/calls.log")"
[[ -f "$ROOT/inbox/new/00_item.handoff.chase.json" ]] \
  || fail "09: expected normal sweep processing (the stale item chased) to resume the same cycle"
WOKEN_MARKER="$(python3 -c "import json; print(json.load(open('$ROOT/rate-limit-cooldown.json'))['coder'].get('wokenForUntilMs'))")"
[[ "$WOKEN_MARKER" == "$(( NOW_MS - 1000 ))" ]] || fail "09: expected wokenForUntilMs recorded on the shared cooldown file, got: $WOKEN_MARKER"
pass "09 (BL-209 resume-at-reset-03): an expired cooldown wakes the role once, marks it woken, and resumes normal sweep processing"

# A second sweep against an already-woken cooldown (same until-ms) must not
# wake again - proves the gate is a one-shot wake, not a per-cycle repeat
# while the marker still matches. Uses its own empty-inbox fixture so the
# only possible "wake-up" call in the log can be the rate-limit path, never
# an ordinary stale-item chase (which logs the identical "wake-up coder"
# line and would make this assertion ambiguous against a busy inbox).
make_fixture
echo "{\"coder\":{\"untilMs\":$(( NOW_MS - 1000 )),\"wokenForUntilMs\":$(( NOW_MS - 1000 ))}}" > "$ROOT/rate-limit-cooldown.json"
run_sweep "unknown" $(( NOW_MS - (STUCK_TIMEOUT_S + 100) * 1000 ))
grep -q "^wake-up coder$" "$ROOT/calls.log" 2>/dev/null && fail "09b: expected no SECOND wake-up for the same already-woken cooldown; got: $(cat "$ROOT/calls.log" 2>/dev/null)"
pass "09b (BL-209 resume-at-reset-03): an already-woken cooldown (same until-ms) does not re-wake"

# ── BL-499 chase-sweep-terminal-dup-01a: an already-completed handoff lingering
#     in new/, recipient ACTIVE, is reaped - never chased ─────────────────────
make_fixture
write_handoff "$ROOT/inbox/completed/00_item.handoff"
write_handoff "$ROOT/inbox/new/00_item.handoff"
set_mtime "$ROOT/inbox/new/00_item.handoff" $(( (NOW_MS / 1000) - CHASE_TIMEOUT_S - 5 ))
# recent activity: lastActivityMs just now
run_sweep "alive" "$NOW_MS"

grep -q "wake-up" "$ROOT/calls.log" 2>/dev/null && fail "10a: expected NO wake-up for a duplicate already terminal in completed/"
[[ -f "$ROOT/inbox/new/00_item.handoff.chase.json" ]] && fail "10a: expected chaseCount NOT incremented (no sidecar written at all) for a reaped duplicate"
[[ -f "$ROOT/inbox/new/00_item.handoff" ]] && fail "10a: expected the stale duplicate reaped (removed) from new/, never left to be dequeued"
pass "10a (BL-499 chase-sweep-terminal-dup-01, completed): an already-terminal duplicate is reaped, not chased"

grep -q "^telemetry already-processed coder 00_item.handoff " "$ROOT/calls.log" \
  || fail "10a: expected an auditable already-processed telemetry event; got: $(cat "$ROOT/calls.log")"
pass "10a (BL-499 chase-sweep-terminal-dup-01, completed): the reap is recorded as an auditable already-processed line"

# ── BL-499 chase-sweep-terminal-dup-01b: same, but the duplicate's id is
#     terminal in abandoned/ instead of completed/ ──────────────────────────
make_fixture
write_handoff "$ROOT/inbox/abandoned/00_item.handoff"
write_handoff "$ROOT/inbox/new/00_item.handoff"
set_mtime "$ROOT/inbox/new/00_item.handoff" $(( (NOW_MS / 1000) - CHASE_TIMEOUT_S - 5 ))
run_sweep "alive" "$NOW_MS"

grep -q "wake-up" "$ROOT/calls.log" 2>/dev/null && fail "10b: expected NO wake-up for a duplicate already terminal in abandoned/"
[[ -f "$ROOT/inbox/new/00_item.handoff" ]] && fail "10b: expected the stale duplicate reaped from new/"
grep -q "^telemetry already-processed coder 00_item.handoff " "$ROOT/calls.log" \
  || fail "10b: expected an auditable already-processed telemetry event; got: $(cat "$ROOT/calls.log")"
pass "10b (BL-499 chase-sweep-terminal-dup-01, abandoned): an already-terminal duplicate is reaped, not chased, either terminal directory"

# ── BL-499 chase-sweep-terminal-dup-02: an IDLE recipient reaps a terminal
#     duplicate instead of raising a false dead-letter ─────────────────────
make_fixture
write_handoff "$ROOT/inbox/completed/00_item.handoff"
write_handoff "$ROOT/inbox/new/00_item.handoff"
set_mtime "$ROOT/inbox/new/00_item.handoff" $(( (NOW_MS / 1000) - CHASE_TIMEOUT_S - 5 ))
python3 -c "import json; json.dump({'chaseCount': 3}, open('$ROOT/inbox/new/00_item.handoff.chase.json','w'))"
# idle: no recent activity at all
run_sweep "alive" $(( NOW_MS - (STUCK_TIMEOUT_S + 100) * 1000 ))

grep -q "dead-letter" "$ROOT/calls.log" 2>/dev/null && fail "11: expected NO dead-letter for a terminal duplicate, even from an idle recipient at the chase-count cap"
[[ -f "$ROOT/inbox/new/00_item.handoff.dead" ]] && fail "11: expected no .dead file created for a reaped duplicate"
[[ -f "$ROOT/inbox/new/00_item.handoff" ]] && fail "11: expected the stale duplicate reaped from new/"
pass "11 (BL-499 chase-sweep-terminal-dup-02): an idle role reaps a terminal duplicate rather than raising a false dead-letter"

# ── BL-499 chase-sweep-terminal-dup-03: a GENUINELY stuck handoff (id in
#     neither completed/ nor abandoned/) to an active role is still chased,
#     exactly as before - regression guard ─────────────────────────────────
make_fixture
write_handoff "$ROOT/inbox/new/00_item.handoff"
set_mtime "$ROOT/inbox/new/00_item.handoff" $(( (NOW_MS / 1000) - CHASE_TIMEOUT_S - 5 ))
run_sweep "alive" $(( NOW_MS - (STUCK_TIMEOUT_S + 100) * 1000 ))

grep -q "^wake-up coder$" "$ROOT/calls.log" || fail "12: expected a genuinely stuck (not terminal anywhere) item still chased"
CHASE_COUNT="$(python3 -c "import json; print(json.load(open('$ROOT/inbox/new/00_item.handoff.chase.json'))['chaseCount'])")"
[[ "$CHASE_COUNT" == "1" ]] || fail "12: expected chaseCount incremented to 1 for a genuinely stuck item (got $CHASE_COUNT)"
pass "12 (BL-499 chase-sweep-terminal-dup-03): a genuinely stuck handoff to an active role is still chased, unchanged"

# ── BL-499 chase-sweep-terminal-dup-04: reaping a terminal duplicate leaves
#     no orphaned .chase.json sidecar behind ───────────────────────────────
make_fixture
write_handoff "$ROOT/inbox/completed/00_item.handoff"
write_handoff "$ROOT/inbox/new/00_item.handoff"
set_mtime "$ROOT/inbox/new/00_item.handoff" $(( (NOW_MS / 1000) - CHASE_TIMEOUT_S - 5 ))
python3 -c "import json; json.dump({'chaseCount': 2, 'lastChasedAtMs': $NOW_MS - 999999}, open('$ROOT/inbox/new/00_item.handoff.chase.json','w'))"
run_sweep "alive" "$NOW_MS"

[[ -f "$ROOT/inbox/new/00_item.handoff" ]] && fail "13: expected the stale duplicate reaped from new/"
[[ -f "$ROOT/inbox/new/00_item.handoff.chase.json" ]] && fail "13: expected no orphaned .chase.json sidecar left behind after the reap"
pass "13 (BL-499 chase-sweep-terminal-dup-04): reaping a terminal duplicate leaves no orphaned chase sidecar behind"

# ── 14: a skipped wake (busy/deferred adapter) does not bump chaseCount or telemetry ─
make_fixture
write_handoff "$ROOT/inbox/new/00_item.handoff"
set_mtime "$ROOT/inbox/new/00_item.handoff" $(( (NOW_MS / 1000) - CHASE_TIMEOUT_S - 5 ))
CHASE_WAKE_SKIP=1 run_sweep "alive" $(( NOW_MS - (STUCK_TIMEOUT_S + 100) * 1000 ))

grep -qE "^(wake-up|telemetry chase)" "$ROOT/calls.log" 2>/dev/null && fail "14: skipped wake must not log wake-up or chase telemetry; got: $(cat "$ROOT/calls.log")"
[[ -f "$ROOT/inbox/new/00_item.handoff.chase.json" ]] && fail "14: skipped wake must not write chase sidecar"
pass "14: a deferred/skipped chase wake does not increment chaseCount or emit telemetry"

# ── BL-1004 deferral-hold (architect bounce 2026-08-21): a stage-queue
#    rework a SIBLING seat worked, still inside cross_seat_claim_deadline_ms
#    (age via its enqueued_at header, never mtime), is deliberately waiting
#    for that seat - the chase sweep must treat it like an ambulance hold,
#    not a stale item ──────────────────────────────────────────────────────

setup_two_seats() {
  # roles.tsv at the fixture target-root (the harness pins target-root to
  # $ROOT): the stage row `coder` plus sibling seat `coder@b`, each with its
  # own worktree dir inside the fixture.
  mkdir -p "$ROOT/.swarmforge" "$ROOT/wt-b/.swarmforge/handoffs/inbox/completed"
  printf 'coder\tcoder\t%s\tswarm\tCoder\tclaude\ttask\ncoder@b\tcoder-b\t%s\tswarm\tCoderB\tclaude\ttask\n' \
    "$ROOT/wt-coder" "$ROOT/wt-b" > "$ROOT/.swarmforge/roles.tsv"
}

write_rework_handoff() {
  # $1 = path, $2 = task, $3 = enqueued_at (ISO instant)
  printf 'id: rework\nfrom: hardender\nto: coder\npriority: 00\ntype: git_handoff\ntask: %s\ncommit: 0123456789\nenqueued_at: %s\n\n' \
    "$2" "$3" > "$1"
}

write_sibling_worked_record() {
  # $1 = task: seat coder@b's durable record of having worked it
  printf 'id: done\nfrom: hardender\nto: coder\ntype: git_handoff\ntask: %s\n\n' \
    "$1" > "$ROOT/wt-b/.swarmforge/handoffs/inbox/completed/done.handoff"
}

# 16 minutes of header age - past every chase threshold, inside the default
# 30-minute cross-seat deadline (the bounce's own false-alert window).
ENQUEUED_ISO="$(python3 -c "import datetime,sys;print(datetime.datetime.utcfromtimestamp(int(sys.argv[1])).strftime('%Y-%m-%dT%H:%M:%SZ'))" $(( NOW_MS / 1000 - 960 )))"

# ── 15: the deferred rework is HELD - no chase, no sidecar ───────────────
make_fixture
setup_two_seats
write_sibling_worked_record "BL-777"
write_rework_handoff "$ROOT/inbox/new/00_rework.handoff" "BL-777" "$ENQUEUED_ISO"
set_mtime "$ROOT/inbox/new/00_rework.handoff" $(( (NOW_MS / 1000) - CHASE_TIMEOUT_S - 5 ))
run_sweep "alive" $(( NOW_MS - (STUCK_TIMEOUT_S + 100) * 1000 ))

grep -q "^wake-up coder$" "$ROOT/calls.log" 2>/dev/null && fail "15: a rework inside its designed cross-seat deferral window must not be chased; got: $(cat "$ROOT/calls.log")"
[[ -f "$ROOT/inbox/new/00_rework.handoff.chase.json" ]] && fail "15: a held rework must not accrue a chase sidecar"
[[ -f "$ROOT/inbox/new/00_rework.handoff" ]] || fail "15: the held rework must stay untouched in new/"
pass "15 (BL-1004): a sibling-worked rework inside the deferral window is held, not chased"

# ── 16: same parcel, but NO seat worked the task - a real stall, chased ──
make_fixture
setup_two_seats
write_sibling_worked_record "BL-888"
write_rework_handoff "$ROOT/inbox/new/00_rework.handoff" "BL-777" "$ENQUEUED_ISO"
set_mtime "$ROOT/inbox/new/00_rework.handoff" $(( (NOW_MS / 1000) - CHASE_TIMEOUT_S - 5 ))
run_sweep "alive" $(( NOW_MS - (STUCK_TIMEOUT_S + 100) * 1000 ))

grep -q "^wake-up coder$" "$ROOT/calls.log" || fail "16: a task no seat worked is a real stall and must still be chased"
pass "16 (BL-1004): the hold is not a blanket mute - an unworked task's parcel is still chased"

# ── 17: a deferred note (wake: defer) past the chase threshold is HELD -
#         no chase, no sidecar, same treatment as an ambulance/deferral
#         hold (BL-1494 acceptance scenario 03) ─────────────────────────────
make_fixture
write_deferred_note "$ROOT/inbox/new/00_deferred.handoff"
set_mtime "$ROOT/inbox/new/00_deferred.handoff" $(( (NOW_MS / 1000) - CHASE_TIMEOUT_S - 5 ))
run_sweep "alive" $(( NOW_MS - (STUCK_TIMEOUT_S + 100) * 1000 ))

grep -q "^wake-up coder$" "$ROOT/calls.log" 2>/dev/null && fail "17: a deferred note past the chase threshold must not be chased (zero injections)"
[[ -f "$ROOT/inbox/new/00_deferred.handoff.chase.json" ]] && fail "17: a deferred note must not accrue a chase sidecar"
[[ -f "$ROOT/inbox/new/00_deferred.handoff" ]] || fail "17: the deferred note must stay untouched in new/"
pass "17 (BL-1494): a deferred note past the chase threshold is held, not chased - zero injections"

# ── BL-1652: an exhausted, unresponsive-liveness item is never respawned
#    while the pane shows the busy footer or a verification lane is running
#    under the role's worktree - it is chased (or backed off) instead, and
#    the case runs across liveness x busy x lane per the ticket's own
#    "every combination" instruction ─────────────────────────────────────

run_sweep_busy_lane() {
  # $1=liveness $2=pane-busy $3=lane-running
  CHASE_TIMEOUT_SECONDS="$CHASE_TIMEOUT_S" STUCK_TIMEOUT_SECONDS="$STUCK_TIMEOUT_S" MAX_CHASES="$MAX_CHASES" \
    CHASE_PANE_BUSY="$2" CHASE_LANE_RUNNING="$3" \
    bb "$RUNNER" "$ROOT" "$NOW_MS" "$1" $(( NOW_MS - (STUCK_TIMEOUT_S + 100) * 1000 ))
}

for combo in "dead 1 0" "unknown 0 1" "stuck 1 1"; do
  read -r LIVENESS BUSY LANE <<< "$combo"
  make_fixture
  write_handoff "$ROOT/inbox/new/00_item.handoff"
  set_mtime "$ROOT/inbox/new/00_item.handoff" $(( (NOW_MS / 1000) - CHASE_TIMEOUT_S - 5 ))
  python3 -c "import json; json.dump({'chaseCount': 3}, open('$ROOT/inbox/new/00_item.handoff.chase.json','w'))"
  run_sweep_busy_lane "$LIVENESS" "$BUSY" "$LANE"

  grep -q "^respawn" "$ROOT/calls.log" 2>/dev/null \
    && fail "18 (BL-1652 liveness=$LIVENESS busy=$BUSY lane=$LANE): an exhausted item must never respawn while busy or a lane is running; got: $(cat "$ROOT/calls.log")"
  grep -q "^dead-letter" "$ROOT/calls.log" 2>/dev/null \
    && fail "18 (BL-1652 liveness=$LIVENESS busy=$BUSY lane=$LANE): must never dead-letter while busy or a lane is running; got: $(cat "$ROOT/calls.log")"
  pass "18 (BL-1652 liveness=$LIVENESS busy=$BUSY lane=$LANE): never respawned/dead-lettered while busy or a lane is running"
done

# ── 19: still-dead liveness with NEITHER busy nor a lane running is
#     respawned exactly as before (invariant 1's "never respawned" guard
#     does not silently swallow the still-genuinely-dead case) ────────────
make_fixture
write_handoff "$ROOT/inbox/new/00_item.handoff"
set_mtime "$ROOT/inbox/new/00_item.handoff" $(( (NOW_MS / 1000) - CHASE_TIMEOUT_S - 5 ))
python3 -c "import json; json.dump({'chaseCount': 3}, open('$ROOT/inbox/new/00_item.handoff.chase.json','w'))"
run_sweep_busy_lane "dead" 0 0

grep -q "^respawn coder item=00_item.handoff liveness=dead" "$ROOT/calls.log" \
  || fail "19 (BL-1652): a genuinely dead role with no busy pane and no lane running must still be respawned; got: $(cat "$ROOT/calls.log")"
pass "19 (BL-1652): a role with a truly dead pane and no running lane is still respawned exactly as today"

# ── 20 (BL-1652 invariant 2): one sweep respawns a role AT MOST ONCE,
#     however many of its inbox items have reached the chase ceiling -
#     five exhausted items, one respawn call, one respawn log line ───────
make_fixture
for i in 0 1 2 3 4; do
  ITEM="$ROOT/inbox/new/0${i}_item.handoff"
  write_handoff "$ITEM"
  set_mtime "$ITEM" $(( (NOW_MS / 1000) - CHASE_TIMEOUT_S - 5 - i ))
  python3 -c "import json; json.dump({'chaseCount': 3}, open('$ITEM.chase.json','w'))"
done
run_sweep_busy_lane "dead" 0 0

RESPAWN_CALLS="$(grep -c "^respawn " "$ROOT/calls.log" || true)"
[[ "$RESPAWN_CALLS" == "1" ]] || fail "20 (BL-1652 invariant 2): expected exactly 1 respawn call for 5 exhausted items in one sweep, got $RESPAWN_CALLS; log: $(cat "$ROOT/calls.log")"
TELEMETRY_RESPAWN_CALLS="$(grep -c "^telemetry respawn " "$ROOT/calls.log" || true)"
[[ "$TELEMETRY_RESPAWN_CALLS" == "1" ]] || fail "20 (BL-1652 invariant 2): expected exactly 1 respawn telemetry line for 5 exhausted items in one sweep, got $TELEMETRY_RESPAWN_CALLS"
pass "20 (BL-1652 invariant 2): one sweep respawns a role at most once however many items reached the chase ceiling, with one log line naming the readings"

echo "ALL PASS"
