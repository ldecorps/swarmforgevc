#!/usr/bin/env bash
# BL-365: a corrupt handoff (empty, truncated mid-header, or headers with no
# body) must never be dispatched as work at any hop that can see it - and a
# quarantined parcel must be surfaced, not silently lost a second way.
# Covers acceptance scenarios BL-365 corrupt-handoff-never-dispatched-01/02/03/05.
# Scenario 04 (durability: fsync happens before rename) is proven directly
# against the pure write path in handoff_lib_test_runner.bb - it cannot be
# proven here without an actual crash.
#
# No real timers/sleeps anywhere below: handoffd.bb's --poll-once runs
# exactly one deterministic pass and exits, matching this ticket's own
# testing note.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
READY_TASK="$SCRIPT_DIR/../ready_for_next_task.bb"
READY_BATCH="$SCRIPT_DIR/../ready_for_next_batch.bb"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

valid_handoff_body() {
  local id="$1" recipient="$2" priority="${3:-50}"
  printf 'id: %s\nfrom: specifier\nto: %s\nrecipient: %s\npriority: %s\ntype: git_handoff\ntask: BL-365-test\ncommit: 0000000000\n\npayload\n' \
    "$id" "$recipient" "$recipient" "$priority"
}

# ═══════════════════════════════════════════════════════════════════════════
# Scenario 01: a corrupt handoff is never dispatched to a role as work
#              (task mode, batch mode; empty / truncated / headers-with-no-body)
# ═══════════════════════════════════════════════════════════════════════════

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init
CODER_WT="$ROOT/.worktrees/coder"
git -C "$ROOT" worktree add -q -b coder "$CODER_WT"
mkdir -p "$ROOT/.swarmforge" "$CODER_WT/.swarmforge"
ROLES="coordinator\tmaster\t$ROOT\tswarmforge-coordinator\tCoordinator\tclaude\ttask
coder\tcoder\t$CODER_WT\tswarmforge-coder\tCoder\tclaude\ttask
"
printf "$ROLES" > "$ROOT/.swarmforge/roles.tsv"
printf "$ROLES" > "$CODER_WT/.swarmforge/roles.tsv"

INBOX="$CODER_WT/.swarmforge/handoffs/inbox"
mkdir -p "$INBOX/new"

# Three corruption fixtures, named to sort BEFORE the genuinely valid one so
# they are the FIRST candidates ready_for_next_task.bb would otherwise try.
printf '' > "$INBOX/new/10_empty_from_specifier_to_coder.handoff"
printf 'id: x\nfrom: specifier\nto: coder\nrecipient: coder\npriority: 20\nty' \
  > "$INBOX/new/20_truncated_from_specifier_to_coder.handoff"
printf 'id: x\nfrom: specifier\nto: coder\nrecipient: coder\npriority: 30\ntype: note\n' \
  > "$INBOX/new/30_nobody_from_specifier_to_coder.handoff"
valid_handoff_body "genuinely-valid" coder 90 > "$INBOX/new/90_genuinely-valid_from_specifier_to_coder.handoff"

OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$READY_TASK")"

grep -q "QUARANTINED corrupt-handoff: 10_empty_from_specifier_to_coder.handoff" <<< "$OUT" \
  || fail "01: empty handoff was not reported as quarantined; got: $OUT"
grep -q "QUARANTINED corrupt-handoff: 20_truncated_from_specifier_to_coder.handoff" <<< "$OUT" \
  || fail "01: truncated-mid-header handoff was not reported as quarantined; got: $OUT"
grep -q "QUARANTINED corrupt-handoff: 30_nobody_from_specifier_to_coder.handoff" <<< "$OUT" \
  || fail "01: headers-with-no-body handoff was not reported as quarantined; got: $OUT"
grep -q "^TASK: $INBOX/in_process/90_genuinely-valid_from_specifier_to_coder.handoff" <<< "$OUT" \
  || fail "01: the genuinely valid handoff behind the corrupt ones was not dispatched as the task; got: $OUT"

for name in 10_empty 20_truncated 30_nobody; do
  full="$(ls "$INBOX/new/${name}"*.handoff.dead 2>/dev/null || true)"
  [[ -n "$full" ]] || fail "01: expected ${name}... to be quarantined as *.handoff.dead in place"
  [[ ! -e "$INBOX/in_process/${name}"* ]] || fail "01: a corrupt handoff was promoted into in_process/"
done
pass "01/05: every corrupt handoff (empty, truncated mid-header, headers-with-no-body) is quarantined as *.handoff.dead in place - the exact suffix the existing dead-letter sweep already scans and surfaces to a human - and never dispatched; the genuinely valid handoff behind them still is"

rm -f "$INBOX/in_process"/*.handoff

# ── same guard in batch mode ─────────────────────────────────────────────
printf '' > "$INBOX/new/10_batch-empty_from_specifier_to_coder.handoff"
valid_handoff_body "batch-valid" coder 90 > "$INBOX/new/90_batch-valid_from_specifier_to_coder.handoff"

OUT="$(cd "$CODER_WT" && SWARMFORGE_ROLE=coder bb "$READY_BATCH")"
grep -q "QUARANTINED corrupt-handoff: 10_batch-empty_from_specifier_to_coder.handoff" <<< "$OUT" \
  || fail "01 (batch): empty handoff was not reported as quarantined; got: $OUT"
grep -q "^BATCH: $INBOX/in_process/batch_" <<< "$OUT" \
  || fail "01 (batch): the genuinely valid handoff did not form a batch; got: $OUT"
[[ -f "$INBOX/new/10_batch-empty_from_specifier_to_coder.handoff.dead" ]] \
  || fail "01 (batch): expected the corrupt handoff quarantined as *.handoff.dead"
[[ ! -e "$INBOX/in_process"/batch_*/*batch-empty* ]] \
  || fail "01 (batch): a corrupt handoff was promoted into the in_process batch"
pass "01 (batch mode): the same quarantine guard applies to ready_for_next_batch.bb"

rm -rf "$INBOX/in_process"/* "$INBOX/new"/*

# ═══════════════════════════════════════════════════════════════════════════
# Scenario 02: a corrupt handoff is not delivered onward to a recipient's inbox
# ═══════════════════════════════════════════════════════════════════════════

DAEMON_ROOT="$(cd "$(mktemp -d)" && pwd -P)"
SOCK="$DAEMON_ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$DAEMON_ROOT/.swarmforge"
echo "$SOCK" > "$DAEMON_ROOT/.swarmforge/tmux-socket"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\ncleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' \
  "$DAEMON_ROOT" "$DAEMON_ROOT" > "$DAEMON_ROOT/.swarmforge/roles.tsv"

OUTBOX="$DAEMON_ROOT/.swarmforge/handoffs/outbox"
FAILED="$DAEMON_ROOT/.swarmforge/handoffs/failed"
CLEANER_NEW="$DAEMON_ROOT/.swarmforge/handoffs/inbox/new"
mkdir -p "$OUTBOX" "$CLEANER_NEW"

CORRUPT_NAME="50_20260714T000000Z_000001_from_coder_to_cleaner.handoff"
printf '' > "$OUTBOX/$CORRUPT_NAME"

FAKE_BIN="$DAEMON_ROOT/bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$DAEMON_ROOT" --poll-once >/dev/null 2>&1

[[ ! -e "$OUTBOX/$CORRUPT_NAME" ]] || fail "02: expected the corrupt handoff to leave outbox/ (quarantined, not left to retry forever)"
[[ -f "$FAILED/$CORRUPT_NAME" ]] || fail "02: expected the corrupt handoff to be quarantined into failed/"
[[ -f "$FAILED/$CORRUPT_NAME.error" ]] || fail "02: expected a diagnostic .error stub next to the quarantined file"
grep -qi "corrupt" "$FAILED/$CORRUPT_NAME.error" \
  || fail "02: expected the diagnostic to say WHAT was wrong (corrupt handoff), got: $(cat "$FAILED/$CORRUPT_NAME.error")"
[[ -z "$(ls -A "$CLEANER_NEW" 2>/dev/null)" ]] \
  || fail "02: the corrupt handoff must never be copied into the recipient's inbox/new/"
pass "02: the handoff daemon quarantines a corrupt outbox file into failed/ with a diagnostic, and never delivers it onward"

# ── the happy path is unaffected: a normal handoff still delivers ──────────
GOOD_NAME="50_20260714T000000Z_000002_from_coder_to_cleaner.handoff"
valid_handoff_body "good" cleaner 50 > "$OUTBOX/$GOOD_NAME"
PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$DAEMON_ROOT" --poll-once >/dev/null 2>&1
[[ ! -e "$OUTBOX/$GOOD_NAME" ]] || fail "happy-path: expected the good handoff to leave outbox/"
DELIVERED="$(ls "$CLEANER_NEW"/*_for_cleaner.handoff 2>/dev/null || true)"
[[ -n "$DELIVERED" ]] || fail "happy-path: expected the good handoff to be delivered into cleaner's inbox/new/"
pass "the corruption guard does not break the happy path - a normal handoff still delivers and would still dequeue"

rm -rf "$DAEMON_ROOT"

# Scenario 03 (a sender cannot install an empty handoff into its outbox) and
# Scenario 04 (a handoff that survives a crash still has its contents) are
# both proven directly against the pure write/install path in
# handoff_lib_test_runner.bb (install-handoff! with an injected write-fn!
# that installs nothing; atomic-write! with injected adapters proving write
# happens before sync happens before rename) - swarm_handoff.bb's own
# write-handoff! is a thin wrapper over exactly that shared, already-proven
# path (BL-365 uses handoff-lib/install-handoff! verbatim), so re-deriving
# the same proof through the full CLI here would just re-test the same
# logic through a heavier, less direct seam.

echo "ALL PASS"
