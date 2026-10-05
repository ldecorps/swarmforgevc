#!/usr/bin/env bash
# 2026-10-05: tmux resolves a bare `-t NAME` by PREFIX, so with only
# swarmforge-coder@2 alive `has-session -t swarmforge-coder` succeeded; the
# babysitter's repair and `swarm ensure` then respawned coder@2's pane with
# the iq3 coder's launch script (evidence
# backlog/evidence/session-repair-prefix-match-killed-coder2-20261005.md),
# twice that day, and reported the missing seat FIXED. Role-session presence
# checks now use tmux's exact-match target `=NAME`.
set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$(cd "$TEST_DIR/.." && pwd)"
source "$TEST_DIR/lib/tmp_cleanup.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
register_tmp_dir "$ROOT"
SOCK="$ROOT/t.sock"
cleanup_server() { tmux -S "$SOCK" kill-server 2>/dev/null || true; }
trap cleanup_server EXIT

# Only the @2 seat lives: its name has the bare seat's name as a prefix.
tmux -S "$SOCK" new-session -d -s 'sfx-coder@2' 'sleep 120'
tmux -S "$SOCK" has-session -t sfx-coder 2>/dev/null \
  || fail "precondition: this tmux no longer resolves -t by prefix; the hazard this test pins is gone"
pass "precondition: tmux resolves a bare -t by prefix"

out="$(bb -e "(load-file \"$SCRIPTS/handoff_lib.bb\") (prn (handoff-lib/session-exists? \"$SOCK\" \"sfx-coder\") (handoff-lib/session-exists? \"$SOCK\" \"sfx-coder@2\"))" 2>/dev/null | tail -1)"
[[ "$out" == "false true" ]] || fail "handoff-lib/session-exists? must be exact (expected 'false true'), got: $out"
pass "handoff-lib/session-exists? reads a missing seat as absent while its @2 sibling lives"

# The other presence predicates live in scripts that run a main on load, so
# their source is pinned instead: no role-session has-session / list-panes /
# kill-session with a bare session target.
for f in babysitter_check.bb swarm_ensure.bb swarm_status.bb handoff_lib.bb; do
  if grep -nE '"(has-session|kill-session)" "-t" session\)|"list-panes" "-t" session$' "$SCRIPTS/$f"; then
    fail "$f: a role-session tmux target is bare (prefix-resolved); use (str \"=\" session)"
  fi
done
for f in swarmforge.sh role_lifecycle.sh; do
  if grep -nE 'has-session -t \\?"\\?\$\{?(local_session|SESSIONS)' "$SCRIPTS/$f"; then
    fail "$f: a role-session has-session target is bare (prefix-resolved); use \"=\$name\""
  fi
done
pass "every role-session presence check, kill and pane listing uses an exact (=NAME) target"
echo "ALL PASS"
