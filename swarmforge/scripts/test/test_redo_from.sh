#!/usr/bin/env bash
# BL-036: redo_from salvages a failed/rejected pipeline run by abandoning the
# item's stale handoffs, checkpoint-tagging HEAD, and re-injecting a fresh
# git_handoff at the named stage. Covers scenarios BL-036 redo-from-stage-01..05.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REDO="$SCRIPT_DIR/../redo_from.bb"
SWARM_HANDOFF="$SCRIPT_DIR/../swarm_handoff.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# ── fixture: git repo with roles + a coder worktree ──────────────────────────
ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q --allow-empty -m one
C1="$(git -C "$ROOT" rev-parse --short=10 HEAD)"
git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q --allow-empty -m two
HEAD10="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

CODER_WT="$ROOT/.worktrees/coder"
git -C "$ROOT" worktree add -q -b coder "$CODER_WT"

mkdir -p "$ROOT/.swarmforge" "$CODER_WT/.swarmforge/handoffs/inbox/new" \
         "$CODER_WT/.swarmforge/handoffs/inbox/in_process" \
         "$CODER_WT/.swarmforge/handoffs/inbox/completed"
{
  printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT"
  printf 'specifier\tmaster\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$ROOT"
  printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT"
  printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$CODER_WT"
  printf 'architect\tarchitect\t%s\tswarmforge-architect\tArchitect\tclaude\ttask\n' "$CODER_WT"
  printf 'hardender\thardender\t%s\tswarmforge-hardender\tHardender\tclaude\tbatch\n' "$CODER_WT"
  printf 'documenter\tdocumenter\t%s\tswarmforge-documenter\tDocumenter\tclaude\ttask\n' "$CODER_WT"
  printf 'QA\tQA\t%s\tswarmforge-QA\tQA\tclaude\ttask\n' "$ROOT"
} > "$ROOT/.swarmforge/roles.tsv"

ITEM="BL-900"
TASK="BL-900-demo-item"
OUTBOX="$ROOT/.swarmforge/handoffs/outbox"

drop_handoff() {  # dir name recipient extra-header
  printf 'id: %s\nfrom: specifier\nto: %s\nrecipient: %s\npriority: 00\ntype: git_handoff\ntask: %s\ncommit: %s\n%s\nbody\n' \
    "$2" "$3" "$3" "$TASK" "$C1" "${4:-}" > "$1/00_$2.handoff"
}

# ── 05: invalid stage rejected, nothing produced ─────────────────────────────
drop_handoff "$CODER_WT/.swarmforge/handoffs/inbox/new" "stale1" "coder"
set +e
OUT="$(cd "$ROOT" && bb "$REDO" "$ITEM" "tester" 2>&1)"
RC=$?
set -e
[[ $RC -ne 0 ]] || fail "05: invalid stage did not fail"
grep -q "coder | cleaner | architect | hardender | documenter | qa" <<< "$OUT" \
  || fail "05: error does not list valid stages; got: $OUT"
[[ -z "$(git -C "$ROOT" tag -l 'redo/*')" ]] || fail "05: tag created on invalid stage"
[[ -f "$CODER_WT/.swarmforge/handoffs/inbox/new/00_stale1.handoff" ]] \
  || fail "05: stale handoff touched on invalid stage"
[[ ! -d "$OUTBOX" || -z "$(ls "$OUTBOX" 2>/dev/null | grep -v tmp || true)" ]] \
  || fail "05: handoff queued on invalid stage"
pass "05: invalid stage rejected with valid-stage list, nothing produced"

# ── 01+02+03: redo from cleaner abandons stale mail, tags, re-injects ────────
drop_handoff "$CODER_WT/.swarmforge/handoffs/inbox/in_process" "stale2" "coder"
# prior handoff TO cleaner establishes the last known good commit (C1)
drop_handoff "$CODER_WT/.swarmforge/handoffs/inbox/completed" "prior-cleaner" "cleaner"

OUT="$(cd "$CODER_WT" && bb "$REDO" "$ITEM" cleaner)"

[[ -z "$(ls "$CODER_WT/.swarmforge/handoffs/inbox/new/" 2>/dev/null)" ]] \
  || fail "02: inbox/new still has stale handoffs"
[[ -z "$(ls "$CODER_WT/.swarmforge/handoffs/inbox/in_process/" 2>/dev/null)" ]] \
  || fail "02: in_process still has stale handoffs"
[[ "$(ls "$CODER_WT/.swarmforge/handoffs/inbox/abandoned/" | wc -l | tr -d ' ')" == "2" ]] \
  || fail "02: expected 2 abandoned handoffs"
pass "02: stale new/in_process handoffs abandoned before re-injection"

TAG="$(git -C "$ROOT" tag -l "redo/$ITEM/cleaner/*")"
[[ -n "$TAG" ]] || fail "01: no checkpoint tag redo/$ITEM/cleaner/*"
QUEUED="$(ls "$OUTBOX"/*.handoff 2>/dev/null | head -1)"
[[ -n "$QUEUED" ]] || fail "01: no fresh handoff queued"
grep -q "^to: cleaner$" "$QUEUED" || fail "01: fresh handoff not addressed to cleaner"
grep -q "^task: $TASK$" "$QUEUED" || fail "01: task name not preserved"
grep -q "^commit: $C1$" "$QUEUED" || fail "01: did not use last known good commit for cleaner"
pass "01: checkpoint tagged and fresh handoff re-injected at cleaner with last good commit"

grep -q '"event":"redo"' "$ROOT/.swarmforge/run-log.jsonl" || fail "03: no redo entry in run log"
grep -q '"from_stage":"cleaner"' "$ROOT/.swarmforge/run-log.jsonl" || fail "03: from_stage missing"
pass "03: redo recorded in run-log.jsonl with from_stage"

# ── 01 (coder variant): redo from coder uses current HEAD ────────────────────
rm -f "$OUTBOX"/*.handoff
(cd "$ROOT" && bb "$REDO" "$ITEM" coder > /dev/null)
QUEUED="$(ls "$OUTBOX"/*.handoff | head -1)"
grep -q "^to: coder$" "$QUEUED" || fail "01-coder: not addressed to coder"
grep -q "^commit: $HEAD10$" "$QUEUED" || fail "01-coder: coder redo must use current HEAD"
pass "01-coder: redo from coder uses current HEAD"

# ── 04: QA rejection_reason is accepted by swarm_handoff and captured ────────
mkdir -p "$ROOT/tmp"
printf 'type: git_handoff\nto: coder\npriority: 00\ntask: %s\ncommit: %s\nrejection_reason: acceptance scenario 3 fails on empty input\n' \
  "$TASK" "$C1" > "$ROOT/tmp/reject-draft.txt"
(cd "$ROOT" && SWARMFORGE_ROLE=QA bb "$SWARM_HANDOFF" "$ROOT/tmp/reject-draft.txt" > /dev/null) \
  || fail "04: swarm_handoff rejected a draft carrying rejection_reason"
REJECTED="$(ls -t "$OUTBOX"/*.handoff | head -1)"
grep -q "^rejection_reason: acceptance scenario 3 fails on empty input$" "$REJECTED" \
  || fail "04: rejection_reason header not preserved in the queued handoff"
# simulate delivery: the rejection lands in the coder inbox, then gets redone
mv "$REJECTED" "$CODER_WT/.swarmforge/handoffs/inbox/new/00_zz_rejection.handoff"

(cd "$ROOT" && bb "$REDO" "$ITEM" coder > /dev/null)
grep -q '"reason":"acceptance scenario 3 fails on empty input"' "$ROOT/.swarmforge/run-log.jsonl" \
  || fail "04: redo log did not capture the rejection_reason"
pass "04: rejection_reason validated, preserved, and captured in the redo log"

# ── DEFECT (QA): two redos in the same second must not collide on the tag ────
rm -f "$OUTBOX"/*.handoff
(cd "$ROOT" && bb "$REDO" "$ITEM" cleaner > /dev/null) || fail "tag-collision: first rapid redo failed"
(cd "$ROOT" && bb "$REDO" "$ITEM" cleaner > /dev/null) || fail "tag-collision: second same-second redo failed"
RAPID_TAGS="$(git -C "$ROOT" tag -l "redo/$ITEM/cleaner/*" | wc -l | tr -d ' ')"
[[ "$RAPID_TAGS" -ge 3 ]] || fail "tag-collision: expected distinct tags per redo, found $RAPID_TAGS"
pass "tag-collision: same-second redos produce distinct checkpoint tags"

# ── 01 (outline sweep): every stage maps to a queueable recipient ────────────
for stage in architect hardender documenter qa; do
  rm -f "$OUTBOX"/*.handoff
  (cd "$ROOT" && bb "$REDO" "$ITEM" "$stage" > /dev/null) || fail "01-$stage: redo failed"
  QUEUED="$(ls "$OUTBOX"/*.handoff | head -1)"
  role="$stage"; [[ "$stage" == "qa" ]] && role="QA"
  grep -q "^to: $role$" "$QUEUED" || fail "01-$stage: not addressed to $role"
  [[ -n "$(git -C "$ROOT" tag -l "redo/$ITEM/$stage/*")" ]] || fail "01-$stage: no tag"
done
pass "01: all pipeline stages accept a redo and address the right role"

echo "ALL PASS"
