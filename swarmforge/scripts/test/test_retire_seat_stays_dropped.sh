#!/usr/bin/env bash
# BL-1720: a seat dropped mid-shift stays dropped. Drives the REAL
# retire_seat.sh (scenario 01), the REAL babysitter_check.sh (scenario 02),
# and the REAL reverse-hop-lib/reverse-recipients (scenario 03, via a thin
# probe - never a reimplementation of any of the three) against a REAL
# private tmux server (BL-1390's proof posture) - never a fake tmux binary.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RETIRE="$SCRIPT_DIR/../retire_seat.sh"
CHECK="$SCRIPT_DIR/../babysitter_check.sh"
PROBE="$SCRIPT_DIR/bl1720_reverse_hop_probe.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
SOCK="$ROOT/private.sock"
unset TMUX 2>/dev/null || true

cleanup() {
  tmux -S "$SOCK" kill-server 2>/dev/null || true
  rm -rf "$ROOT"
}
trap cleanup EXIT

WT_CODER="$ROOT/wt-coder"
WT_CODER2="$ROOT/wt-coder2"
WT_ARCHITECT="$ROOT/wt-architect"
mkdir -p "$ROOT/.swarmforge/launch" "$ROOT/backlog/active" \
  "$WT_CODER/.swarmforge" \
  "$WT_CODER2/.swarmforge/handoffs/inbox/new" \
  "$WT_ARCHITECT/.swarmforge"

echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

# roles.tsv order: coder, coder@2, architect - coder@2 sits BEFORE
# architect, so a back-all send from architect includes it before
# retirement (scenario 03's own non-vacuity: something must actually
# change).
write_roles() {
  local dest="$1"
  printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\toff\tforward-only\n' "$WT_CODER" > "$dest"
  printf 'coder@2\tcoder\t%s\tswarmforge-coder@2\tCoder2\tclaude\ttask\toff\tforward-only\n' "$WT_CODER2" >> "$dest"
  printf 'architect\tarchitect\t%s\tswarmforge-architect\tArchitect\tclaude\ttask\toff\tforward-only\n' "$WT_ARCHITECT" >> "$dest"
}
write_roles "$ROOT/.swarmforge/roles.tsv"
write_roles "$WT_CODER/.swarmforge/roles.tsv"
write_roles "$WT_CODER2/.swarmforge/roles.tsv"
write_roles "$WT_ARCHITECT/.swarmforge/roles.tsv"
printf '1\tcoder\tswarmforge-coder\tCoder\tclaude\n2\tcoder@2\tswarmforge-coder@2\tCoder2\tclaude\n3\tarchitect\tswarmforge-architect\tArchitect\tclaude\n' \
  > "$ROOT/.swarmforge/sessions.tsv"

touch "$WT_CODER2/.swarmforge/handoffs/inbox/new/stranded.handoff"

# A REAL private tmux server - coder, coder@2 and architect all have live
# sessions before retirement.
tmux -S "$SOCK" new-session -d -s swarmforge-coder -n agent 2>/dev/null
tmux -S "$SOCK" new-session -d -s swarmforge-coder@2 -n agent 2>/dev/null
tmux -S "$SOCK" new-session -d -s swarmforge-architect -n agent 2>/dev/null

# BL-1390 proof posture: the live repo's own tmux socket path never
# appears anywhere in this fixture.
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LIVE_SOCK_FILE="$REPO_ROOT/.swarmforge/tmux-socket"
if [[ -f "$LIVE_SOCK_FILE" ]]; then
  LIVE_SOCK="$(cat "$LIVE_SOCK_FILE" 2>/dev/null || true)"
  if [[ -n "$LIVE_SOCK" ]] && grep -RIl -F -- "$LIVE_SOCK" "$ROOT" >/dev/null 2>&1; then
    fail "the live tmux socket path ($LIVE_SOCK) leaked into the fixture"
  fi
fi
pass "the live tmux socket path never appears in the fixture"

# ── Scenario 01: retiring coder@2 removes it from every roster copy ──────
RETIRE_OUT="$(bash "$RETIRE" "$ROOT" coder@2)"

for f in "$ROOT/.swarmforge/roles.tsv" "$WT_CODER/.swarmforge/roles.tsv" "$WT_CODER2/.swarmforge/roles.tsv" "$WT_ARCHITECT/.swarmforge/roles.tsv"; do
  grep -q '^coder@2' "$f" && fail "01: $f still lists coder@2 after retirement"
done
pass "01: no roles.tsv, worktree copy included, lists coder@2"

# A negative-only check ("coder@2 is gone") cannot tell a surgical
# retirement from one that wiped the whole file: assert the SIBLING seat
# (coder, whose name coder@2 extends) survives in every copy too.
for f in "$ROOT/.swarmforge/roles.tsv" "$WT_CODER/.swarmforge/roles.tsv" "$WT_CODER2/.swarmforge/roles.tsv" "$WT_ARCHITECT/.swarmforge/roles.tsv"; do
  grep -qP '^coder\tcoder\t' "$f" || fail "01: $f lost the sibling seat 'coder' - retirement must be surgical, not wholesale"
done
pass "01: the sibling seat coder survives in every roles.tsv copy"

grep -q '^[0-9]\+\tcoder@2\t' "$ROOT/.swarmforge/sessions.tsv" \
  && fail "01: sessions.tsv still lists coder@2 after retirement"
pass "01: sessions.tsv no longer lists coder@2"

tmux -S "$SOCK" has-session -t swarmforge-coder@2 2>/dev/null \
  && fail "01: coder@2's tmux session still exists after retirement"
pass "01: coder@2's session is gone"

echo "$RETIRE_OUT" | grep -q "RETIRED_SEAT_MAILBOX_PARCEL:.*stranded.handoff" \
  || fail "01: expected the stranded parcel reported, got: $RETIRE_OUT"
pass "01: the retired seat's stranded mailbox parcel is reported"

[[ -d "$WT_CODER2" ]] || fail "01: coder@2's worktree was removed - it must be left in place"
pass "01: the retired seat's worktree, branch and mailbox are left in place"

# ── Scenario 02: the babysitter's sweep does not resurrect it ────────────
SWEEP_OUT="$(bash "$CHECK" "$ROOT" 2>&1 || true)"
if echo "$SWEEP_OUT" | grep -q "coder@2"; then
  fail "02: the babysitter sweep still names coder@2: $SWEEP_OUT"
fi
pass "02: the babysitter sweep names coder@2 nowhere - no session, no repair, no finding"

tmux -S "$SOCK" has-session -t swarmforge-coder@2 2>/dev/null \
  && fail "02: a session for coder@2 exists after the sweep"
pass "02: no session is created for coder@2"

# ── Scenario 03: a back-all send from architect addresses no copy to it ──
REVERSE_OUT="$(bb "$PROBE" "$WT_ARCHITECT/.swarmforge/roles.tsv" architect back-all)"
if echo "$REVERSE_OUT" | grep -qw "coder@2"; then
  fail "03: a back-all send from architect's worktree still addresses coder@2: $REVERSE_OUT"
fi
pass "03: no copy of a back-all send from architect's worktree is addressed to coder@2"

# ── Scenario 04: usage and an unknown seat (qa_e2e_procedure step 3) ─────
# Ticket's own explicit QA requirement, never exercised by scenarios 01-03
# (each names a seat that IS in the roster): the verb with no argument
# prints usage and exits non-zero; with an unknown seat it refuses naming
# it and changes no file.
set +e
NO_ARGS_OUT="$(bash "$RETIRE" 2>&1)"
NO_ARGS_STATUS=$?
set -e
[[ $NO_ARGS_STATUS -ne 0 ]] || fail "04: expected a non-zero exit with no arguments, got 0"
echo "$NO_ARGS_OUT" | grep -qi '^Usage:' || fail "04: expected a Usage: line with no arguments, got: $NO_ARGS_OUT"
pass "04: no arguments prints usage and exits non-zero"

ROLES_BEFORE_UNKNOWN="$(cat "$ROOT/.swarmforge/roles.tsv")"
SESSIONS_BEFORE_UNKNOWN="$(cat "$ROOT/.swarmforge/sessions.tsv")"
set +e
UNKNOWN_OUT="$(bash "$RETIRE" "$ROOT" nonexistent-seat 2>&1)"
UNKNOWN_STATUS=$?
set -e
[[ $UNKNOWN_STATUS -ne 0 ]] || fail "04: expected a non-zero exit for an unknown seat, got 0"
echo "$UNKNOWN_OUT" | grep -qi "unknown seat 'nonexistent-seat'" \
  || fail "04: expected the refusal to name the unknown seat, got: $UNKNOWN_OUT"
pass "04: an unknown seat is refused, naming it"

[[ "$(cat "$ROOT/.swarmforge/roles.tsv")" == "$ROLES_BEFORE_UNKNOWN" ]] \
  || fail "04: roles.tsv changed after refusing an unknown seat"
[[ "$(cat "$ROOT/.swarmforge/sessions.tsv")" == "$SESSIONS_BEFORE_UNKNOWN" ]] \
  || fail "04: sessions.tsv changed after refusing an unknown seat"
pass "04: an unknown seat's refusal changes no file"

echo "test_retire_seat_stays_dropped: ALL SCENARIOS PASSED"
