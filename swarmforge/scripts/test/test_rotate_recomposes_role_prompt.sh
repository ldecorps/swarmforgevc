#!/usr/bin/env bash
# BL-911: rotate-resident-to! (the one chokepoint both the resident-invoked
# path (respawn-as! via rotate_to_role.sh) and handoffd.bb's daemon-driven
# chase share) must recompose the target role's prompt from CURRENT sources
# before respawning the pane into it - otherwise nothing between two full
# `./swarm` launches ever refreshes an accepted rule proposal or a landed
# constitution amendment.
#
# Drives the REAL swarmforge/scripts/*.bb (absolute paths, load-file is not
# cwd-relative) against an isolated fixture git repo, same pattern as
# test_rotate_to_role_stuck_parcel_gate.sh (BL-805). The fixture's own
# .swarmforge/prompts/hardender.md starts deliberately STALE (representing
# "composed at an earlier commit" - the feature's Background); the markers
# asserted below are real, already-landed, stable phrases from this actual
# repo's own current sources (swarmforge/roles/hardender.prompt, an inlined
# constitution article, PIPELINE.md) - never freshly fabricated content -
# because PromptEngine's compose (loaded from its real, physical location)
# always reads from wherever it actually lives on disk, never from the
# fixture project-root below. Proving those three markers are absent from
# the stale fixture prompt and present after a real rotation is exactly the
# "prose landed after launch reaches the role at its next rotation" property,
# without ever mutating a tracked file.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REAL_SCRIPTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROTATE_SH="$REAL_SCRIPTS_DIR/rotate_to_role.sh"
HANDOFF_LIB="$REAL_SCRIPTS_DIR/handoff_lib.bb"
READY_TASK_BB="$REAL_SCRIPTS_DIR/ready_for_next_task.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

make_fake_tmux() {
  local bin_dir="$1"
  mkdir -p "$bin_dir"
  cat > "$bin_dir/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$TMUX_LOG"
exit 0
TMUX
  chmod +x "$bin_dir/tmux"
}

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

CODER_WT="$ROOT/wt-coder"
HARD_WT="$ROOT/wt-hardender"
mkdir -p "$CODER_WT/.swarmforge/handoffs/inbox/new" \
         "$CODER_WT/.swarmforge/handoffs/inbox/in_process" \
         "$HARD_WT/.swarmforge/handoffs/inbox/new" \
         "$HARD_WT/.swarmforge/handoffs/inbox/in_process" \
         "$ROOT/.swarmforge/launch" \
         "$ROOT/.swarmforge/prompts"

printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" > "$ROOT/.swarmforge/roles.tsv"
printf 'hardender\thardender\t%s\tswarmforge-hardender\tHardender\tclaude\tbatch\n' "$HARD_WT" >> "$ROOT/.swarmforge/roles.tsv"

touch "$ROOT/fake.sock"
echo "$ROOT/fake.sock" > "$ROOT/.swarmforge/tmux-socket"

printf '#!/bin/sh\nexit 0\n' > "$ROOT/.swarmforge/launch/hardender.sh"
chmod +x "$ROOT/.swarmforge/launch/hardender.sh"

FAKE_BIN="$ROOT/bin"
make_fake_tmux "$FAKE_BIN"
TMUX_LOG="$ROOT/tmux-calls.log"
export TMUX_LOG
touch "$TMUX_LOG"

# hardender's inbox/new already holds a parcel so wait-for-delivery! inside
# rotate-resident-to! returns immediately instead of polling 30s.
printf 'id: fwd\nfrom: coder\nto: hardender\npriority: 50\ntype: git_handoff\ntask: BL-000\ncommit: aaaaaaaaaa\n\nmerge_and_process coder aaaaaaaaaa\n' \
  > "$HARD_WT/.swarmforge/handoffs/inbox/new/00_fwd.handoff"

echo "coder" > "$ROOT/.swarmforge/mono-router-active-role"

STALE_PROMPT="STALE PROMPT COMPOSED AT AN EARLIER COMMIT"
PROMPT_FILE="$ROOT/.swarmforge/prompts/hardender.md"
METADATA_FILE="$PROMPT_FILE.metadata.json"

reset_stale_prompt() {
  printf '%s' "$STALE_PROMPT" > "$PROMPT_FILE"
  printf '{"agent":"claude","model":"sonnet-5","two-pack?":false,"overlay-prompt":""}' > "$METADATA_FILE"
}

assert_no_marker() {
  grep -qF "$1" "$PROMPT_FILE" && fail "$2: marker '$1' unexpectedly already present in the stale fixture prompt"
  return 0
}

assert_markers_present() {
  grep -qF "You are the hardender." "$PROMPT_FILE" \
    || fail "$1: recomposed prompt missing the role-prompt source marker"
  grep -qF "# Article 1: Roles and Responsibilities" "$PROMPT_FILE" \
    || fail "$1: recomposed prompt missing the inlined-constitution-article source marker"
  grep -qF "# Parcel Flow" "$PROMPT_FILE" \
    || fail "$1: recomposed prompt missing the pipeline-article source marker"
}

run_rotate() {
  (cd "$CODER_WT" && PATH="$FAKE_BIN:$PATH" bash "$ROTATE_SH" "$1")
}

run_rotate_via_daemon_path() {
  (cd "$CODER_WT" && PATH="$FAKE_BIN:$PATH" bb -e "
(load-file \"$HANDOFF_LIB\")
(println (handoff-lib/rotate-resident-to! \"hardender\"))
")
}

# BL-917: idle-clear is a per-role roles.tsv column 8 opt-in (BL-089),
# absent/"off"/anything-but-"on" meaning disabled. Rewrites the SAME two
# rows scenarios 01-04 already depend on, only varying hardender's 8th
# column, so target-root/session resolution stays identical to above.
set_idle_clear() {
  local state="$1"
  printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" > "$ROOT/.swarmforge/roles.tsv"
  printf 'hardender\thardender\t%s\tswarmforge-hardender\tHardender\tclaude\tbatch\t%s\n' "$HARD_WT" "$state" >> "$ROOT/.swarmforge/roles.tsv"
}

# Drives the REAL ready_for_next_task.bb --idle-boundary (BL-089's own
# entrypoint flag) directly via `bb`, as hardender, with an empty inbox so
# it reaches report-no-task-or-rotate! -> maybe-clear-at-idle-boundary! -
# never a reimplementation of that gate. Deliberately NOT the .sh wrapper:
# ready_for_next_task.sh's own `cd "$SCRIPT_DIR"` (to this repo's REAL
# swarmforge/scripts/, so its relative loads resolve regardless of caller
# cwd) would override this fixture's `cd "$HARD_WT"` before bb even starts,
# making target-root's git-common-dir fallback resolve against the REAL
# swarm repo instead of the fixture - confirmed the hard way: an earlier
# draft of this test using the wrapper read (harmlessly, but by luck) a
# REAL in-process handoff out of THIS repo's own live hardender worktree.
run_idle_boundary() {
  (cd "$HARD_WT" && PATH="$FAKE_BIN:$PATH" SWARMFORGE_ROLE="$1" bb "$READY_TASK_BB" --idle-boundary)
}

# ── Scenario Outline 01 / 02 (resident row): prose landed after launch ─────
# reaches the role at its next rotation, driven by the resident. All three
# <source> examples (role prompt / inlined constitution article / pipeline
# article) travel in the one compose call rotate-resident-to! makes, so one
# rotation proves all three Examples rows at once.
reset_stale_prompt
assert_no_marker "You are the hardender." "01"
assert_no_marker "# Article 1: Roles and Responsibilities" "01"
assert_no_marker "# Parcel Flow" "01"
: > "$TMUX_LOG"
OUT="$(run_rotate hardender 2>&1)"
grep -q "respawn-pane" "$TMUX_LOG" || fail "01: expected a respawn-pane call, log: $(cat "$TMUX_LOG")"
assert_markers_present "01"
pass "01: prose landed after launch (role prompt / constitution article / pipeline article) reaches the role at its next resident-driven rotation"
echo "coder" > "$ROOT/.swarmforge/mono-router-active-role"

# ── Scenario Outline 02 (daemon row): whichever driver rotates the role, ───
# it boots on a freshly composed prompt - handoffd.bb's chase calls
# rotate-resident-to! directly, bypassing rotate_to_role.sh/respawn-as!
# entirely, same as production (mirrors BL-805's own scenario 04).
reset_stale_prompt
: > "$TMUX_LOG"
OUT="$(run_rotate_via_daemon_path)"
echo "$OUT" | grep -q ":ok true" || fail "02: expected rotate-resident-to! to succeed, got: $OUT"
grep -q "respawn-pane" "$TMUX_LOG" || fail "02: daemon-path rotate must still respawn, log: $(cat "$TMUX_LOG")"
assert_markers_present "02"
pass "02: whichever driver rotates the role (the daemon's chase, driving rotate-resident-to! directly), it boots on a freshly composed prompt"

# ── Scenario 03: a composition that fails leaves the previous prompt in ────
# place, the role still boots, and the failure is reported.
reset_stale_prompt
rm -f "$METADATA_FILE"   # BL-911: no metadata sidecar -> recompose-role-prompt! fails
: > "$TMUX_LOG"
OUT="$(run_rotate hardender 2>&1)"
grep -q "respawn-pane" "$TMUX_LOG" || fail "03: rotation must still complete despite a composition failure, log: $(cat "$TMUX_LOG")"
[[ "$(cat "$PROMPT_FILE")" == "$STALE_PROMPT" ]] \
  || fail "03: the prompt must carry everything it carried before on a composition failure, got: $(cat "$PROMPT_FILE")"
echo "$OUT" | grep -qi "recompose failed" || fail "03: the composition failure must be reported, got: $OUT"
echo "$OUT" | grep -q "hardender" || fail "03: the failure report must name the role, got: $OUT"
pass "03: a composition that fails leaves the previous prompt in place, the role still boots, and the failure is reported"
echo "coder" > "$ROOT/.swarmforge/mono-router-active-role"

# ── Scenario 04: a role whose sources are unchanged boots on a prompt that ─
# lost nothing - two rotations in a row against the same (unchanged) real
# sources produce byte-identical composed content.
reset_stale_prompt
: > "$TMUX_LOG"
run_rotate hardender > /dev/null 2>&1
FIRST="$(cat "$PROMPT_FILE")"
echo "coder" > "$ROOT/.swarmforge/mono-router-active-role"
: > "$TMUX_LOG"
run_rotate hardender > /dev/null 2>&1
SECOND="$(cat "$PROMPT_FILE")"
[[ "$FIRST" == "$SECOND" ]] || fail "04: recomposing twice against unchanged sources must be byte-identical"
pass "04: a role whose sources are unchanged since the swarm was composed boots on a prompt that lost nothing"

# BL-917: scenarios 05-07 exercise the SAME-role re-exec path BL-911 missed
# - respawn-self! (the idle-boundary clear), never rotate-resident-to!/
# rotate_to_role.sh. hardender's inbox/new still holds scenario 01-04's
# wait-for-delivery! seed handoff; clear it first so ready_for_next_task.sh
# actually reaches NO_TASK -> report-no-task-or-rotate! instead of handing
# out that leftover parcel.
rm -f "$HARD_WT/.swarmforge/handoffs/inbox/new"/*.handoff \
      "$HARD_WT/.swarmforge/handoffs/inbox/in_process"/*.handoff

# ── Scenario 05: an idle-boundary clear boots the same role on a freshly ───
# composed prompt - BL-917's own fix (respawn-self! did not recompose
# before BL-911's sibling rotate-resident-to! did).
reset_stale_prompt
assert_no_marker "You are the hardender." "05"
set_idle_clear "on"
: > "$TMUX_LOG"
OUT="$(run_idle_boundary hardender 2>&1)"
echo "$OUT" | grep -q '^NO_TASK$' || fail "05: expected NO_TASK before the idle clear runs, got: $OUT"
grep -q "respawn-pane" "$TMUX_LOG" || fail "05: expected a respawn-pane call at the idle boundary, log: $(cat "$TMUX_LOG")"
assert_markers_present "05"
pass "05: an idle-boundary clear boots the same role on a freshly composed prompt"

# ── Scenario 06: a composition that fails at an idle clear still boots the ─
# role (clear still completes), leaves the previous prompt in place, and
# reports the failure - same invariant-2 posture as scenario 03's rotation.
reset_stale_prompt
rm -f "$METADATA_FILE"   # BL-911/BL-917: no metadata sidecar -> recompose-role-prompt! fails
: > "$TMUX_LOG"
OUT="$(run_idle_boundary hardender 2>&1)"
grep -q "respawn-pane" "$TMUX_LOG" || fail "06: the clear must still complete despite a composition failure, log: $(cat "$TMUX_LOG")"
[[ "$(cat "$PROMPT_FILE")" == "$STALE_PROMPT" ]] \
  || fail "06: the prompt must carry everything it carried before on a composition failure, got: $(cat "$PROMPT_FILE")"
echo "$OUT" | grep -qi "recompose failed" || fail "06: the composition failure must be reported, got: $OUT"
echo "$OUT" | grep -q "hardender" || fail "06: the failure report must name the role, got: $OUT"
pass "06: a composition that fails at an idle clear still boots the role, and the failure is reported"

# restore the metadata sidecar (deleted above) before scenario 07 composes
printf '{"agent":"claude","model":"sonnet-5","two-pack?":false,"overlay-prompt":""}' > "$METADATA_FILE"

# ── Scenario 07: with idle-clear off, the idle boundary neither respawns ───
# nor recomposes - the shipped default (BL-089) must remain a true no-op;
# this ticket must not start recomposing on every parcel completion.
reset_stale_prompt
set_idle_clear "off"
: > "$TMUX_LOG"
OUT="$(run_idle_boundary hardender 2>&1)"
echo "$OUT" | grep -q '^NO_TASK$' || fail "07: expected NO_TASK, got: $OUT"
grep -q "respawn-pane" "$TMUX_LOG" && fail "07: idle-clear off must never respawn, log: $(cat "$TMUX_LOG")"
[[ "$(cat "$PROMPT_FILE")" == "$STALE_PROMPT" ]] \
  || fail "07: idle-clear off must never recompose the prompt either, got: $(cat "$PROMPT_FILE")"
pass "07: with idle-clear off, the idle boundary neither respawns nor recomposes"

echo "test_rotate_recomposes_role_prompt: ALL CHECKS PASSED"
