#!/usr/bin/env bash
# BL-648: exercises resolve_launch_script_for_role directly against the REAL
# swarmforge.sh (sourced, not executed - the ZSH_EVAL_CONTEXT toplevel guard
# skips the real tmux/session-launch body when sourced, same convention
# test_rotation_sequential_pack.sh / test_resume_on_start.sh already use).
# No live tmux session is ever created or bounced by this test - proves the
# SCRIPT-SELECTION decision the resident's respawn-pane would exec, without
# needing one.

set -euo pipefail

# BL-315/engineering.prompt: never let a caller's own SWARMFORGE_CONFIG leak
# into this fixture's conf resolution.
unset SWARMFORGE_CONFIG

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

mk_fixture_root() {
  local root
  root="$(cd "$(mktemp -d)" && pwd -P)"
  mkdir -p "$root/swarmforge/roles" "$root/.swarmforge/prompts" "$root/.swarmforge/launch"
  touch "$root/swarmforge/constitution.prompt"
  for role in specifier coder cleaner architect hardener documenter QA; do
    echo "role prompt" > "$root/swarmforge/roles/$role.prompt"
  done
  cat > "$root/swarmforge/swarmforge.conf" <<'CONF'
config swarm_name mono
config rotation router
window coder claude coder --model x
window cleaner claude cleaner batch --model x
window architect claude architect --model x
window hardener claude hardener --model x
window documenter claude documenter --model x
window QA claude QA --model x
CONF
  echo "$root"
}

# ── 01: MONO_ROUTER_BOOT_ROLE names a dormant middle role (QA) -> the
#    resident's script switches to QA's own, generated on demand ─────────
ROOT1="$(mk_fixture_root)"
trap 'rm -rf "$ROOT1"' EXIT

RESULT1="$(zsh -c "
  source '$SWARMFORGE_SH' '$ROOT1'
  parse_config
  write_roles_file
  MONO_ROUTER_BOOT_ROLE=QA
  resolve_launch_script_for_role 1 coder '$ROOT1/.swarmforge/launch/coder.sh'
")"
[[ "$RESULT1" == "$ROOT1/.swarmforge/launch/QA.sh" ]] \
  || fail "01: expected the resident's launch script to switch to QA's own, got: $RESULT1"
pass "01: MONO_ROUTER_BOOT_ROLE=QA redirects the resident's own script to QA's"

[[ -f "$ROOT1/.swarmforge/launch/QA.sh" ]] \
  || fail "01: expected QA's launch script to have been generated on demand"
pass "01: QA's launch script (never otherwise generated before every session is up) was generated on demand"

rm -rf "$ROOT1"
trap - EXIT

# ── 02: MONO_ROUTER_BOOT_ROLE unset (the common case) -> home's own script,
#    completely unchanged ─────────────────────────────────────────────────
ROOT2="$(mk_fixture_root)"
trap 'rm -rf "$ROOT2"' EXIT

RESULT2="$(zsh -c "
  source '$SWARMFORGE_SH' '$ROOT2'
  parse_config
  write_roles_file
  MONO_ROUTER_BOOT_ROLE=''
  resolve_launch_script_for_role 1 coder '$ROOT2/.swarmforge/launch/coder.sh'
")"
[[ "$RESULT2" == "$ROOT2/.swarmforge/launch/coder.sh" ]] \
  || fail "02: expected home's own script unchanged when no boot-role override applies, got: $RESULT2"
pass "02: an unset MONO_ROUTER_BOOT_ROLE leaves the resident's own script untouched"

rm -rf "$ROOT2"
trap - EXIT

# ── 03: the override only ever applies to index 1 (the resident) - a
#    dormant middle role's own launch_role call (were it ever reached under
#    router - it never gets a session, but the guard must hold regardless)
#    is never redirected ─────────────────────────────────────────────────
ROOT3="$(mk_fixture_root)"
trap 'rm -rf "$ROOT3"' EXIT

RESULT3="$(zsh -c "
  source '$SWARMFORGE_SH' '$ROOT3'
  parse_config
  write_roles_file
  MONO_ROUTER_BOOT_ROLE=QA
  resolve_launch_script_for_role 2 cleaner '$ROOT3/.swarmforge/launch/cleaner.sh'
")"
[[ "$RESULT3" == "$ROOT3/.swarmforge/launch/cleaner.sh" ]] \
  || fail "03: expected the override to apply only to index 1, got: $RESULT3"
pass "03: the boot-role override never applies to a non-resident index"

rm -rf "$ROOT3"
trap - EXIT

echo "ALL PASS"
