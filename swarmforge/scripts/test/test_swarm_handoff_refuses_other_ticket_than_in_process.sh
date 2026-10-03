#!/usr/bin/env bash
# Hotfix 2026-10-03: swarm_handoff.sh refuses a git_handoff whose task names
# a ticket other than the sender's in-process parcel, before the self-audit
# challenge and before any mailbox write. The incident: the coder held QA's
# BL-1916 bounce and sent a tmp/handoff.txt left from BL-1858 (its audit
# challenge answered in an earlier session), which reached the hardender.
# The in-process ticket's own forward, and a seat holding a note that names
# no Work ticket, are unaffected.

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

CODER_WT="$ROOT/.worktrees/coder"
ARCHITECT_WT="$ROOT/.worktrees/architect"
mkdir -p "$CODER_WT/.swarmforge/handoffs/"{outbox/tmp,sent,inbox/new,inbox/in_process} \
         "$ARCHITECT_WT/.swarmforge/handoffs/inbox/new"
mkdir -p "$ROOT/.swarmforge"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" > "$ROOT/.swarmforge/roles.tsv"
printf 'architect\tarchitect\t%s\tswarmforge-architect\tArchitect\tclaude\ttask\n' "$ARCHITECT_WT" >> "$ROOT/.swarmforge/roles.tsv"

IN_PROCESS="$CODER_WT/.swarmforge/handoffs/inbox/in_process"
ARCH_NEW="$ARCHITECT_WT/.swarmforge/handoffs/inbox/new"

# Mailbox-only delivery, never tmux (test_swarm_handoff_refuses_coordinator_git_handoff.sh).
run_send() {
  local draft="$1"
  (
    cd "$ROOT"
    export SWARMFORGE_ROLE=coder
    export SWARMFORGE_MAILBOX_ONLY=1
    unset SWARMFORGE_SKIP_DAEMON
    bb "$SWARM_HANDOFF" "$draft"
  )
}

empty_dir() { [[ -z "$(ls -A "$1" 2>/dev/null)" ]]; }

hold_in_process() {
  rm -f "$IN_PROCESS"/*.handoff
  cat > "$IN_PROCESS/00_20261003T122550Z_000001_from_QA_to_coder_for_coder.handoff" <<EOF
id: 20261003T122550Z_000001_from_QA
from: QA
to: coder
recipient: coder
priority: 00
type: $1
$2

body
EOF
}

write_draft() {
  cat > "$1" <<EOF
type: git_handoff
to: architect
priority: 50
task: $2
commit: $COMMIT
EOF
}

# ── 01: a draft for another ticket than the in-process bounce is refused ──
hold_in_process git_handoff "task: BL-9001 [behavior: evidence is template text]
commit: $COMMIT"
DRAFT1="$ROOT/draft1.handoff"
write_draft "$DRAFT1" "BL-9002"
set +e
out1="$(run_send "$DRAFT1" 2>&1)"
rc1=$?
set -e
[[ "$rc1" -ne 0 ]] || fail "other-ticket: expected non-zero exit, got $rc1: $out1"
echo "$out1" | grep "IN_PROCESS_TICKET_MISMATCH: this git_handoff names BL-9002, but your in-process parcel is BL-9001" >/dev/null \
  || fail "other-ticket: refusal does not name both tickets: $out1"
echo "$out1" | grep "AUDIT_REQUIRED" >/dev/null \
  && fail "other-ticket: AUDIT_REQUIRED printed - refusal ran too late: $out1"
empty_dir "$ARCH_NEW" || fail "other-ticket: architect inbox/new is not empty: $(ls -A "$ARCH_NEW")"
[[ -f "$DRAFT1" ]] || fail "other-ticket: draft was consumed on a refused send"
pass "a git_handoff naming another ticket than the in-process parcel is refused before any mailbox write"

# ── 02: the same refusal for a coordinator Work note of another ticket ────
hold_in_process note "message: Work BL-9003: merge main first, then read backlog/active"
set +e
out2="$(run_send "$DRAFT1" 2>&1)"
rc2=$?
set -e
[[ "$rc2" -ne 0 ]] || fail "work-note: expected non-zero exit, got $rc2: $out2"
echo "$out2" | grep "names BL-9002, but your in-process parcel is BL-9003" >/dev/null \
  || fail "work-note: refusal does not name the Work note's ticket: $out2"
pass "a git_handoff naming another ticket than the in-process Work note is refused"

# ── 03: the in-process ticket's own forward passes the guard and queues ───
hold_in_process git_handoff "task: BL-9001 [behavior: evidence is template text]
commit: $COMMIT"
DRAFT3="$ROOT/draft3.handoff"
write_draft "$DRAFT3" "BL-9001"
set +e
out3a="$(run_send "$DRAFT3" 2>&1)"
out3b="$(run_send "$DRAFT3" 2>&1)"
rc3b=$?
set -e
echo "$out3a$out3b" | grep "IN_PROCESS_TICKET_MISMATCH" >/dev/null \
  && fail "own-ticket: wrongly refused by the in-process guard: $out3a $out3b"
[[ "$rc3b" -eq 0 ]] || fail "own-ticket (call 2): expected the send to queue, got exit $rc3b: $out3b"
[[ -f "$DRAFT3" ]] && fail "own-ticket (call 2): draft was not consumed - send did not go through: $out3b"
pass "the in-process ticket's own git_handoff passes the guard and queues"

# ── 04: a held note that names no Work ticket allows any forward ──────────
hold_in_process note "message: branch behind $COMMIT: merge up"
DRAFT4="$ROOT/draft4.handoff"
write_draft "$DRAFT4" "BL-9004"
set +e
out4a="$(run_send "$DRAFT4" 2>&1)"
out4b="$(run_send "$DRAFT4" 2>&1)"
rc4b=$?
set -e
echo "$out4a$out4b" | grep "IN_PROCESS_TICKET_MISMATCH" >/dev/null \
  && fail "plain-note: wrongly refused: $out4a $out4b"
[[ "$rc4b" -eq 0 ]] || fail "plain-note (call 2): expected the send to queue, got exit $rc4b: $out4b"
pass "a seat holding a note that names no Work ticket is not refused"

echo "ALL PASS"
