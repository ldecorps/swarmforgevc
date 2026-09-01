#!/usr/bin/env bash
# BL-961: the launcher bakes `export SWARMFORGE_PACK='<pack>'` into every
# generated .swarmforge/launch/<role>.sh, where <pack> is the basename
# (sans .conf) of the CONFIG_FILE the launcher actually loaded. Same
# zsh-source fixture harness as test_remote_control_launch.sh - no live
# tmux. Invariant 2 is asserted on the generated FILE's own content (a
# respawn re-runs that file, BL-323), never on any live environment.

set -euo pipefail

# BL-1318: this test exercises parse_config's OTHER behavior (not model
# staffing) - bypass the steward staffing gate so a fixture's placeholder
# --model value ("x", etc.) does not trip an unrelated refusal.
export PACK_STAFFING_SKIP_GATE=1

# BL-961 hardening: the pane a test runs in is a launch environment, not a
# clean room - every live role shell exports SWARMFORGE_PACK, and an
# operator shell can export SWARMFORGE_CONFIG. swarmforge.sh READS both
# (CONFIG_FILE="${SWARMFORGE_CONFIG:-.../swarmforge.conf}" at line 92;
# SWARMFORGE_PACK as check_launch_pack_guard's input at line 112), so an
# inherited value makes this file assert against the ambient configuration
# instead of its own fixture. Case 02 is the sharp one: with
# SWARMFORGE_CONFIG set it reads that conf's basename - a false RED when the
# name differs, and a silent false GREEN whenever the inherited path is
# itself named swarmforge.conf, which is the default's own name. Unset every
# SWARMFORGE_* the script under test reads, before any fixture conf is
# written. Enumerated from `grep -o 'SWARMFORGE_[A-Z_]*' swarmforge.sh`;
# re-run that grep when swarmforge.sh grows a new one.
unset SWARMFORGE_ALLOW_FULL_PACK SWARMFORGE_CONFIG SWARMFORGE_DAEMON_START_CALLER \
      SWARMFORGE_GEMINI_API_KEY SWARMFORGE_MAILBOX_ONLY SWARMFORGE_OPENROUTER_ROLES \
      SWARMFORGE_PACK SWARMFORGE_REMOTE_CONTROL SWARMFORGE_ROLE \
      SWARMFORGE_ROLE_WORKTREE SWARMFORGE_SKIP_DAEMON SWARMFORGE_SKIP_FRONT_DESK \
      SWARMFORGE_SKIP_OPERATOR SWARMFORGE_SKIP_SHELL_RUN_RECORD SWARMFORGE_TERMINAL \
      SWARMFORGE_TERMINAL_BACKEND SWARMFORGE_USE_CEREBRAS SWARMFORGE_USE_PERPLEXITY \
      SWARMFORGE_USE_QWEN
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

index_of_role_snippet='
index_of_role() {
  local target="$1" i
  for (( i = 1; i <= ${#ROLES[@]}; i++ )); do
    [[ "${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done }
'

mk_root() {
  local root; root="$(cd "$(mktemp -d)" && pwd -P)"
  register_tmp_dir "$root"
  mkdir -p "$root/swarmforge/roles" "$root/swarmforge/packs" "$root/.swarmforge/launch" "$root/.swarmforge/prompts"
  printf 'constitution\n' > "$root/swarmforge/constitution.prompt"
  printf 'role prompt\n' > "$root/swarmforge/roles/coder.prompt"
  printf 'role prompt\n' > "$root/swarmforge/roles/QA.prompt"
  echo "$root"
}

WINDOW_LINE='window coder claude coder --model claude-haiku-4-5-20251001 --dangerously-skip-permissions --effort low'
QA_WINDOW_LINE='window QA claude QA --model claude-haiku-4-5-20251001 --dangerously-skip-permissions --effort low'

# ── 01: pack conf selected via --pack — export carries the pack basename ────
# Covers a hyphenated name (full-forge) and a second distinct pack
# (mono-router): the exported value must track the conf actually loaded.
for PACK in full-forge mono-router; do
  ROOT="$(mk_root)"
  printf '%s\n' "$WINDOW_LINE" > "$ROOT/swarmforge/packs/$PACK.conf"
  XDG_RUNTIME_DIR=/tmp zsh -c "source '$SWARMFORGE_SH' '$ROOT' --pack '$PACK'; parse_config; $index_of_role_snippet write_role_launch_script \"\$(index_of_role coder)\""
  SCRIPT="$ROOT/.swarmforge/launch/coder.sh"
  [[ -f "$SCRIPT" ]] || fail "01($PACK): coder launch script was not written"
  grep -qxF "export SWARMFORGE_PACK='$PACK'" "$SCRIPT" \
    || fail "01($PACK): expected export SWARMFORGE_PACK='$PACK' baked into the generated file; got: $(grep SWARMFORGE_PACK "$SCRIPT" || echo '<no export line>')"
done
pass "01: --pack NAME bakes export SWARMFORGE_PACK='NAME' into the generated script"

# ── 02: default swarmforge.conf — export carries 'swarmforge' ───────────────
ROOT="$(mk_root)"
printf '%s\n' "$WINDOW_LINE" > "$ROOT/swarmforge/swarmforge.conf"
XDG_RUNTIME_DIR=/tmp zsh -c "source '$SWARMFORGE_SH' '$ROOT'; parse_config; $index_of_role_snippet write_role_launch_script \"\$(index_of_role coder)\""
grep -qxF "export SWARMFORGE_PACK='swarmforge'" "$ROOT/.swarmforge/launch/coder.sh" \
  || fail "02: default conf must bake export SWARMFORGE_PACK='swarmforge'; got: $(grep SWARMFORGE_PACK "$ROOT/.swarmforge/launch/coder.sh" || echo '<no export line>')"
pass "02: the default swarmforge.conf bakes export SWARMFORGE_PACK='swarmforge'"

# ── 03 (invariant 1): one launch, every role's script identical value ───────
ROOT="$(mk_root)"
{ printf '%s\n' "$WINDOW_LINE"; printf '%s\n' "$QA_WINDOW_LINE"; } > "$ROOT/swarmforge/packs/full-forge.conf"
XDG_RUNTIME_DIR=/tmp zsh -c "source '$SWARMFORGE_SH' '$ROOT' --pack full-forge; parse_config; $index_of_role_snippet write_role_launch_script \"\$(index_of_role coder)\"; write_role_launch_script \"\$(index_of_role QA)\""
VALS=""
for ROLE in coder QA; do
  SCRIPT="$ROOT/.swarmforge/launch/$ROLE.sh"
  [[ -f "$SCRIPT" ]] || fail "03: $ROLE launch script was not written"
  LINE="$(grep -x "export SWARMFORGE_PACK='.*'" "$SCRIPT" || true)"
  [[ -n "$LINE" ]] || fail "03: $ROLE script carries no SWARMFORGE_PACK export"
  VALS="$VALS$LINE"$'\n'
done
[[ "$(printf '%s' "$VALS" | sort -u | wc -l | tr -d ' ')" == "1" ]] \
  || fail "03: the two roles' exports differ within one launch: $VALS"
grep -qF "'full-forge'" <<< "$VALS" || fail "03: the shared value must equal the loaded conf's basename; got: $VALS"
pass "03: every role's generated script exports the identical pack, equal to the loaded conf basename (invariant 1)"

# ── 04 (invariant 2): the export survives with NO tmux/server/launch env ────
# The value must come from the generated FILE itself: read it back from the
# file with an emptied environment, proving nothing inherited supplies it.
ROOT="$(mk_root)"
printf '%s\n' "$WINDOW_LINE" > "$ROOT/swarmforge/packs/full-forge.conf"
XDG_RUNTIME_DIR=/tmp zsh -c "source '$SWARMFORGE_SH' '$ROOT' --pack full-forge; parse_config; $index_of_role_snippet write_role_launch_script \"\$(index_of_role coder)\""
SCRIPT="$ROOT/.swarmforge/launch/coder.sh"
VALUE="$(env -i /bin/sh -c "eval \"\$(grep -x \"export SWARMFORGE_PACK='.*'\" '$SCRIPT')\"; printf '%s' \"\$SWARMFORGE_PACK\"")"
[[ "$VALUE" == "full-forge" ]] \
  || fail "04: sourcing only the file's own export under env -i must yield full-forge; got '$VALUE'"
pass "04: the export lives in the generated file itself - an emptied environment still yields the pack (invariant 2)"

echo "ALL PASS"
