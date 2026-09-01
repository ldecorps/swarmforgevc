#!/usr/bin/env bash
# BL-1313: dedicated coverage for swarm_handoff.bb's inbound-non-forwarding?
# when the non-forwarding inbound sits INSIDE a batch directory (cleaner /
# hardender shape). Mirrors the flat-file coverage in
# test_swarm_handoff_inbound_non_forwarding.sh.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARM_HANDOFF="$SCRIPT_DIR/../swarm_handoff.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
cleanup() { rm -rf "$ROOT"; }
trap cleanup EXIT

git -C "$ROOT" init -q
git -C "$ROOT" config user.email "test@test"
git -C "$ROOT" config user.name "test"
echo x > "$ROOT/f.txt"
git -C "$ROOT" add f.txt
git -C "$ROOT" commit -q -m "seed"
COMMIT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

CLEANER_WT="$ROOT/.worktrees/cleaner"
MASTER_WT="$ROOT"
mkdir -p "$MASTER_WT/.swarmforge/handoffs/coordinator/"{outbox,tmp,sent,inbox/in_process} \
         "$CLEANER_WT/.swarmforge/handoffs/inbox/new"
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$MASTER_WT" > "$ROOT/.swarmforge/roles.tsv"
printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$CLEANER_WT" >> "$ROOT/.swarmforge/roles.tsv"
printf 'coder\tcoder\t%s/.worktrees/coder\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"

DRAFT="$ROOT/draft.handoff"
cat > "$DRAFT" <<DRAFT_EOF
type: git_handoff
to: coder
priority: 50
task: bl1313-batch-inbound-non-forwarding-test
commit: $COMMIT
DRAFT_EOF

run_send() {
  (
    cd "$CLEANER_WT"
    export SWARMFORGE_ROLE=cleaner
    export SWARMFORGE_SKIP_DAEMON=1
    bb "$SWARM_HANDOFF" "$DRAFT"
  )
}

BATCH_DIR="$CLEANER_WT/.swarmforge/handoffs/inbox/in_process/batch_20260901T000000Z_000001"
mkdir -p "$BATCH_DIR"

cat > "$BATCH_DIR/00_non_forwarding_in_batch.handoff" <<'HANDOFF_EOF'
id: x
from: architect
to: cleaner
priority: 00
type: git_handoff
task: some-other-ticket
commit: aaaaaaaaaa
non-forwarding: true

body
HANDOFF_EOF

set +e
out1="$(run_send 2>&1)"
rc1=$?
set -e
if [[ "$rc1" -ne 1 ]]; then
  fail "non-forwarding in batch dir: expected exit 1, got $rc1: $out1"
fi
if ! echo "$out1" | grep -q "Current inbound handoff is non-forwarding"; then
  fail "non-forwarding in batch dir: missing refusal message: $out1"
fi
pass "a non-forwarding inbound inside a batch dir blocks the forward"

echo "ALL PASS"
