#!/usr/bin/env bash
# BL-812: handoffd is invoked as `bb handoffd.bb <project-root>` but its
# process cwd is not guaranteed to be that root (observed live: launcher
# home dir). handoff_lib.bb's target-root used to shell `git rev-parse
# --git-common-dir` from cwd for every root-scoped read - roles.tsv,
# tmux-socket, launch scripts, the mono-router-active-role marker - so under
# a foreign cwd the resident looked absent, chase degraded to waking a
# session mono-router never creates, and the swarm starved. This drives the
# REAL handoff_lib.bb (via bl812_root_probe.bb, never a reimplementation)
# from a genuinely separate process with a foreign cwd, proving the fix:
# handoff-lib/set-project-root! makes every read cwd-invariant, and the
# regression guard (scenario 05) proves callers that never call it (e.g.
# rotate_to_role.bb) keep today's git-common-dir behavior unchanged.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"

PROBE="$SCRIPT_DIR/bl812_root_probe.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# ── fixture project root (fake tmux, no real git needed for scenarios 01-04) ─
FIXTURE="$(mktemp -d)"; register_tmp_dir "$FIXTURE"
mkdir -p "$FIXTURE/.swarmforge/launch"

printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$FIXTURE" > "$FIXTURE/.swarmforge/roles.tsv"
printf 'architect\tarchitect\t%s\tswarmforge-architect\tArchitect\tclaude\ttask\n' "$FIXTURE" >> "$FIXTURE/.swarmforge/roles.tsv"
printf 'hardender\thardender\t%s\tswarmforge-hardender\tHardender\tclaude\tbatch\n' "$FIXTURE" >> "$FIXTURE/.swarmforge/roles.tsv"
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$FIXTURE" >> "$FIXTURE/.swarmforge/roles.tsv"

echo "hardender" > "$FIXTURE/.swarmforge/mono-router-active-role"

SOCK_DIR="$(mktemp -d)"; register_tmp_dir "$SOCK_DIR"
FAKE_SOCK="$SOCK_DIR/bl812.sock"
touch "$FAKE_SOCK"
echo "$FAKE_SOCK" > "$FIXTURE/.swarmforge/tmux-socket"

printf '#!/bin/sh\necho ran-coder\n' > "$FIXTURE/.swarmforge/launch/coder.sh"
printf '#!/bin/sh\necho ran-architect\n' > "$FIXTURE/.swarmforge/launch/architect.sh"
chmod +x "$FIXTURE/.swarmforge/launch/coder.sh" "$FIXTURE/.swarmforge/launch/architect.sh"

# Architect inbox holds an actionable parcel (scenario 04's Given) so
# rotate-resident-to!'s wait-for-delivery! returns immediately instead of
# polling 30s - same fixture trick test_rotate_to_role_stuck_parcel_gate.sh
# uses for the receiving role's inbox/new.
mkdir -p "$FIXTURE/.swarmforge/handoffs/inbox/new"
printf 'id: fwd\nfrom: coder\nto: architect\npriority: 50\ntype: git_handoff\ntask: BL-000\ncommit: aaaaaaaaaa\n\nmerge_and_process coder aaaaaaaaaa\n' \
  > "$FIXTURE/.swarmforge/handoffs/inbox/new/00_fwd.handoff"

# ── fake tmux: only swarmforge-coder and swarmforge-coordinator "exist" ────
FAKE_BIN="$(mktemp -d)"; register_tmp_dir "$FAKE_BIN"
CALLS_LOG="$FAKE_BIN/calls.log"
touch "$CALLS_LOG"
cat > "$FAKE_BIN/tmux" <<TMUX
#!/usr/bin/env bash
echo "\$*" >> "$CALLS_LOG"
case " \$* " in
  *" has-session "*)
    case " \$* " in
      *" swarmforge-coder "*|*" swarmforge-coordinator "*) exit 0 ;;
      *) exit 1 ;;
    esac
    ;;
  *" display-message "*)
    echo "%0"
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
TMUX
chmod +x "$FAKE_BIN/tmux"

# A directory outside the fixture and outside any git repo - handoffd's
# observed live failure shape (cwd = launcher home).
FOREIGN_CWD="$(mktemp -d)"; register_tmp_dir "$FOREIGN_CWD"

probe() {
  ( cd "$FOREIGN_CWD" && PATH="$FAKE_BIN:$PATH" bb "$PROBE" "$@" )
}

probe_from_project_root() {
  ( cd "$FIXTURE" && PATH="$FAKE_BIN:$PATH" bb "$PROBE" "$@" )
}

# ── Scenario 01 (Outline, 5 examples): root-scoped state resolves from the
#    explicit project root, not from handoffd's (foreign) cwd ─────────────

OUT="$(probe resident-session "$FIXTURE")"
[[ "$OUT" == "swarmforge-coder" ]] || fail "01a: resident session expected swarmforge-coder, got '$OUT'"
[[ "$OUT" != *"$FOREIGN_CWD"* ]] || fail "01a: resident session leaked the foreign cwd"
pass "01a: mono-router resident session resolves from the explicit root, not cwd"

OUT="$(probe home-role "$FIXTURE")"
[[ "$OUT" == "coder" ]] || fail "01b: home role expected coder, got '$OUT'"
pass "01b: mono-router home role resolves from the explicit root, not cwd"

OUT="$(probe active-role "$FIXTURE")"
[[ "$OUT" == "hardender" ]] || fail "01c: active role expected hardender (the marker's value), got '$OUT'"
pass "01c: mono-router active role resolves from the explicit root, not cwd"

OUT="$(probe tmux-socket "$FIXTURE")"
[[ "$OUT" == "$FAKE_SOCK" ]] || fail "01d: tmux socket expected '$FAKE_SOCK', got '$OUT'"
[[ "$OUT" != *"$FOREIGN_CWD"* ]] || fail "01d: tmux socket leaked the foreign cwd"
pass "01d: tmux socket path resolves from the explicit root, not cwd"

OUT="$(probe launch-script architect "$FIXTURE")"
[[ "$OUT" == "$FIXTURE/.swarmforge/launch/architect.sh" ]] || fail "01e: launch script expected the project's architect.sh, got '$OUT'"
[[ "$OUT" != *"$FOREIGN_CWD"* ]] || fail "01e: launch script leaked the foreign cwd"
pass "01e: architect launch script resolves from the explicit root, not cwd"

# ── Scenario 02: a dormant role's wake remaps to the resident under foreign cwd ─

OUT="$(probe wake-session "$FAKE_SOCK" "swarmforge-architect" "$FIXTURE")"
[[ "$OUT" == "swarmforge-coder" ]] || fail "02: wake session for architect expected swarmforge-coder (remap), got '$OUT'"
pass "02: a dormant role's wake remaps to the resident under foreign cwd"

# ── Scenario 03: wake remap is identical from the project cwd and a foreign cwd ─

FROM_PROJECT="$(probe_from_project_root wake-session "$FAKE_SOCK" "swarmforge-hardender" "$FIXTURE")"
FROM_FOREIGN="$(probe wake-session "$FAKE_SOCK" "swarmforge-hardender" "$FIXTURE")"
[[ "$FROM_PROJECT" == "$FROM_FOREIGN" ]] || fail "03: wake session differs by cwd (project='$FROM_PROJECT' foreign='$FROM_FOREIGN')"
[[ "$FROM_FOREIGN" == "swarmforge-coder" ]] || fail "03: wake session expected swarmforge-coder, got '$FROM_FOREIGN'"
pass "03: wake remap is identical from the project cwd and a foreign cwd"

# ── Scenario 04: chase rotates the resident onto a dormant role holding
#    actionable mail (rotate-resident-to! is the exact respawn action chase
#    performs once it has decided to poke a role - the decision logic itself
#    is untouched by BL-812, which fixes only root resolution) ────────────

: > "$CALLS_LOG"
OUT="$(probe rotate-to architect "$FIXTURE")"
[[ "$OUT" == *":ok true"* ]] || fail "04: rotate-resident-to! architect expected :ok true, got '$OUT'"
grep -q -- "-t swarmforge-coder .*architect\.sh" "$CALLS_LOG" \
  || fail "04: expected a respawn-pane targeting the RESIDENT (swarmforge-coder) running architect.sh; calls:\n$(cat "$CALLS_LOG")"
grep -q "send-literal" "$CALLS_LOG" \
  && fail "04: no send-literal (chase-wake-error's failure mode) should ever be attempted by the fixed rotate path"
grep -q -- "-t swarmforge-architect " "$CALLS_LOG" \
  && fail "04: no tmux call should ever target the nonexistent swarmforge-architect pane directly"
pass "04: chase rotates the resident onto a dormant role holding actionable mail, and no chase-wake-error path is taken"

# ── Scenario 05 (regression guard): a caller that sets no explicit project
#    root still resolves through git-common-dir, cwd inside a linked
#    worktree - rotate_to_role.bb, operator_runtime.bb, operator_lib.bb all
#    depend on this fallback surviving unchanged ──────────────────────────

GIT_ROOT="$(mktemp -d)"; register_tmp_dir "$GIT_ROOT"
git -C "$GIT_ROOT" init -q
git -C "$GIT_ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init
mkdir -p "$GIT_ROOT/.swarmforge"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$GIT_ROOT" > "$GIT_ROOT/.swarmforge/roles.tsv"
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$GIT_ROOT" >> "$GIT_ROOT/.swarmforge/roles.tsv"

git -C "$GIT_ROOT" worktree add -q "$GIT_ROOT/.worktrees/architect" -b bl812-architect-fixture >/dev/null

OUT="$(cd "$GIT_ROOT/.worktrees/architect" && PATH="$FAKE_BIN:$PATH" bb "$PROBE" resident-session)"
[[ "$OUT" == "swarmforge-coder" ]] || fail "05: no explicit root set, cwd inside linked worktree, expected swarmforge-coder via git-common-dir fallback, got '$OUT'"
pass "05: a caller that sets no explicit project root still resolves through the git common dir"

echo "test_handoffd_bl812_cwd_invariant_root_resolution: ALL SCENARIOS PASSED"
