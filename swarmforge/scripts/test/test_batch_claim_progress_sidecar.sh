#!/usr/bin/env bash
# BL-678: shell-level wiring test for the batch-claim-progress sidecar.
#   1. Claiming a batch parcel writes its sidecar immediately (naming
#      owner role, parcel id, and claim instant) - never lazily.
#   2. mark-progress/observe (via batch_claim_progress_cli.bb, an injected-
#      clock wrapper over the same production functions) refreshes the
#      last-progress instant and correctly gates fresh vs stale.
#   3. Completing the batch (done_with_current_batch.bb) retires the
#      sidecar via the existing terminal-cleanup convention (BL-232's
#      remove-sidecars-of!) - no dedicated retirement code needed.

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
READY_BATCH="$SCRIPT_DIR/../ready_for_next_batch.bb"
CLI="$SCRIPT_DIR/../batch_claim_progress_cli.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

write_handoff() {
  local path="$1" recipient="${2:-batchrole}"
  printf 'id: t\nfrom: specifier\nto: %s\nrecipient: %s\npriority: 50\ntype: note\nmessage: BL-678-demo batch item\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n' \
    "$recipient" "$recipient" > "$path"
}

make_fixture() {
  ROOT="$(cd "$(mktemp -d)" && pwd -P)"
  register_tmp_dir "$ROOT"
  git -C "$ROOT" init -q
  git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

  BATCH_WT="$ROOT/.worktrees/batchrole"
  git -C "$ROOT" worktree add -q -b batchrole "$BATCH_WT"

  ROLES="batchrole\tbatchrole\t$BATCH_WT\tswarmforge-batchrole\tBatchrole\tclaude\tbatch
"
  mkdir -p "$ROOT/.swarmforge" "$BATCH_WT/.swarmforge"
  printf "$ROLES" > "$ROOT/.swarmforge/roles.tsv"
  printf "$ROLES" > "$BATCH_WT/.swarmforge/roles.tsv"

  BATCH_NEW="$BATCH_WT/.swarmforge/handoffs/inbox/new"
  BATCH_IN_PROCESS="$BATCH_WT/.swarmforge/handoffs/inbox/in_process"
  BATCH_COMPLETED="$BATCH_WT/.swarmforge/handoffs/inbox/completed"
  mkdir -p "$BATCH_NEW" "$BATCH_IN_PROCESS" "$BATCH_COMPLETED"
}

cleanup_fixture() { rm -rf "$ROOT"; }

# ── batch-claim-progress-sidecar-01: claiming writes the sidecar immediately ─
make_fixture
write_handoff "$BATCH_NEW/50_item.handoff"
(cd "$BATCH_WT" && SWARMFORGE_ROLE=batchrole bb "$READY_BATCH" >/dev/null)
BATCH_DIR="$(find "$BATCH_IN_PROCESS" -maxdepth 1 -type d -name 'batch_*' | head -1)"
[[ -n "$BATCH_DIR" && -f "$BATCH_DIR/50_item.handoff" ]] || fail "01: handoff was not dequeued into a batch dir"
SIDECAR="$BATCH_DIR/50_item.handoff.batch-claim-progress.json"
[[ -f "$SIDECAR" ]] || fail "01: batch-claim-progress sidecar was not written at claim time"
grep -q '"ownerRole":"batchrole"' "$SIDECAR" || fail "01: sidecar does not name the owner role"
grep -q '"parcelId":"BL-678-demo batch item"' "$SIDECAR" || fail "01: sidecar does not name the parcel id"
grep -q '"claimAtMs"' "$SIDECAR" || fail "01: sidecar does not record a claim instant"
pass "01: claiming a batch parcel writes its sidecar immediately, naming owner role/parcel id/claim instant"

# ── batch-claim-progress-sidecar-02: mark-progress refreshes last-progress ──
bb "$CLI" mark-progress "$BATCH_DIR/50_item.handoff" bbbbbbbbbb 9999999999999 >/dev/null
CLAIM_AT_MS="$(python3 -c "import json; print(json.load(open('$SIDECAR'))['claimAtMs'])")"
LAST_PROGRESS_MS="$(python3 -c "import json; print(json.load(open('$SIDECAR'))['lastProgressAtMs'])")"
[[ "$LAST_PROGRESS_MS" -gt "$CLAIM_AT_MS" ]] || fail "02: mark-progress did not advance last-progress instant past claim instant"
pass "02: working a batch refreshes the last-progress instant past its claim instant"

# ── batch-claim-progress-sidecar-03/04: chase-sweep observe gates on freshness ─
FRESH_OUT="$(bb "$CLI" observe "$BATCH_DIR/50_item.handoff" 10000000000 3600000)"
[[ "$FRESH_OUT" == "SILENT" ]] || fail "03: fresh progress must yield SILENT, got: $FRESH_OUT"
[[ -f "$BATCH_DIR/50_item.handoff" ]] || fail "03: the parcel must remain claimed in in_process"
[[ ! -e "$BATCH_NEW/50_item.handoff" ]] || fail "03: the parcel must never be re-delivered to inbox/new"
pass "03: a chase sweep leaves a fresh-progress parcel alone (SILENT, no re-forward/re-delivery)"

STALE_OUT="$(bb "$CLI" observe "$BATCH_DIR/50_item.handoff" 99999999999999 1000)"
[[ "$STALE_OUT" == STALE_SUSPECT* ]] || fail "04: stale progress must yield STALE_SUSPECT, got: $STALE_OUT"
echo "$STALE_OUT" | grep -q "BL-678-demo" || fail "04: suspect line must name the parcel"
[[ -f "$BATCH_DIR/50_item.handoff" ]] || fail "04: the parcel must remain claimed in in_process"
[[ ! -e "$BATCH_NEW/50_item.handoff" ]] || fail "04: the parcel must never be re-delivered to inbox/new even when stale"
pass "04: a stale-progress parcel is surfaced as suspect (naming the parcel), never silently re-delivered"

# ── batch-claim-progress-sidecar-05: completing the batch retires the sidecar ─
# Exercises the CLI's "retire" subcommand, which calls handoff-lib/remove-
# sidecars-of! - the EXACT function done_with_current_batch.bb calls, per
# source, on every completing batch item - rather than the full
# done_with_current_batch.bb -> run-ready! exec chain, which re-execs
# ready_for_next_batch.sh's own `cd "$SCRIPT_DIR"` (the REAL repo's scripts
# dir) and so cannot be safely driven against a fixture root from inside a
# real, currently-in-use role worktree.
[[ -f "$SIDECAR" ]] || fail "05 setup: sidecar must exist before retirement"
bb "$CLI" retire "$BATCH_DIR/50_item.handoff" >/dev/null
[[ ! -e "$SIDECAR" ]] || fail "05: sidecar must not survive retirement (the completion-path cleanup call)"
pass "05: completing a batch parcel retires its sidecar (no longer reads as an active claim)"

cleanup_fixture
echo "ALL PASS"
