#!/usr/bin/env bash
# BL-313: swarmforge.sh persists the EFFECTIVE active_backlog_max_depth (and
# which config supplied it) into .swarmforge/swarm-identity at launch time,
# so backlog_depth_lib.bb's reader can enforce whichever pack/override
# actually launched the swarm instead of always the tracked default. Same
# "source + explicit function calls, never the real tmux launch" pattern as
# test_swarm_identity_conf_parsing.sh (guarded by swarmforge.sh's own
# ZSH_EVAL_CONTEXT != toplevel check - BL-089).
#
# Explicitly clears any inherited SWARMFORGE_CONFIG/--pack env from the
# CALLING shell (e.g. a coder session itself launched via a pack) so this
# test's own fixture conf is always the one actually resolved, never a
# leaked override from whatever pack launched the swarm this test happens
# to run inside.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

mk_root() {
  local root; root="$(cd "$(mktemp -d)" && pwd -P)"
  mkdir -p "$root/swarmforge/roles" "$root/.swarmforge"
  touch "$root/swarmforge/constitution.prompt"
  for role in coordinator specifier; do
    echo "role prompt" > "$root/swarmforge/roles/$role.prompt"
  done
  echo "$root"
}

read_identity_value() {
  local file="$1" key="$2"
  grep -P "^${key}\t" "$file" | head -1 | cut -f2-
}

# ── 1: a --pack/SWARMFORGE_CONFIG override's cap is the one persisted,
#      not the default file's ──────────────────────────────────────────────
ROOT1="$(mk_root)"
cat > "$ROOT1/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window specifier claude master --model x
CONF
mkdir -p "$ROOT1/altpack"
cat > "$ROOT1/altpack/lean.conf" <<'CONF'
config active_backlog_max_depth 1
window specifier claude master --model x
CONF
env -u SWARMFORGE_CONFIG SWARMFORGE_CONFIG="$ROOT1/altpack/lean.conf" \
  zsh -c "source '$SWARMFORGE_SH' '$ROOT1'; parse_config; check_primacy; write_swarm_identity_file"
IDENTITY1="$ROOT1/.swarmforge/swarm-identity"
[[ -f "$IDENTITY1" ]] || fail "01: swarm-identity file was not written"
[[ "$(read_identity_value "$IDENTITY1" active_backlog_max_depth)" == "1" ]] \
  || fail "01: expected the persisted effective cap to be the PACK's 1, got: $(cat "$IDENTITY1")"
[[ "$(read_identity_value "$IDENTITY1" active_backlog_max_depth_conf_path)" == "$ROOT1/altpack/lean.conf" ]] \
  || fail "01: expected the persisted conf path to be the pack override, got: $(cat "$IDENTITY1")"
pass "depth-cap-override-01: a pack/SWARMFORGE_CONFIG override's cap and config path are persisted"

# ── 2: a bare launch (no override) persists the default file's own cap and
#      path, unchanged from today's behavior ───────────────────────────────
ROOT2="$(mk_root)"
cat > "$ROOT2/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth 3
window specifier claude master --model x
CONF
env -u SWARMFORGE_CONFIG \
  zsh -c "source '$SWARMFORGE_SH' '$ROOT2'; parse_config; check_primacy; write_swarm_identity_file"
IDENTITY2="$ROOT2/.swarmforge/swarm-identity"
[[ "$(read_identity_value "$IDENTITY2" active_backlog_max_depth)" == "3" ]] \
  || fail "02: expected the default file's own cap (3) persisted for a bare launch, got: $(cat "$IDENTITY2")"
[[ "$(read_identity_value "$IDENTITY2" active_backlog_max_depth_conf_path)" == "$ROOT2/swarmforge/swarmforge.conf" ]] \
  || fail "02: expected the default tracked config path persisted, got: $(cat "$IDENTITY2")"
pass "depth-cap-override-02: a bare launch (no override) persists the default config's own cap and path"

# ── 3: no pack's own declared cap value is rewritten by resolving/persisting
#      the effective cap (BL-313 scope item 4/5) ────────────────────────────
[[ "$(cat "$ROOT1/swarmforge/swarmforge.conf")" == *"active_backlog_max_depth -1"* ]] \
  || fail "03: the default file's own -1 must be untouched"
[[ "$(cat "$ROOT1/altpack/lean.conf")" == *"active_backlog_max_depth 1"* ]] \
  || fail "03: the pack conf's own 1 must be untouched"
pass "depth-cap-override-04: resolving/persisting the effective cap never rewrites any conf file's own declared value"

rm -rf "$ROOT1" "$ROOT2"

# ── 4: the launch banner's source states the effective cap and its source
#      (structural: locks the wiring - the value itself is proven correct
#      by resolve_effective_backlog_max_depth's own backlog_depth_cli.bb
#      call, already covered by test_backlog_depth_cli.sh and the two
#      identity-persistence cases above) ────────────────────────────────────
grep -q 'active_backlog_max_depth: ${EFFECTIVE_MAX_DEPTH} (from ${CONFIG_FILE})' "$SWARMFORGE_SH" \
  || fail "04: expected the launch banner to print the effective active_backlog_max_depth and its source config"
pass "depth-cap-override-03: the launch banner states the effective active_backlog_max_depth and which config supplied it"

echo "ALL PASS"
