#!/usr/bin/env bash
# BL-056 cleaner pass extracted dispatch_lib.bb out of ready_for_next.bb and
# done_with_current.bb. The existing worktree-root-anchoring test only drives
# the TASK-mode branch of the shared dispatcher (see test 03 there). The
# BATCH-mode branch (used in production by this very hardender role, and by
# cleaner) and the dispatcher's error paths (missing role, unknown role,
# unmapped receive mode) had no test coverage of their own. This file closes
# that gap directly against dispatch_lib.bb's real callers, ready_for_next.bb
# and done_with_current.bb.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
READY_DISPATCH="$SCRIPT_DIR/../ready_for_next.bb"
DONE_DISPATCH="$SCRIPT_DIR/../done_with_current.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init
COMMIT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

BATCH_WT="$ROOT/.worktrees/batchrole"
git -C "$ROOT" worktree add -q -b batchrole "$BATCH_WT"

ROLES="batchrole\tbatchrole\t$BATCH_WT\tswarmforge-batchrole\tBatchrole\tclaude\tbatch
weirdrole\tweirdrole\t$BATCH_WT\tswarmforge-weirdrole\tWeirdrole\tclaude\tyolo
"
mkdir -p "$ROOT/.swarmforge" "$BATCH_WT/.swarmforge"
printf "$ROLES" > "$ROOT/.swarmforge/roles.tsv"
printf "$ROLES" > "$BATCH_WT/.swarmforge/roles.tsv"

queue_inbox_task() {
  local inbox_new="$1" name="$2" recipient="$3"
  mkdir -p "$inbox_new"
  printf 'id: %s\nfrom: specifier\nto: %s\nrecipient: %s\npriority: 50\ntype: git_handoff\ntask: BL-056-dispatch-test\ncommit: %s\n\npayload for %s\n' \
    "$name" "$recipient" "$recipient" "$COMMIT" "$name" > "$inbox_new/50_${name}.handoff"
}

# ── 1: batch-mode role dispatches through ready_for_next.bb to the batch helper ──
BATCH_INBOX="$BATCH_WT/.swarmforge/handoffs/inbox"
queue_inbox_task "$BATCH_INBOX/new" "item1" "batchrole"

OUT="$(cd "$BATCH_WT" && SWARMFORGE_ROLE=batchrole bb "$READY_DISPATCH")"
echo "$OUT" | grep -q '^BATCH:' || fail "01: batch-mode dispatch did not route to ready_for_next_batch.sh (got: $OUT)"
echo "$OUT" | grep -q '^COUNT: 1$' || fail "01: expected single-item batch"
pass "01: batch-mode role routes ready_for_next.bb to the batch helper"

OUT="$(cd "$BATCH_WT" && SWARMFORGE_ROLE=batchrole bb "$DONE_DISPATCH")"
echo "$OUT" | grep -q '^COMPLETED_BATCH:' || fail "02: batch-mode dispatch did not route done_with_current.bb to the batch helper (got: $OUT)"
echo "$OUT" | grep -q '^NO_TASK$' || fail "02: expected NO_TASK after completing the only queued batch"
pass "02: batch-mode role routes done_with_current.bb to the batch helper"

# ── 3: unmapped receive-mode value is rejected, not silently defaulted ──
set +e
OUT="$(cd "$BATCH_WT" && SWARMFORGE_ROLE=weirdrole bb "$READY_DISPATCH" 2>&1)"
STATUS=$?
set -e
[ "$STATUS" -eq 2 ] || fail "03: expected exit 2 for unmapped receive mode, got $STATUS"
echo "$OUT" | grep -q 'INVALID_RECEIVE_MODE' || fail "03: expected INVALID_RECEIVE_MODE diagnostic (got: $OUT)"
pass "03: unmapped receive-mode value in roles.tsv is rejected with INVALID_RECEIVE_MODE"

# ── 4: unknown role is rejected, not silently defaulted to task mode ──
set +e
OUT="$(cd "$BATCH_WT" && SWARMFORGE_ROLE=ghostrole bb "$READY_DISPATCH" 2>&1)"
STATUS=$?
set -e
[ "$STATUS" -eq 1 ] || fail "04: expected exit 1 for unknown role, got $STATUS"
echo "$OUT" | grep -q 'Unknown role: ghostrole' || fail "04: expected Unknown role diagnostic (got: $OUT)"
pass "04: role absent from roles.tsv is rejected, not silently dispatched"

# ── 5: missing SWARMFORGE_ROLE is rejected ──
set +e
OUT="$(cd "$BATCH_WT" && env -u SWARMFORGE_ROLE bb "$READY_DISPATCH" 2>&1)"
STATUS=$?
set -e
[ "$STATUS" -eq 1 ] || fail "05: expected exit 1 for missing SWARMFORGE_ROLE, got $STATUS"
echo "$OUT" | grep -q 'Set SWARMFORGE_ROLE' || fail "05: expected Set SWARMFORGE_ROLE diagnostic (got: $OUT)"
pass "05: missing SWARMFORGE_ROLE is rejected before any dispatch"

echo "ALL PASS"
