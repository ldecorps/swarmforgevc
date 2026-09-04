#!/usr/bin/env bash
# BL-1393: ONE closing ceremony, on every sleep after at least one shift.
#
# Until 2026-09-04 there were two mechanisms with two triggers: BL-658's
# ceremony (freeze, drain, briefing, email, stop) ran only inside the daemon's
# overnight window, and BL-820's lean pass ran only when finish-shift was run
# and did none of the rest. A weekday 17:00 bedtime got the lean pass alone and
# the full ceremony never ran on a weekday at all. The human: "820 should be
# part of 658. the closing ceremony should happen each time the swarm does at
# least 1 shift and goes to sleep."
#
# Every check drives the REAL compiled CLI against a fixture root.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CLI="$REPO_ROOT/extension/out/tools/night-closing-ceremony-run.js"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

FIXTURE_PREFIX="sfvc-bl1393-e2e"
source "$SCRIPT_DIR/lib/fixture_isolation.sh"
fixture_isolation_begin "$FIXTURE_PREFIX" "${BL1393_SUITE_BOUND_SECONDS:-900}" "$@"
trap 'rm -rf "$WORK"' EXIT

if [[ ! -f "$CLI" ]]; then
  fail "the ceremony CLI is not compiled ($CLI) - run npm run compile from extension/"
  echo "FAILURES"; exit 1
fi

# A fixture swarm: its own conf, its own state dir, and a shift-start stamp.
# `--dry-run` is NOT used anywhere here: these checks are about what the
# sequence DOES, and a dry run does none of it.
make_root() {  # make_root <name> [--no-shift]
  root="$WORK/$1"; shift
  mkdir -p "$root/.swarmforge/daemon" "$root/.swarmforge/lean/ceremony" \
           "$root/.swarmforge/handoffs/inbox/new" "$root/swarmforge" "$root/docs/briefings"
  printf 'config closure_stop_local 06:00\n' > "$root/swarmforge/swarmforge.conf"
  # The CLI resolves its project root the way every tool here does: a git
  # worktree carrying .swarmforge/roles.tsv. A fixture without both dies at
  # startup and every check below would report the wrong thing.
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$root" \
    > "$root/.swarmforge/roles.tsv"
  git init -q -b main "$root" >/dev/null 2>&1
  git -C "$root" config user.email t@t >/dev/null 2>&1
  git -C "$root" config user.name t >/dev/null 2>&1
  git -C "$root" config commit.gpgsign false >/dev/null 2>&1
  ( cd "$root" && git add -A >/dev/null 2>&1 && git commit -qm seed >/dev/null 2>&1 )
  # A recorded ceremony from a previous shift, so "newer than the last
  # ceremony" is a real comparison rather than a vacuous one.
  printf '{"shiftKey":"2026-09-03","outcome":{"type":"no_change"}}\n' \
    > "$root/.swarmforge/lean/ceremony/2026-09-03.json"
  touch -d '2026-09-03 06:00' "$root/.swarmforge/lean/ceremony/2026-09-03.json" 2>/dev/null || true
  if [[ "${1:-}" == "--no-shift" ]]; then
    # A stamp OLDER than that ceremony: the swarm has not worked since.
    printf '2026-09-03T05:00:00Z\n' > "$root/.swarmforge/shift-started"
    touch -d '2026-09-03 05:00' "$root/.swarmforge/shift-started" 2>/dev/null || true
  else
    printf '2026-09-04T09:00:00Z\n' > "$root/.swarmforge/shift-started"
  fi
}

# The sequence the run reports, as one line.
run_ceremony() {  # run_ceremony <root> [extra args...]
  local r="$1"; shift
  ( cd "$r" && timeout 120 node "$CLI" --target "$r" --conf "$r/swarmforge/swarmforge.conf" "$@" 2>&1 )
}

# ── 1. a weekday bedtime runs the WHOLE sequence, lean pass included ─────
make_root bedtime
out="$(run_ceremony "$WORK/bedtime" --sleep-path finish-shift)"
seq1="$(run_ceremony "$WORK/bedtime" --sleep-path finish-shift)"
trail="$(printf '%s\n%s' "$out" "$seq1")"
if grep -q '"freeze-promotion"' <<<"$trail"; then
  pass "a bedtime freezes promotion first"
else
  fail "no freeze in the trail: $(tail -3 <<<"$trail")"
fi
if grep -q '"lean-packet"' <<<"$trail"; then
  pass "and the lean packet is a step of the same sequence"
else
  fail "the lean pass did not run as a step: $(tail -3 <<<"$trail")"
fi
lean_at="$(grep -o '"[a-z-]*"' <<<"$trail" | grep -n '"lean-packet"' | head -1 | cut -d: -f1)"
brief_at="$(grep -o '"[a-z-]*"' <<<"$trail" | grep -n '"rotate-documenter"\|"instruct-briefing"' | head -1 | cut -d: -f1)"
if [[ -n "$lean_at" && -n "$brief_at" ]] && (( lean_at < brief_at )); then
  pass "the packet is delivered before the briefing is instructed"
else
  fail "the lean step is not between the drain and the briefing (lean=$lean_at briefing=$brief_at)"
fi

# ── 2. the gate window no longer decides whether a SLEEP runs it ─────────
# The same fixture with no --sleep-path: the daemon's trigger is still gated,
# which is what keeps this ticket from changing the schedule.
make_root gated
out="$(run_ceremony "$WORK/gated" --now 1757000000000)"
if grep -q '"advanced": *false' <<<"$out" || grep -q '"gateMode": *"off"' <<<"$out"; then
  pass "without a sleep path the daemon's window still gates the ceremony"
else
  fail "the window no longer gates the daemon's trigger: $(tail -2 <<<"$out")"
fi

# ── 3. a sleep after NO shift of work is explicit and quiet ──────────────
make_root noshift --no-shift
out="$(run_ceremony "$WORK/noshift" --sleep-path finish-shift)"
if grep -q '"no-shift-since-last-ceremony"' <<<"$out"; then
  pass "a sleep with no shift of work records an explicit empty outcome"
else
  fail "no explicit empty outcome: $(tail -3 <<<"$out")"
fi
if ! grep -q '"instruct-briefing"' <<<"$out"; then
  pass "and instructs no briefing"
else
  fail "a briefing was instructed for a shift that never happened"
fi

# ── 4. a restart is not a sleep ──────────────────────────────────────────
# The restart paths must not invoke the ceremony at all: assert on the scripts
# themselves, since "it did not run" is what there is to observe.
restart_callers=""
for s in remote_bounce.sh kill_all_swarm.sh expedite.sh; do
  f="$REPO_ROOT/swarmforge/scripts/$s"
  [[ -f "$f" ]] || continue
  grep -q 'night-closing-ceremony-run\|closing-ceremony-run' "$f" && restart_callers+="$s "
done
if [[ -z "$restart_callers" ]]; then
  pass "no restart path invokes the ceremony (remote bounce, kill-all, expedite park)"
else
  fail "a restart path invokes the ceremony: $restart_callers"
fi

# ── 5. every sleep path drives the ONE sequence ──────────────────────────
if grep -q 'night-closing-ceremony-run.js' "$REPO_ROOT/swarmforge/scripts/finish_shift_lib.sh" \
   && grep -q -- '--sleep-path finish-shift' "$REPO_ROOT/swarmforge/scripts/finish_shift_lib.sh"; then
  pass "finish-shift drives the one sequence, declaring itself a sleep"
else
  fail "finish_shift_lib.sh does not drive the ceremony"
fi
if grep -q 'closing-ceremony-run.js' "$REPO_ROOT/swarmforge/scripts/finish_shift_lib.sh" \
   && ! grep -q 'night-closing-ceremony-run.js' "$REPO_ROOT/swarmforge/scripts/finish_shift_lib.sh"; then
  fail "the old lean-only CLI call is still there - dead logic re-shipped"
else
  pass "the direct lean-CLI call is gone, not re-shipped beside the sequence"
fi

# ── 6. the schedule is untouched ─────────────────────────────────────────
# The schedule IS: the crontab installer, continuous-shifts.json, the pack
# confs and swarmforge.conf. A file whose NAME merely contains "schedule" -
# BL-658's feature file, a mutation sweep script - is not the schedule, and
# matching on the word made this check fail on a narrative re-tense.
schedule_touched="$(git -C "$REPO_ROOT" diff --name-only main -- \
  'swarmforge/config/**' 'swarmforge/swarmforge.conf' '**/continuous-shifts.json' \
  'swarmforge/scripts/install_shift_schedule_cron.sh' 'swarmforge/scripts/apply_shift_schedule.bb' 2>/dev/null)"
if [[ -z "$schedule_touched" ]]; then
  pass "no crontab, shift configuration or schedule file changed"
else
  fail "this parcel touched the schedule: $(head -3 <<<"$schedule_touched")"
fi

# ── 7. "worked a shift" is answered from what the launch already writes ──
# swarm-identity is rewritten by swarmforge.sh on every launch, so its mtime is
# the shift start; the explicit `.swarmforge/shift-started` path is read first
# for whoever adds that stamp later. Both are checked against a fixture rather
# than by grepping the reader for its own literals.
make_root stamped
touch -d '2026-09-04 09:00' "$WORK/stamped/.swarmforge/swarm-identity" 2>/dev/null || \
  printf 'swarm_name\ttest\n' > "$WORK/stamped/.swarmforge/swarm-identity"
rm -f "$WORK/stamped/.swarmforge/shift-started"
# Two ticks, as check 1 does: the first freezes, the second carries the
# sequence past the drain to the packet. One tick shows only the freeze and
# would report a failure that is really an impatient probe.
out="$(run_ceremony "$WORK/stamped" --sleep-path finish-shift)
$(run_ceremony "$WORK/stamped" --sleep-path finish-shift)"
if grep -q '"lean-packet"' <<<"$out"; then
  pass "a launch newer than the last ceremony counts as a shift, with no extra stamp"
else
  fail "the launch marker alone did not count as a shift: $(tail -3 <<<"$out")"
fi

if (( status == 0 )); then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
