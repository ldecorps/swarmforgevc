#!/usr/bin/env bash
# BL-063: reroute machinery — point-to-point pipeline detours with a bounded
# detour budget and livelock (repeating stage-to-stage pattern) gate.
# Generalizes redo_from's salvage plumbing (BL-036) via the shared
# salvage_lib.bb; this test also re-covers that redo_from itself still works
# after the extraction. Covers scenarios BL-063 reroute-01..05.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REROUTE="$SCRIPT_DIR/../reroute.bb"
RESUME="$SCRIPT_DIR/../reroute_resume.bb"
SWARM_HANDOFF="$SCRIPT_DIR/../swarm_handoff.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# ── fixture: git repo with roles + coder/cleaner/architect worktrees ────────
ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q --allow-empty -m one
HEAD10="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

CODER_WT="$ROOT/.worktrees/coder"
CLEANER_WT="$ROOT/.worktrees/cleaner"
ARCHITECT_WT="$ROOT/.worktrees/architect"
git -C "$ROOT" worktree add -q -b coder "$CODER_WT"
git -C "$ROOT" worktree add -q -b cleaner "$CLEANER_WT"
git -C "$ROOT" worktree add -q -b architect "$ARCHITECT_WT"

mkdir -p "$ROOT/.swarmforge"
{
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT"
  printf 'specifier\tmaster\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$ROOT"
  printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT"
  printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$CLEANER_WT"
  printf 'architect\tarchitect\t%s\tswarmforge-architect\tArchitect\tclaude\ttask\n' "$ARCHITECT_WT"
  printf 'hardender\thardender\t%s\tswarmforge-hardender\tHardender\tclaude\tbatch\n' "$CODER_WT"
  printf 'documenter\tdocumenter\t%s\tswarmforge-documenter\tDocumenter\tclaude\ttask\n' "$CODER_WT"
  printf 'QA\tQA\t%s\tswarmforge-QA\tQA\tclaude\ttask\n' "$ROOT"
} > "$ROOT/.swarmforge/roles.tsv"

for wt in "$CODER_WT" "$CLEANER_WT" "$ARCHITECT_WT"; do
  mkdir -p "$wt/.swarmforge/handoffs/inbox/new" \
           "$wt/.swarmforge/handoffs/inbox/in_process" \
           "$wt/.swarmforge/handoffs/inbox/completed"
done

ITEM="BL-900"
TASK="BL-900-demo-item"
# BL-128: state-dir (and so the outbox) is now resolved per-SENDER role, not
# just per-invocation cwd - coder/cleaner/architect each have their own
# dedicated worktree (not master-resident), so each keeps its own flat,
# unprefixed outbox at its own worktree path. Every reroute/resume call
# below runs as a specific SWARMFORGE_ROLE, so the outbox to check depends
# on which role issued that particular call.
CODER_OUTBOX="$CODER_WT/.swarmforge/handoffs/outbox"
CLEANER_OUTBOX="$CLEANER_WT/.swarmforge/handoffs/outbox"
ARCHITECT_OUTBOX="$ARCHITECT_WT/.swarmforge/handoffs/outbox"
OUTBOX="$CODER_OUTBOX"

# Seed a completed handoff so task-name/last-good-commit resolve (mirrors
# test_redo_from.sh's fixture pattern).
printf 'id: seed\nfrom: specifier\nto: coder\nrecipient: coder\npriority: 00\ntype: git_handoff\ntask: %s\ncommit: %s\n\nbody\n' \
  "$TASK" "$HEAD10" > "$CODER_WT/.swarmforge/handoffs/inbox/completed/00_seed.handoff"

# ── invalid to-stage rejected before anything is touched (mirrors ──────────
# ── test_redo_from.sh's "05: invalid stage" coverage for the sibling tool) ──
printf 'id: pre-invalid\nfrom: specifier\nto: coder\nrecipient: coder\npriority: 00\ntype: git_handoff\ntask: %s\ncommit: %s\n\nbody\n' \
  "$TASK" "$HEAD10" > "$CODER_WT/.swarmforge/handoffs/inbox/new/00_pre_invalid.handoff"
set +e
OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$REROUTE" "$ITEM" "not-a-real-stage" "typo" 2>&1)"
RC=$?
set -e
[[ $RC -ne 0 ]] || fail "00: an invalid to-stage did not fail"
grep -q "coder | cleaner | architect | hardender | documenter | qa" <<< "$OUT" \
  || fail "00: error does not list valid stages; got: $OUT"
[[ -z "$(git -C "$ROOT" tag -l 'redo/*')" ]] || fail "00: checkpoint tag created on invalid to-stage"
[[ -f "$CODER_WT/.swarmforge/handoffs/inbox/new/00_pre_invalid.handoff" ]] \
  || fail "00: unrelated inbox/new item abandoned on an invalid to-stage"
[[ ! -d "$OUTBOX" || -z "$(ls "$OUTBOX" 2>/dev/null | grep -v tmp || true)" ]] \
  || fail "00: handoff queued on invalid to-stage"
[[ ! -f "$ROOT/.swarmforge/reroute-state/$ITEM.json" ]] \
  || fail "00: reroute-state written for an invalid to-stage"
pass "00: an invalid to-stage is rejected with the valid-stage list, nothing touched"

# ── 01: a stage detours the parcel with a reason note; count increments ─────
OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$REROUTE" "$ITEM" cleaner "needs cleaner's opinion")"
grep -q "^REROUTE: $ITEM from coder to cleaner" <<< "$OUT" || fail "01: unexpected reroute output: $OUT"

QUEUED="$(ls -t "$OUTBOX"/*.handoff | head -1)"
grep -q "^to: cleaner$" "$QUEUED" || fail "01: reroute handoff not addressed to cleaner"
grep -q "^reroute_reason: needs cleaner's opinion$" "$QUEUED" || fail "01: reroute reason note missing from the target's handoff"

STATE_FILE="$ROOT/.swarmforge/reroute-state/$ITEM.json"
[[ -f "$STATE_FILE" ]] || fail "01: no reroute-state file written"
grep -q '"count":1' "$STATE_FILE" || fail "01: reroute count did not increment to 1"
pass "01: a stage detours the parcel to another stage; target sees the reason note; count increments"

# ── 05: reroutes reuse the redo_from salvage plumbing ────────────────────────
TAG="$(git -C "$ROOT" tag -l "redo/$ITEM/cleaner/*")"
[[ -n "$TAG" ]] || fail "05: no checkpoint tag created (expected the same redo/ tag namespace as redo_from)"
pass "05: reroute checkpoints through the same redo/<item>/<stage>/* tag namespace as redo_from"

# stale item already queued for coder must be abandoned exactly like redo_from does
printf 'id: stale\nfrom: specifier\nto: coder\nrecipient: coder\npriority: 00\ntype: git_handoff\ntask: %s\ncommit: %s\n\nbody\n' \
  "$TASK" "$HEAD10" > "$CODER_WT/.swarmforge/handoffs/inbox/new/00_stale.handoff"
rm -f "$OUTBOX"/*.handoff
OUT="$(cd "$CLEANER_WT" && SWARMFORGE_ROLE=cleaner bb "$REROUTE" "$ITEM" architect "escalate for review")"
[[ -z "$(ls "$CODER_WT/.swarmforge/handoffs/inbox/new/" 2>/dev/null)" ]] \
  || fail "05: stale inbox/new item for the item was not abandoned by reroute"
[[ -n "$(ls "$CODER_WT/.swarmforge/handoffs/inbox/abandoned/" 2>/dev/null)" ]] \
  || fail "05: stale item was not moved to inbox/abandoned/"
pass "05: reroute abandons stale in-flight handoffs the same way redo_from does — no parallel mechanism"

# ── 02: after the detour completes, the parcel resumes at the interrupted stage ─
OUT="$(cd "$ARCHITECT_WT" && SWARMFORGE_ROLE=architect bb "$RESUME" "$ITEM" "review done")"
grep -q "^REROUTE RESUME: $ITEM resumes at cleaner" <<< "$OUT" || fail "02: unexpected resume output: $OUT"

# resume ran as architect, so the fresh handoff lands in architect's own outbox
QUEUED="$(ls -t "$ARCHITECT_OUTBOX"/*.handoff | head -1)"
grep -q "^to: cleaner$" "$QUEUED" || fail "02: resume did not re-enter the chain at the interrupted stage (cleaner)"
grep -q "^reroute_reason: review done$" "$QUEUED" || fail "02: resume reason note missing"

grep -q '"pending_return":null' "$STATE_FILE" || fail "02: pending_return was not cleared after resume"
pass "02: the pipeline resumes at the interrupted stage (cleaner) once the detour completes"

# resuming again with nothing pending must be refused, not silently no-op
set +e
OUT="$(cd "$ARCHITECT_WT" && SWARMFORGE_ROLE=architect bb "$RESUME" "$ITEM" 2>&1)"
RC=$?
set -e
[[ $RC -ne 0 ]] || fail "02b: resuming with no pending detour should fail"
grep -qi "no pending detour" <<< "$OUT" || fail "02b: unexpected error for a resume with nothing pending: $OUT"
pass "02b: resuming with no pending detour is refused, not a silent no-op"

# ── 03: detour budget bounds automatic reroutes ──────────────────────────────
ITEM2="BL-901"
TASK2="BL-901-budget-item"
printf 'id: seed2\nfrom: specifier\nto: coder\nrecipient: coder\npriority: 00\ntype: git_handoff\ntask: %s\ncommit: %s\n\nbody\n' \
  "$TASK2" "$HEAD10" > "$CODER_WT/.swarmforge/handoffs/inbox/completed/00_seed2.handoff"

export SWARMFORGE_REROUTE_BUDGET=3
# three distinct (from,to) pairs to exhaust the budget without tripping livelock
(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$REROUTE" "$ITEM2" cleaner "r1" > /dev/null)
(cd "$CLEANER_WT" && SWARMFORGE_ROLE=cleaner bb "$REROUTE" "$ITEM2" architect "r2" > /dev/null)
(cd "$ARCHITECT_WT" && SWARMFORGE_ROLE=architect bb "$REROUTE" "$ITEM2" coder "r3" > /dev/null)

rm -f "$OUTBOX"/*.handoff
set +e
OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$REROUTE" "$ITEM2" documenter "r4" 2>&1)"
RC=$?
set -e
[[ $RC -ne 0 ]] || fail "03: a reroute past the detour budget must be refused"
grep -qi "budget" <<< "$OUT" || fail "03: unexpected error for a budget-exceeded reroute: $OUT"
[[ -z "$(ls "$OUTBOX"/*.handoff 2>/dev/null)" ]] || fail "03: a blocked reroute must not queue a handoff"
grep -q '"event":"reroute-blocked"' "$ROOT/.swarmforge/run-log.jsonl" || fail "03: no reroute-blocked event in the run log"
grep -q '"reason":"budget-exceeded"' "$ROOT/.swarmforge/run-log.jsonl" || fail "03: run log missing budget-exceeded reason"
pass "03: detour budget bounds automatic reroutes and escalates instead of looping forever"
unset SWARMFORGE_REROUTE_BUDGET

# ── 04: livelock (repeating stage-to-stage pattern) escalates to the human ──
ITEM3="BL-902"
TASK3="BL-902-livelock-item"
printf 'id: seed3\nfrom: specifier\nto: coder\nrecipient: coder\npriority: 00\ntype: git_handoff\ntask: %s\ncommit: %s\n\nbody\n' \
  "$TASK3" "$HEAD10" > "$CODER_WT/.swarmforge/handoffs/inbox/completed/00_seed3.handoff"

(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$REROUTE" "$ITEM3" cleaner "first hop" > /dev/null)
(cd "$CLEANER_WT" && SWARMFORGE_ROLE=cleaner bb "$REROUTE" "$ITEM3" coder "back again" > /dev/null)

rm -f "$OUTBOX"/*.handoff
set +e
OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$REROUTE" "$ITEM3" cleaner "repeat the same hop" 2>&1)"
RC=$?
set -e
[[ $RC -ne 0 ]] || fail "04: a repeating stage-to-stage reroute pattern must be refused"
grep -qi "livelock" <<< "$OUT" || fail "04: unexpected error for a livelock reroute: $OUT"
[[ -z "$(ls "$OUTBOX"/*.handoff 2>/dev/null)" ]] || fail "04: a livelock-blocked reroute must not queue a handoff"
grep -q '"event":"reroute-blocked"' "$ROOT/.swarmforge/run-log.jsonl" || fail "04: no reroute-blocked event in the run log"
grep -q '"reason":"livelock"' "$ROOT/.swarmforge/run-log.jsonl" || fail "04: run log missing livelock reason"
pass "04: livelock (repeating coder<->cleaner pattern) stops automatic rerouting and escalates"

echo "ALL PASS"
