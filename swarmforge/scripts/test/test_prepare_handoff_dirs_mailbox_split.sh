#!/usr/bin/env bash
# BL-128: swarmforge.sh's prepare_handoff_dirs bootstraps each role's mailbox
# tree at launch time. Coordinator and specifier share the master worktree,
# so each must get its OWN <role> mailbox subdirectory instead of one shared
# flat tree; every other role's own dedicated worktree keeps the flat layout.
#
# Follows test_swarm_identity_conf_parsing.sh's convention: source
# swarmforge.sh (its ZSH_EVAL_CONTEXT guard skips the actual launch), call
# parse_config to populate ROLES/WORKTREE_NAMES/WORKTREE_PATHS, then call the
# function under test directly.
#
# Covers acceptance scenario BL-128 mailbox-isolation-01 (bootstrap layout).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

mk_root() {
  local root; root="$(cd "$(mktemp -d)" && pwd -P)"
  mkdir -p "$root/swarmforge/roles" "$root/.swarmforge"
  touch "$root/swarmforge/constitution.prompt"
  for role in coordinator specifier coder; do
    echo "role prompt" > "$root/swarmforge/roles/$role.prompt"
  done
  echo "$root"
}

ROOT="$(mk_root)"
trap 'rm -rf "$ROOT"' EXIT

cat > "$ROOT/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window specifier claude master --model x
window coder claude coder task --model x
CONF

zsh -c "source '$SWARMFORGE_SH' '$ROOT'; parse_config; prepare_handoff_dirs"

COORDINATOR_BASE="$ROOT/.swarmforge/handoffs/coordinator"
SPECIFIER_BASE="$ROOT/.swarmforge/handoffs/specifier"
CODER_BASE="$ROOT/.worktrees/coder/.swarmforge/handoffs"

for state_dir in outbox/tmp sent failed inbox/new inbox/in_process inbox/completed inbox/abandoned; do
  [[ -d "$COORDINATOR_BASE/$state_dir" ]] || fail "coordinator's own $state_dir was not created at $COORDINATOR_BASE"
  [[ -d "$SPECIFIER_BASE/$state_dir" ]] || fail "specifier's own $state_dir was not created at $SPECIFIER_BASE"
  [[ -d "$CODER_BASE/$state_dir" ]] || fail "coder's flat $state_dir was not created at $CODER_BASE"
done
pass "each role's mailbox directory tree (outbox/sent/failed/inbox/*) is created"

[[ "$COORDINATOR_BASE" != "$SPECIFIER_BASE" ]] \
  || fail "coordinator and specifier resolved to the same mailbox base directory"
pass "coordinator and specifier get physically distinct mailbox subdirectories on the shared master worktree"

[[ ! -d "$ROOT/.swarmforge/handoffs/outbox" ]] \
  || fail "a stray flat .swarmforge/handoffs/outbox was created at the shared worktree root"
pass "no flat shared outbox is created for master-resident roles"

echo "ALL PASS"
