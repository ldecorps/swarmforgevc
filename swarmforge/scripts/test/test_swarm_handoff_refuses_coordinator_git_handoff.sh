#!/usr/bin/env bash
# BL-1565: the mailbox-level end-to-end assertion. swarm_handoff.sh must
# refuse a git_handoff naming the coordinator among its recipients BEFORE
# the self-audit challenge and before any mailbox write - exit non-zero, no
# AUDIT_REQUIRED, nothing under the coordinator's inbox/new/. A note to the
# coordinator, and a git_handoff to any other role, are unaffected.

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
QA_WT="$ROOT/.worktrees/QA"
ARCHITECT_WT="$ROOT/.worktrees/architect"
mkdir -p "$MASTER_WT/.swarmforge/handoffs/coordinator/"{outbox/tmp,sent,inbox/new,inbox/in_process} \
         "$QA_WT/.swarmforge/handoffs/outbox/tmp" \
         "$QA_WT/.swarmforge/handoffs/sent" \
         "$ARCHITECT_WT/.swarmforge/handoffs/inbox/new"
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$MASTER_WT" > "$ROOT/.swarmforge/roles.tsv"
printf 'QA\tQA\t%s\tswarmforge-QA\tQA\tclaude\ttask\n' "$QA_WT" >> "$ROOT/.swarmforge/roles.tsv"
printf 'architect\tarchitect\t%s\tswarmforge-architect\tArchitect\tclaude\ttask\n' "$ARCHITECT_WT" >> "$ROOT/.swarmforge/roles.tsv"

COORD_INBOX_NEW="$MASTER_WT/.swarmforge/handoffs/coordinator/inbox/new"

# BL-1565 evidence (backlog/evidence/BL-1565-unowned-red-swarm-handoff-inbound-non-forwarding-20260914.md):
# SWARMFORGE_SKIP_DAEMON=1 turns ANY sync-inject failure fatal, and this
# fixture creates no .swarmforge/tmux-socket, so a real send would always
# throw "tmux socket file missing" and exit 1 under SKIP_DAEMON. Use the
# established mailbox-only escape (test_mailbox_only_delivery.sh's pattern)
# instead: SWARMFORGE_MAILBOX_ONLY=1 with SWARMFORGE_SKIP_DAEMON left unset
# routes through the :skipped sync-result, never touching tmux at all.
run_send() {
  local role="$1" draft="$2"
  (
    cd "$ROOT"
    export SWARMFORGE_ROLE="$role"
    export SWARMFORGE_MAILBOX_ONLY=1
    unset SWARMFORGE_SKIP_DAEMON
    bb "$SWARM_HANDOFF" "$draft"
  )
}

empty_dir() {
  [[ -z "$(ls -A "$1" 2>/dev/null)" ]]
}

# ── 01: a git_handoff to the coordinator ALONE is refused ──────────────────
DRAFT1="$ROOT/draft1.handoff"
cat > "$DRAFT1" <<EOF
type: git_handoff
to: coordinator
priority: 00
task: bl1565-recipient-guard-test-1
commit: $COMMIT
EOF

set +e
out1="$(run_send QA "$DRAFT1" 2>&1)"
rc1=$?
set -e
[[ "$rc1" -ne 0 ]] || fail "coordinator-alone: expected non-zero exit, got $rc1: $out1"
echo "$out1" | grep -q "type: note" \
  || fail "coordinator-alone: missing close-note-type in message: $out1"
echo "$out1" | grep -q "QA-approved <task> landed <sha> - bookkeep to done" \
  || fail "coordinator-alone: missing close-note-shape in message: $out1"
echo "$out1" | grep -q "AUDIT_REQUIRED" \
  && fail "coordinator-alone: AUDIT_REQUIRED printed - refusal ran too late: $out1"
empty_dir "$COORD_INBOX_NEW" \
  || fail "coordinator-alone: coordinator inbox/new is not empty: $(ls -A "$COORD_INBOX_NEW")"
[[ -f "$DRAFT1" ]] || fail "coordinator-alone: draft was consumed on a refused send"
pass "a git_handoff addressed to the coordinator alone is refused before any mailbox write"

# ── 02: coordinator buried among OTHER recipients is still refused ─────────
DRAFT2="$ROOT/draft2.handoff"
cat > "$DRAFT2" <<EOF
type: git_handoff
to: architect,coordinator
priority: 00
task: bl1565-recipient-guard-test-2
commit: $COMMIT
EOF

set +e
out2="$(run_send QA "$DRAFT2" 2>&1)"
rc2=$?
set -e
[[ "$rc2" -ne 0 ]] || fail "coordinator-among-others: expected non-zero exit, got $rc2: $out2"
echo "$out2" | grep -q "AUDIT_REQUIRED" \
  && fail "coordinator-among-others: AUDIT_REQUIRED printed: $out2"
empty_dir "$COORD_INBOX_NEW" \
  || fail "coordinator-among-others: coordinator inbox/new is not empty: $(ls -A "$COORD_INBOX_NEW")"
pass "a git_handoff naming the coordinator among other recipients is refused too"

# ── 03: a git_handoff to a role OTHER than the coordinator is unaffected ───
DRAFT3="$ROOT/draft3.handoff"
cat > "$DRAFT3" <<EOF
type: git_handoff
to: architect
priority: 50
task: bl1565-recipient-guard-test-3
commit: $COMMIT
EOF

# git_handoff sends run the two-call self-audit challenge (BL-1529) - the
# FIRST call always prints AUDIT_REQUIRED / HANDOFF_NOT_QUEUED and queues
# nothing, whatever the recipient. The point of this scenario is only that
# the coordinator guard never fires for architect-only recipients, on
# either call.
set +e
out3a="$(run_send QA "$DRAFT3" 2>&1)"
set -e
echo "$out3a" | grep -q "coordinator holds no code worktree" \
  && fail "architect-only (call 1): wrongly refused by the coordinator guard: $out3a"

set +e
out3b="$(run_send QA "$DRAFT3" 2>&1)"
rc3b=$?
set -e
echo "$out3b" | grep -q "coordinator holds no code worktree" \
  && fail "architect-only (call 2): wrongly refused by the coordinator guard: $out3b"
[[ "$rc3b" -eq 0 ]] || fail "architect-only (call 2): expected the send to queue, got exit $rc3b: $out3b"
[[ -f "$DRAFT3" ]] && fail "architect-only (call 2): draft was not consumed - send did not go through: $out3b"
pass "a git_handoff to a role other than the coordinator is not touched by this guard"

# ── 04: a note to the coordinator is unaffected (the sanctioned close shape) ─
DRAFT4="$ROOT/draft4.handoff"
cat > "$DRAFT4" <<EOF
type: note
to: coordinator
priority: 00
message: QA-approved bl1565-recipient-guard-test-1 landed $COMMIT - bookkeep
EOF

set +e
out4="$(run_send QA "$DRAFT4" 2>&1)"
rc4=$?
set -e
echo "$out4" | grep -q "coordinator holds no code worktree" \
  && fail "note-to-coordinator: wrongly refused by the git_handoff guard: $out4"
[[ "$rc4" -eq 0 ]] || fail "note-to-coordinator: expected exit 0, got $rc4: $out4"
[[ -f "$DRAFT4" ]] && fail "note-to-coordinator: draft was not consumed - send did not go through: $out4"
pass "a note addressed to the coordinator (the sanctioned close shape) is queued unchanged"

echo "ALL PASS"
