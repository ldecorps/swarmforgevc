#!/usr/bin/env bash
# BL-091: packs/second-swarm.conf is a valid secondary-mode conf (BL-090)
# naming "second"/"primary" with the full pipeline minus coordinator - the
# conf a second, WSL2-hosted swarm launches with.
#
# Covers acceptance scenario BL-091 wsl2-swarm-01 (the conf side of it -
# actually launching tmux panes/agents is real infrastructure bring-up, out
# of a unit test's reach; see docs/runbooks/BL-091-wsl2-second-swarm-bringup.md).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"
PACK_CONF="$SCRIPT_DIR/../../packs/second-swarm.conf"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

[[ -f "$PACK_CONF" ]] || fail "packs/second-swarm.conf not found"

mk_root() {
  local root; root="$(cd "$(mktemp -d)" && pwd -P)"
  mkdir -p "$root/swarmforge/roles" "$root/.swarmforge"
  touch "$root/swarmforge/constitution.prompt"
  for role in specifier coder cleaner architect hardender documenter QA; do
    echo "role prompt" > "$root/swarmforge/roles/$role.prompt"
  done
  echo "$root"
}

ROOT="$(mk_root)"
trap 'rm -rf "$ROOT"' EXIT
cp "$PACK_CONF" "$ROOT/swarmforge/swarmforge.conf"

OUT="$(zsh -c "source '$SWARMFORGE_SH' '$ROOT'; parse_config; check_primacy; \
  echo \"SWARM_NAME=\$SWARM_NAME\"; echo \"SWARM_MODE=\$SWARM_MODE\"; \
  echo \"SWARM_MODE_PRIMARY=\$SWARM_MODE_PRIMARY\"; \
  echo \"ROLES=\${ROLES[*]}\"" 2>&1)"
STATUS=$?

[[ "$STATUS" -eq 0 ]] || fail "parse_config/check_primacy rejected the pack; got: $OUT"
pass "01: the pack parses and passes secondary-mode primacy validation"

grep -q "^SWARM_NAME=second$" <<< "$OUT" || fail "02: expected swarm_name 'second'; got: $OUT"
grep -q "^SWARM_MODE=secondary$" <<< "$OUT" || fail "02: expected swarm_mode 'secondary'; got: $OUT"
grep -q "^SWARM_MODE_PRIMARY=primary$" <<< "$OUT" || fail "02: expected swarm_mode_primary 'primary'; got: $OUT"
pass "02: the pack declares swarm_name second, secondary mode naming primary"

ROLES_LINE="$(grep '^ROLES=' <<< "$OUT" | sed 's/^ROLES=//')"
for role in specifier coder cleaner architect hardender documenter QA; do
  grep -qw "$role" <<< "$ROLES_LINE" || fail "03: expected role '$role' in the pack; got roles: $ROLES_LINE"
done
grep -qw "coordinator" <<< "$ROLES_LINE" && fail "01: secondary-mode pack must not declare a coordinator window"
pass "01/03: the full pipeline (specifier..QA) is present, with no coordinator window"

echo "ALL PASS"
