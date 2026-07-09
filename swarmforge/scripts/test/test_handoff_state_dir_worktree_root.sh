#!/usr/bin/env bash
# BL-056: handoff outbox/inbox must anchor at the worktree ROOT, not the
# invocation cwd. Before the fix, running any handoff helper from a worktree
# SUBDIRECTORY (e.g. extension/) created/read a nested
# <worktree>/extension/.swarmforge/handoffs tree that the daemon never watches,
# silently stalling the swarm.
#
# Covers acceptance scenarios BL-056 anchor-state-dir-01..05.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARM_HANDOFF="$SCRIPT_DIR/../swarm_handoff.bb"
READY_DISPATCH="$SCRIPT_DIR/../ready_for_next.bb"
READY_TASK="$SCRIPT_DIR/../ready_for_next_task.bb"
DONE_TASK="$SCRIPT_DIR/../done_with_current_task.bb"
READY_BATCH="$SCRIPT_DIR/../ready_for_next_batch.bb"
DONE_BATCH="$SCRIPT_DIR/../done_with_current_batch.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# ── fixture: a project root with a coder git worktree ────────────────────────
ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init
COMMIT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

CODER_WT="$ROOT/.worktrees/coder"
git -C "$ROOT" worktree add -q -b coder "$CODER_WT"

mkdir -p "$ROOT/.swarmforge" "$CODER_WT/.swarmforge" "$CODER_WT/extension" "$ROOT/subdir"
ROLES="coordinator\tmaster\t$ROOT\tswarmforge-coordinator\tCoordinator\tclaude\ttask
specifier\tmaster\t$ROOT\tswarmforge-specifier\tSpecifier\tclaude\ttask
coder\tcoder\t$CODER_WT\tswarmforge-coder\tCoder\tclaude\ttask
"
printf "$ROLES" > "$ROOT/.swarmforge/roles.tsv"
printf "$ROLES" > "$CODER_WT/.swarmforge/roles.tsv"

ROOT_OUTBOX="$CODER_WT/.swarmforge/handoffs/outbox"
ROOT_INBOX="$CODER_WT/.swarmforge/handoffs/inbox"
NESTED_STATE="$CODER_WT/extension/.swarmforge"

outbox_count() { find "$ROOT_OUTBOX" -maxdepth 1 -name '*.handoff' 2>/dev/null | wc -l | tr -d ' '; }

make_draft() {
  local dir="$1"
  mkdir -p "$dir/tmp"
  printf 'type: git_handoff\nto: coordinator\npriority: 50\ntask: BL-056-test\ncommit: %s\n' \
    "$COMMIT" > "$dir/tmp/draft.txt"
  echo "$dir/tmp/draft.txt"
}

queue_inbox_task() {
  local inbox_new="$1" name="$2" recipient="$3"
  mkdir -p "$inbox_new"
  printf 'id: %s\nfrom: specifier\nto: %s\nrecipient: %s\npriority: 50\ntype: git_handoff\ntask: BL-056-test\ncommit: %s\n\npayload for %s\n' \
    "$name" "$recipient" "$recipient" "$COMMIT" "$name" > "$inbox_new/50_${name}.handoff"
}

# ── 01: handoff created from a worktree subdirectory lands in the root outbox ─
DRAFT="$(make_draft "$CODER_WT")"
(cd "$CODER_WT/extension" && SWARMFORGE_ROLE=coder bb "$SWARM_HANDOFF" "$DRAFT" > /dev/null)

[[ "$(outbox_count)" == "1" ]] || fail "01: handoff from subdir did not land in worktree-root outbox"
[[ ! -e "$NESTED_STATE" ]] || fail "01: nested $NESTED_STATE was created"
pass "01: handoff from subdir lands in worktree-root outbox, no nested tree"

# ── 02: handoff created from the worktree root is unchanged ──────────────────
DRAFT="$(make_draft "$CODER_WT")"
(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$SWARM_HANDOFF" "$DRAFT" > /dev/null)
[[ "$(outbox_count)" == "2" ]] || fail "02: handoff from worktree root did not land in the same root outbox"
pass "02: handoff from worktree root lands in the same root outbox"

# ── 03: receiving from a worktree subdirectory reads the root inbox ──────────
queue_inbox_task "$ROOT_INBOX/new" "task-a" "coder"
OUT="$(cd "$CODER_WT/extension" && SWARMFORGE_ROLE=coder bb "$READY_DISPATCH")"
grep -q "^TASK: $ROOT_INBOX/in_process/" <<< "$OUT" \
  || fail "03: ready_for_next from subdir did not accept the root-inbox task; got: $OUT"
[[ ! -e "$NESTED_STATE" ]] || fail "03: nested $NESTED_STATE was created on receive"
pass "03: ready_for_next from subdir reads the worktree-root inbox"

# ── done_with_current_task from a subdirectory completes the root task ───────
OUT="$(cd "$CODER_WT/extension" && SWARMFORGE_ROLE=coder bb "$DONE_TASK")"
grep -q "^COMPLETED: $ROOT_INBOX/completed/" <<< "$OUT" \
  || fail "done_with_current_task from subdir did not complete the root-inbox task; got: $OUT"
pass "done_with_current_task from subdir completes into the root inbox"

# ── batch helpers from a subdirectory use the root inbox ─────────────────────
queue_inbox_task "$ROOT_INBOX/new" "batch-a" "coder"
queue_inbox_task "$ROOT_INBOX/new" "batch-b" "coder"
OUT="$(cd "$CODER_WT/extension" && SWARMFORGE_ROLE=coder bb "$READY_BATCH")"
grep -q "^BATCH: $ROOT_INBOX/in_process/batch_" <<< "$OUT" \
  || fail "ready_for_next_batch from subdir did not batch the root-inbox tasks; got: $OUT"
grep -q "^COUNT: 2" <<< "$OUT" || fail "ready_for_next_batch batched wrong count; got: $OUT"
OUT="$(cd "$CODER_WT/extension" && SWARMFORGE_ROLE=coder bb "$DONE_BATCH")"
grep -q "^COMPLETED_BATCH: $ROOT_INBOX/completed/batch_" <<< "$OUT" \
  || fail "done_with_current_batch from subdir did not complete the root batch; got: $OUT"
[[ ! -e "$NESTED_STATE" ]] || fail "batch helpers created nested $NESTED_STATE"
pass "batch helpers from subdir use the worktree-root inbox"

# ── 04: stale nested files are left where they are ───────────────────────────
STALE_DIR="$NESTED_STATE/handoffs/outbox"
mkdir -p "$STALE_DIR"
printf 'type: git_handoff\n\nstale\n' > "$STALE_DIR/50_stale.handoff"
DRAFT="$(make_draft "$CODER_WT")"
(cd "$CODER_WT/extension" && SWARMFORGE_ROLE=coder bb "$SWARM_HANDOFF" "$DRAFT" > /dev/null)
[[ "$(outbox_count)" == "3" ]] || fail "04: handoff from subdir stopped landing in root outbox"
[[ -f "$STALE_DIR/50_stale.handoff" ]] || fail "04: stale nested outbox file was moved or deleted"
[[ "$(find "$STALE_DIR" -name '*.handoff' | wc -l | tr -d ' ')" == "1" ]] \
  || fail "04: new files were written into the stale nested outbox"
find "$ROOT" -path '*/inbox/new/*stale*' 2>/dev/null | grep -q . \
  && fail "04: stale nested file was delivered to an inbox"
pass "04: stale nested outbox files are untouched and not re-delivered"

# ── 05: coordinator/specifier's own per-role mailboxes (BL-128) keep
# recipient isolation - each queued straight into its OWN physical
# subdirectory now, not a shared "master inbox" ──────────────────────────────
COORDINATOR_INBOX="$ROOT/.swarmforge/handoffs/coordinator/inbox"
SPECIFIER_INBOX="$ROOT/.swarmforge/handoffs/specifier/inbox"
queue_inbox_task "$COORDINATOR_INBOX/new" "for-coordinator" "coordinator"
queue_inbox_task "$SPECIFIER_INBOX/new" "for-specifier" "specifier"
[[ "$COORDINATOR_INBOX" != "$SPECIFIER_INBOX" ]] \
  || fail "05: coordinator and specifier resolved to the same mailbox directory"
OUT="$(cd "$ROOT/subdir" && SWARMFORGE_ROLE=coordinator bb "$READY_TASK")"
grep -q "for-coordinator" <<< "$OUT" \
  || fail "05: coordinator did not receive its own handoff from subdir; got: $OUT"
grep -q "for-specifier" <<< "$OUT" \
  && fail "05: coordinator received the specifier's handoff"
OUT="$(cd "$ROOT/subdir" && SWARMFORGE_ROLE=specifier bb "$READY_TASK")"
grep -q "for-specifier" <<< "$OUT" \
  || fail "05: specifier did not receive its own handoff from subdir; got: $OUT"
pass "05: coordinator/specifier's own per-role mailboxes keep recipient isolation from a subdir"

echo "ALL PASS"
