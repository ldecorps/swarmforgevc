#!/usr/bin/env bash
# BL-657: wiring test for scrub_harness_env/create_role_session against the
# REAL swarmforge.sh and a REAL throwaway tmux server - proves the fix, not
# just the pure predicate (harness_env_scrub_lib_test_runner.bb covers that
# in isolation). Confirms:
#   (a) a harness marker (CLAUDE_CODE_CHILD_SESSION) leaked into the
#       launching shell's own env is scrubbed from the tmux server's global
#       environment by create_role_session, before any role pane is spawned.
#   (b) the deliberate CLAUDE_CODE_MAX_OUTPUT_TOKENS passthrough survives the
#       scrub even when a real marker is also present.
#
# SAFETY: this file must NEVER print a raw `tmux show-environment -g` dump -
# a prior manual repro of this exact scenario, run from a live harness
# session, dumped every real provider API key on that shell's PATH into
# assistant output/transcript along with the one marker under test. Every
# assertion here greps for the ONE name it cares about and discards the rest.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

mk_fixture_root() {
  local root
  root="$(cd "$(mktemp -d)" && pwd -P)"
  register_tmp_dir "$root"
  mkdir -p "$root/swarmforge/roles" "$root/.swarmforge"
  touch "$root/swarmforge/constitution.prompt"
  echo "role prompt" > "$root/swarmforge/roles/coder.prompt"
  printf 'window coder claude coder --model x\n' > "$root/swarmforge/swarmforge.conf"
  echo "$root"
}

# ═══════════════════════════════════════════════════════════════════════════
# (a) a harness marker leaked into the launching shell is scrubbed
# ═══════════════════════════════════════════════════════════════════════════

ROOT_A="$(mk_fixture_root)"
RESULT_A="$(mktemp)"
CLAUDE_CODE_CHILD_SESSION=bl657-probe-marker-a env -u SWARMFORGE_CONFIG zsh -c "
  source '$SWARMFORGE_SH' '$ROOT_A'
  create_role_session 'bl657-a' 'BL657 A' ''
  if tmux -S \"\$TMUX_SOCKET\" show-environment -g 2>/dev/null | grep -q '^CLAUDE_CODE_CHILD_SESSION='; then
    echo STILL_PRESENT
  else
    echo SCRUBBED
  fi
  tmux -S \"\$TMUX_SOCKET\" kill-server 2>/dev/null
" > "$RESULT_A" 2>/dev/null

grep -q "^SCRUBBED$" "$RESULT_A" \
  || fail "a: expected create_role_session to scrub a leaked CLAUDE_CODE_CHILD_SESSION from the tmux server's global environment, got: $(cat "$RESULT_A")"
pass "a: create_role_session scrubs a leaked CLAUDE_CODE_CHILD_SESSION harness marker"
rm -f "$RESULT_A"

# ═══════════════════════════════════════════════════════════════════════════
# (b) the deliberate CLAUDE_CODE_MAX_OUTPUT_TOKENS passthrough survives the
# scrub even alongside a real marker
# ═══════════════════════════════════════════════════════════════════════════

ROOT_B="$(mk_fixture_root)"
RESULT_B="$(mktemp)"
CLAUDE_CODE_CHILD_SESSION=bl657-probe-marker-b CLAUDE_CODE_MAX_OUTPUT_TOKENS=4096 env -u SWARMFORGE_CONFIG zsh -c "
  source '$SWARMFORGE_SH' '$ROOT_B'
  create_role_session 'bl657-b' 'BL657 B' ''
  ENV_DUMP=\"\$(tmux -S \"\$TMUX_SOCKET\" show-environment -g 2>/dev/null)\"
  if echo \"\$ENV_DUMP\" | grep -q '^CLAUDE_CODE_CHILD_SESSION='; then
    echo MARKER_STILL_PRESENT
  else
    echo MARKER_SCRUBBED
  fi
  if echo \"\$ENV_DUMP\" | grep -q '^CLAUDE_CODE_MAX_OUTPUT_TOKENS=4096\$'; then
    echo PASSTHROUGH_SURVIVED
  else
    echo PASSTHROUGH_LOST
  fi
  tmux -S \"\$TMUX_SOCKET\" kill-server 2>/dev/null
" > "$RESULT_B" 2>/dev/null

grep -q "^MARKER_SCRUBBED$" "$RESULT_B" \
  || fail "b: expected the marker scrubbed even with the passthrough var also present, got: $(cat "$RESULT_B")"
grep -q "^PASSTHROUGH_SURVIVED$" "$RESULT_B" \
  || fail "b: expected CLAUDE_CODE_MAX_OUTPUT_TOKENS (deliberate passthrough) to survive the scrub, got: $(cat "$RESULT_B")"
pass "b: the deliberate CLAUDE_CODE_MAX_OUTPUT_TOKENS passthrough survives the scrub even alongside a real marker"
rm -f "$RESULT_B"

echo "ALL PASS"
