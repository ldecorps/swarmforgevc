#!/usr/bin/env bash
# BL-373: proves sync_worktree_scripts() (swarmforge.sh) against a REAL
# throwaway git fixture repo with a real role worktree - per the ticket's
# own testing note, the whole defect lives in the gap between "the file
# exists" and "git tracks the file", which only a real index can tell you,
# never a mock. The pure should-copy? decision is unit-tested directly in
# sync_worktree_scripts_lib_test_runner.bb; this file proves the real
# git-tracked-vs-not wiring end to end. Reproduces the phantom revert on
# demand (a role branch merges a script change master doesn't have; a
# relaunch's sync must not erase it) - that reproduction IS the regression
# test (BL-373's own E2E QA procedure, mirrored here without a live launch).
#
# The fixture carries its OWN copy of swarmforge.sh + sync_worktree_scripts
# (.bb/_lib.bb) rather than sourcing this real repo's live copy: swarmforge.sh
# resolves its sync SOURCE directory from ITS OWN physical location
# (dirname "$0"), not from the WORKING_DIR argument, so sourcing the real
# repo's script while pointing WORKING_DIR at a small throwaway fixture
# would copy this real repo's entire (large) scripts directory into the
# fixture - unrepresentative of a real relaunch, where source and
# destination worktrees share the same tracked file set.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL_SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

git_c() { git -c user.email=t@t -c user.name=t "$@"; }

mk_master_fixture() {
  # A full copy of this repo's REAL swarmforge/scripts/, not a hand-picked
  # subset: swarmforge.sh sources several other scripts unconditionally at
  # PARSE time (before the ZSH_EVAL_CONTEXT guard that skips real-launch
  # side effects), so a partial fixture chases a cascade of "no such file"
  # errors one dependency at a time. This also matches production reality
  # more closely - a real role worktree's scripts dir is a full git
  # checkout of the same tracked set the launching checkout has, not a
  # skeleton.
  local root="$1"
  mkdir -p "$root/swarmforge/roles" "$root/swarmforge/profiles" "$root/.swarmforge"
  touch "$root/swarmforge/constitution.prompt"
  echo "role prompt" > "$root/swarmforge/roles/coder.prompt"
  echo "role prompt" > "$root/swarmforge/roles/specifier.prompt"
  cp -R "$REAL_SCRIPTS_DIR" "$root/swarmforge/scripts"
  rm -rf "$root/swarmforge/scripts/test"
  echo "master's foo body" > "$root/swarmforge/scripts/foo.bb"
  echo "profile body" > "$root/swarmforge/profiles/default.conf"
  cat > "$root/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window specifier claude master --model x
window coder claude coder --model x
CONF
  printf '.swarmforge/\n' > "$root/.gitignore"
}

# ═══════════════════════════════════════════════════════════════════════════
# Fixture: a real repo tracking swarmforge/scripts + profiles, with one
# role worktree that has merged a script change master does not have yet -
# the exact condition that produced the phantom revert.
# ═══════════════════════════════════════════════════════════════════════════

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

mk_master_fixture "$ROOT"
(cd "$ROOT" && git init -q && git_c add -A && git_c commit -q -m init)
(cd "$ROOT" && git worktree add -q -b coder .worktrees/coder)

# The role branch merges a script change master does NOT have yet - the
# exact condition BL-373's incident report verified on disk for BL-365.
echo "coder branch's MERGED fix, not yet on main" > "$ROOT/.worktrees/coder/swarmforge/scripts/foo.bb"
(cd "$ROOT/.worktrees/coder" && git_c add -A && git_c commit -q -m "coder: merge a script fix")

# Fake the runtime-state files sync_worktree_scripts() also delivers
# (gitignored .swarmforge/ - never touched by the tracked-path guard),
# without needing a real tmux launch.
echo "fake-sessions" > "$ROOT/.swarmforge/sessions.tsv"
echo "fake-roles" > "$ROOT/.swarmforge/roles.tsv"
echo "fake-socket" > "$ROOT/.swarmforge/tmux-socket"
echo "fake-env" > "$ROOT/.swarmforge/tmux-env"

BEFORE_FOO="$(cat "$ROOT/.worktrees/coder/swarmforge/scripts/foo.bb")"

# ═══════════════════════════════════════════════════════════════════════════
# Run the REAL sync function (the fixture's OWN swarmforge.sh copy,
# sourced - BL-089's own ZSH_EVAL_CONTEXT guard skips tmux/git/real-launch
# side effects).
# ═══════════════════════════════════════════════════════════════════════════

SYNC_OUTPUT="$(zsh -c "source '$ROOT/swarmforge/scripts/swarmforge.sh' '$ROOT'; parse_config; sync_worktree_scripts" 2>&1)"

# ── Scenario 01/02: a tracked path with local, not-yet-on-main content
#    survives the sync unmodified ──────────────────────────────────────────
AFTER_FOO="$(cat "$ROOT/.worktrees/coder/swarmforge/scripts/foo.bb")"
[[ "$AFTER_FOO" == "$BEFORE_FOO" ]] \
  || fail "01: expected the role branch's merged, tracked foo.bb to survive the sync unmodified; before=[$BEFORE_FOO] after=[$AFTER_FOO]"
pass "01/02: a git-tracked script with local not-yet-on-main content is left untouched by the sync - the phantom revert cannot reproduce"

STATUS_OUT="$(cd "$ROOT/.worktrees/coder" && git_c status --short)"
[[ -z "$STATUS_OUT" ]] \
  || fail "01/02: expected the role worktree to report no uncommitted changes after the sync, got: $STATUS_OUT"
pass "01/02: the role worktree reports no uncommitted changes after the sync"

# ── Scenario 04: runtime state is still delivered ───────────────────────
[[ "$(cat "$ROOT/.worktrees/coder/.swarmforge/sessions.tsv")" == "fake-sessions" ]] \
  || fail "04: expected sessions.tsv to still be delivered to the role worktree"
[[ "$(cat "$ROOT/.worktrees/coder/.swarmforge/roles.tsv")" == "fake-roles" ]] \
  || fail "04: expected roles.tsv to still be delivered to the role worktree"
[[ "$(cat "$ROOT/.worktrees/coder/.swarmforge/tmux-socket")" == "fake-socket" ]] \
  || fail "04: expected tmux-socket to still be delivered to the role worktree"
[[ "$(cat "$ROOT/.worktrees/coder/.swarmforge/tmux-env")" == "fake-env" ]] \
  || fail "04: expected tmux-env to still be delivered to the role worktree"
pass "04: local runtime state (.swarmforge/) is still delivered to every role worktree"

# ── Scenario 05: the sync says what it left to git, never silent ────────
echo "$SYNC_OUTPUT" | grep -q "left to git (tracked): swarmforge/scripts/foo.bb" \
  || fail "05: expected the sync to report leaving the tracked foo.bb to git, got: $SYNC_OUTPUT"
pass "05: a sync that declines to overwrite a tracked path says so"

# ═══════════════════════════════════════════════════════════════════════════
# Scenario 03: a target repo that does NOT track swarmforge/ still gets the
# scripts copied in (the sync is not gratuitous - a foreign target needs
# this to be runnable at all).
# ═══════════════════════════════════════════════════════════════════════════

FOREIGN_ROOT="$(mktemp -d)"
mk_master_fixture "$FOREIGN_ROOT"
(cd "$FOREIGN_ROOT" && git init -q && printf 'swarmforge/\n.swarmforge/\n' > .gitignore && git_c add -A -- .gitignore && git_c commit -q -m init)
(cd "$FOREIGN_ROOT" && git worktree add -q -b coder .worktrees/coder)
rm -rf "$FOREIGN_ROOT/.worktrees/coder/swarmforge/scripts"
mkdir -p "$FOREIGN_ROOT/.swarmforge"
echo "fake-sessions" > "$FOREIGN_ROOT/.swarmforge/sessions.tsv"
echo "fake-roles" > "$FOREIGN_ROOT/.swarmforge/roles.tsv"
echo "fake-socket" > "$FOREIGN_ROOT/.swarmforge/tmux-socket"
echo "fake-env" > "$FOREIGN_ROOT/.swarmforge/tmux-env"

zsh -c "source '$FOREIGN_ROOT/swarmforge/scripts/swarmforge.sh' '$FOREIGN_ROOT'; parse_config; sync_worktree_scripts" >/tmp/bl373-foreign.out 2>&1 || true

[[ -f "$FOREIGN_ROOT/.worktrees/coder/swarmforge/scripts/foo.bb" ]] \
  || fail "03: expected a target repo that does not track swarmforge/ to still receive the scripts, got: $(ls "$FOREIGN_ROOT/.worktrees/coder/swarmforge/scripts" 2>&1) / sync output: $(cat /tmp/bl373-foreign.out)"
pass "03: a target repository that does not git-track the swarm scripts still receives them"

rm -rf "$FOREIGN_ROOT"

echo "ALL PASS"
