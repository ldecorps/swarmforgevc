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
  mkdir -p "$ROOT/inbox/new" "$ROOT/inbox/in_process"
}

set_mtime() {
  # $1 = file, $2 = epoch seconds
  python3 -c "import os,sys; os.utime(sys.argv[1], (int(sys.argv[2]), int(sys.argv[2])))" "$1" "$2"
}

write_handoff() {
  local path="$1"
  printf 'id: t\nfrom: specifier\nto: coder\npriority: 50\ntype: note\nmessage: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n' > "$path"
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

grep -q "^respawn coder$" "$ROOT/calls.log" || fail "02: exhausted item with unresponsive liveness was not respawned"
pass "02: an exhausted item with unresponsive (unknown) liveness is respawned"

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

# ── 06: in_process work stuck across maxChases nudges escalates to alert, never nudges again ─
make_fixture
write_handoff "$ROOT/inbox/in_process/00_item.handoff"
python3 -c "import json; json.dump({'nudgeCount': 3}, open('$ROOT/inbox/in_process/00_item.handoff.nudge','w'))"
run_sweep "alive" $(( NOW_MS - (STUCK_TIMEOUT_S + 100) * 1000 ))

grep -q "wake-up" "$ROOT/calls.log" && fail "06: an alert-exhausted in_process item must not be nudged again"
grep -q "^escalation coder true$" "$ROOT/calls.log" || fail "06: exhausted in_process work did not escalate"
pass "06: in_process work exhausted across maxChases nudges escalates (no further nudge)"

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

echo "ALL PASS"
