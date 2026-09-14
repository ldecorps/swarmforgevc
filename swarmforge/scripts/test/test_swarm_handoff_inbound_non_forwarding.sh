#!/usr/bin/env bash
# BL-1302 hardener: dedicated coverage for swarm_handoff.bb's
# inbound-non-forwarding? — until this test, no test anywhere exercised that
# function's actual behavior (only handoff-lib/non-forwarding? and the
# duplicate-chain guard were unit-tested). It gates the Article 2.4 refusal
# ("Current inbound handoff is non-forwarding ... do not send a git_handoff")
# and is a `some` over every file in the sender's OWN in_process — a shape a
# hand-authored mutation sweep found had zero regression coverage: mutating
# `some` to `every?` survived every existing test, including both TDD suites
# for this ticket, because none of them ever populate in_process with more
# than one file.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARM_HANDOFF="$SCRIPT_DIR/../swarm_handoff.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" config user.email "test@test"
git -C "$ROOT" config user.name "test"
echo x > "$ROOT/f.txt"
git -C "$ROOT" add f.txt
git -C "$ROOT" commit -q -m "seed"
COMMIT="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

MASTER_WT="$ROOT"
CODER_WT="$ROOT/.worktrees/coder"
mkdir -p "$MASTER_WT/.swarmforge/handoffs/coordinator/"{outbox/tmp,sent,inbox/in_process} \
         "$CODER_WT/.swarmforge/handoffs/inbox/new"
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$MASTER_WT" > "$ROOT/.swarmforge/roles.tsv"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" >> "$ROOT/.swarmforge/roles.tsv"

DRAFT="$ROOT/draft.handoff"
cat > "$DRAFT" <<EOF
type: git_handoff
to: coder
priority: 50
task: bl1302-inbound-non-forwarding-test
commit: $COMMIT
EOF

run_send() {
  (
    cd "$ROOT"
    export SWARMFORGE_ROLE=coordinator
    export SWARMFORGE_SKIP_DAEMON=1
    bb "$SWARM_HANDOFF" "$DRAFT"
  )
}

IN_PROCESS="$MASTER_WT/.swarmforge/handoffs/coordinator/inbox/in_process"

# ── 01: a lone non-forwarding inbound blocks (sanity — this direction was
#        already covered before this test) ─────────────────────────────────
cat > "$IN_PROCESS/00_lone_non_forwarding.handoff" <<'EOF'
id: x
from: architect
to: coordinator
priority: 00
type: git_handoff
task: some-other-ticket
commit: aaaaaaaaaa
non-forwarding: true

body
EOF

set +e
out1="$(run_send 2>&1)"
rc1=$?
set -e
[[ "$rc1" -eq 1 ]] || fail "lone non-forwarding inbound: expected exit 1, got $rc1: $out1"
echo "$out1" | grep -q "Current inbound handoff is non-forwarding" \
  || fail "lone non-forwarding inbound: missing refusal message: $out1"
pass "a lone non-forwarding inbound blocks the forward"

# ── 02: THE mutant-discriminating case — a non-forwarding inbound sitting
#        ALONGSIDE an ordinary forwardable inbound must still block. `some`
#        (correct) sees the non-forwarding file and refuses; `every?`
#        (the surviving mutant) sees the ordinary file fails the predicate
#        and wrongly allows the send. ─────────────────────────────────────
cat > "$IN_PROCESS/01_ordinary_forwardable.handoff" <<'EOF'
id: y
from: architect
to: coordinator
priority: 00
type: git_handoff
task: yet-another-ticket
commit: bbbbbbbbbb

body
EOF

set +e
out2="$(run_send 2>&1)"
rc2=$?
set -e
[[ "$rc2" -eq 1 ]] || fail "mixed in_process (non-forwarding + ordinary): expected exit 1, got $rc2: $out2"
echo "$out2" | grep -q "Current inbound handoff is non-forwarding" \
  || fail "mixed in_process: missing refusal message: $out2"
pass "a non-forwarding inbound still blocks alongside an ordinary forwardable inbound"

# ── 03: with the non-forwarding inbound cleared, only the ordinary one
#        remains — the send must now be ALLOWED (both `some` and the
#        `every?` mutant agree here — the discriminator is 02, not this).
#        A git_handoff send runs the two-call self-audit (Article 2.3,
#        BL-1529): the first call always challenges (AUDIT_REQUIRED /
#        HANDOFF_NOT_QUEUED) and queues nothing, whatever exit convention
#        it uses; the identical second call queues. run_send's
#        SWARMFORGE_SKIP_DAEMON=1 (fine for cases 01/02, which refuse
#        before delivery is ever reached) turns any sync-inject failure
#        fatal on a call that actually reaches delivery, and this fixture
#        creates no .swarmforge/tmux-socket - use the established
#        mailbox-only escape instead (test_mailbox_only_delivery.sh /
#        BL-1565's pattern: SWARMFORGE_MAILBOX_ONLY=1 with
#        SWARMFORGE_SKIP_DAEMON unset).
rm -f "$IN_PROCESS/00_lone_non_forwarding.handoff"

run_send_queue() {
  (
    cd "$ROOT"
    export SWARMFORGE_ROLE=coordinator
    export SWARMFORGE_MAILBOX_ONLY=1
    unset SWARMFORGE_SKIP_DAEMON
    bb "$SWARM_HANDOFF" "$DRAFT"
  )
}

OUTBOX="$MASTER_WT/.swarmforge/handoffs/coordinator/outbox"
outbox_count() { find "$OUTBOX" -maxdepth 1 -name '*.handoff' 2>/dev/null | wc -l | tr -d ' '; }

set +e
out3a="$(run_send_queue 2>&1)"
set -e
echo "$out3a" | grep -q "Current inbound handoff is non-forwarding" \
  && fail "ordinary-only in_process (call 1): send wrongly refused: $out3a"
echo "$out3a" | grep -q "AUDIT_REQUIRED" \
  || fail "ordinary-only in_process (call 1): expected the audit challenge: $out3a"
[[ "$(outbox_count)" == "0" ]] || fail "ordinary-only in_process (call 1): the audit challenge call queued a handoff"

set +e
out3b="$(run_send_queue 2>&1)"
rc3b=$?
set -e
echo "$out3b" | grep -q "Current inbound handoff is non-forwarding" \
  && fail "ordinary-only in_process (call 2): send wrongly refused: $out3b"
[[ "$rc3b" -eq 0 ]] || fail "ordinary-only in_process (call 2): expected exit 0, got $rc3b: $out3b"
echo "$out3b" | grep -q "HANDOFF QUEUED (mailbox only, no tmux inject):" \
  || fail "ordinary-only in_process (call 2): missing mailbox-only queue message: $out3b"
[[ "$(outbox_count)" == "1" ]] || fail "ordinary-only in_process (call 2): handoff did not land in the outbox"
pass "an ordinary (non-marked) inbound alone does not block the forward"

echo "ALL PASS"
