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
FOREIGN_ROOT=""
AMBIENT_ROOT=""
trap 'rm -rf "$ROOT" "$FOREIGN_ROOT" "$AMBIENT_ROOT"' EXIT

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

FOREIGN_SYNC_OUT="$FOREIGN_ROOT/sync.out"
zsh -c "source '$FOREIGN_ROOT/swarmforge/scripts/swarmforge.sh' '$FOREIGN_ROOT'; parse_config; sync_worktree_scripts" >"$FOREIGN_SYNC_OUT" 2>&1 || true

[[ -f "$FOREIGN_ROOT/.worktrees/coder/swarmforge/scripts/foo.bb" ]] \
  || fail "03: expected a target repo that does not track swarmforge/ to still receive the scripts, got: $(ls "$FOREIGN_ROOT/.worktrees/coder/swarmforge/scripts" 2>&1) / sync output: $(cat "$FOREIGN_SYNC_OUT")"
pass "03: a target repository that does not git-track the swarm scripts still receives them"

# ═══════════════════════════════════════════════════════════════════════════
# BL-1233: an ambient GIT_DIR/GIT_WORK_TREE in the launching process's own
# environment must not defeat the guard. Reproduces the live incident
# measured against this real repo (main vs .worktrees/cleaner): `-C` does
# NOT override GIT_DIR/GIT_WORK_TREE, so an unscrubbed query answers for
# the AMBIENT repo instead of the destination worktree.
# ═══════════════════════════════════════════════════════════════════════════

AMBIENT_ROOT="$(mktemp -d)"
mk_master_fixture "$AMBIENT_ROOT"
(cd "$AMBIENT_ROOT" && git init -q && git_c add -A && git_c commit -q -m init)
(cd "$AMBIENT_ROOT" && git worktree add -q -b coder .worktrees/coder)
echo "coder branch's MERGED fix, not yet on main" > "$AMBIENT_ROOT/.worktrees/coder/swarmforge/scripts/foo.bb"
(cd "$AMBIENT_ROOT/.worktrees/coder" && git_c add -A && git_c commit -q -m "coder: merge a script fix")
BEFORE_AMBIENT_FOO="$(cat "$AMBIENT_ROOT/.worktrees/coder/swarmforge/scripts/foo.bb")"

# Sanity: confirm the raw ambient leak actually defeats an unscrubbed query
# in THIS fixture too, so a passing test below is not vacuous.
RAW_LEAKED_TRACKED="$(GIT_DIR="$AMBIENT_ROOT/.git" GIT_WORK_TREE="$AMBIENT_ROOT" \
  git -C "$AMBIENT_ROOT/.worktrees/coder" ls-files -- swarmforge/scripts | wc -l | tr -d ' ')"
[[ "$RAW_LEAKED_TRACKED" == "0" ]] \
  || fail "1233-sanity: expected the raw ambient leak to blind an unscrubbed ls-files (got $RAW_LEAKED_TRACKED tracked paths) - fixture does not reproduce the incident"
pass "1233-sanity: the raw ambient leak reproduces in this fixture (0 tracked paths seen)"

# Scenario: launch with GIT_DIR/GIT_WORK_TREE pointing at the fixture's own
# master root (the real incident's shape - a hook/shell environment that
# leaked the launching checkout's git vars) while syncing into the coder
# worktree. The merged, tracked foo.bb must still survive.
AMBIENT_SYNC_OUT="$AMBIENT_ROOT/ambient-sync.out"
GIT_DIR="$AMBIENT_ROOT/.git" GIT_WORK_TREE="$AMBIENT_ROOT" bb \
  "$REAL_SCRIPTS_DIR/sync_worktree_scripts.bb" \
  "$AMBIENT_ROOT/swarmforge/scripts" \
  "$AMBIENT_ROOT/.worktrees/coder/swarmforge/scripts" \
  "$AMBIENT_ROOT/.worktrees/coder" \
  "swarmforge/scripts" >"$AMBIENT_SYNC_OUT" 2>&1
AMBIENT_EXIT=$?
AFTER_AMBIENT_FOO="$(cat "$AMBIENT_ROOT/.worktrees/coder/swarmforge/scripts/foo.bb")"

[[ "$AMBIENT_EXIT" -eq 0 ]] \
  || fail "1233: expected the sync to succeed under an ambient env leak once scrubbed, exit=$AMBIENT_EXIT, output: $(cat "$AMBIENT_SYNC_OUT")"
[[ "$AFTER_AMBIENT_FOO" == "$BEFORE_AMBIENT_FOO" ]] \
  || fail "1233: expected the coder branch's merged, tracked foo.bb to survive a sync run under an ambient GIT_DIR/GIT_WORK_TREE leak; before=[$BEFORE_AMBIENT_FOO] after=[$AFTER_AMBIENT_FOO]"
pass "1233: a git-tracked script survives the sync even with GIT_DIR/GIT_WORK_TREE ambient in the launcher's own environment"

grep -q "left to git (tracked): swarmforge/scripts/foo.bb" "$AMBIENT_SYNC_OUT" \
  || fail "1233: expected the sync to report leaving the tracked foo.bb to git even under the ambient leak, got: $(cat "$AMBIENT_SYNC_OUT")"
pass "1233: the sync still reports what it left to git under the ambient leak (never silently right)"

# Scenario: git resolves a genuinely DIFFERENT top-level than the
# worktree-root argument named - no ambient env needed here, since the scrub
# already neutralizes that vector end to end (proven above). This is the
# "next vector" the backstop defends against: the CALLER passes a
# subdirectory of the coder worktree instead of its true root. `-C` on a
# subdirectory still correctly climbs to the real top-level, which is then
# a real, different, resolvable path from the one asked about - the guard
# must catch this the same way it catches an ambient-env leak.
MISMATCH_SYNC_OUT="$AMBIENT_ROOT/mismatch-sync.out"
set +e
bb "$REAL_SCRIPTS_DIR/sync_worktree_scripts.bb" \
  "$AMBIENT_ROOT/swarmforge/scripts" \
  "$AMBIENT_ROOT/.worktrees/coder/swarmforge/scripts" \
  "$AMBIENT_ROOT/.worktrees/coder/swarmforge" \
  "swarmforge/scripts" >"$MISMATCH_SYNC_OUT" 2>&1
MISMATCH_EXIT=$?
set -e
AFTER_MISMATCH_FOO="$(cat "$AMBIENT_ROOT/.worktrees/coder/swarmforge/scripts/foo.bb")"

[[ "$MISMATCH_EXIT" -ne 0 ]] \
  || fail "1233: expected the sync to REFUSE (non-zero exit) when git resolves a different top-level than the destination, got exit 0: $(cat "$MISMATCH_SYNC_OUT")"
grep -q "REFUSE" "$MISMATCH_SYNC_OUT" \
  || fail "1233: expected a loud REFUSE naming the mismatch, got: $(cat "$MISMATCH_SYNC_OUT")"
[[ "$AFTER_MISMATCH_FOO" == "$BEFORE_AMBIENT_FOO" ]] \
  || fail "1233: expected NOTHING to be copied on refusal; foo.bb changed to [$AFTER_MISMATCH_FOO]"
pass "1233: a resolved-but-wrong top-level refuses loudly and copies nothing"

echo "ALL PASS"
