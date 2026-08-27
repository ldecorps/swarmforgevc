#!/usr/bin/env bash
# BL-628: packs/autonomous-swarm.conf is a valid autonomous-mode conf - the
# full pipeline plus a coordinator window, working its own backlog against
# its own target repo. Covers acceptance scenario BL-628
# autonomous-bootstrap-01 (the conf side of it - actually launching
# tmux panes/agents is real infrastructure bring-up, out of a unit test's
# reach; see test_second_swarm_pack.sh's own precedent).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"
PACK_CONF="$SCRIPT_DIR/../../packs/autonomous-swarm.conf"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

[[ -f "$PACK_CONF" ]] || fail "packs/autonomous-swarm.conf not found"

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

OUT="$(XDG_RUNTIME_DIR=/tmp zsh -c "source '$SWARMFORGE_SH' '$ROOT'; parse_config; check_primacy; \
  echo \"SWARM_NAME=\$SWARM_NAME\"; echo \"SWARM_MODE=\$SWARM_MODE\"; \
  echo \"ROLES=\${ROLES[*]}\"" 2>&1)"
STATUS=$?

[[ "$STATUS" -eq 0 ]] || fail "parse_config/check_primacy rejected the pack; got: $OUT"
pass "autonomous-bootstrap-01: the pack parses and passes autonomous-mode primacy validation"

grep -q "^SWARM_NAME=autonomous$" <<< "$OUT" || fail "expected the placeholder swarm_name 'autonomous'; got: $OUT"
grep -q "^SWARM_MODE=autonomous$" <<< "$OUT" || fail "expected swarm_mode 'autonomous' (no config swarm_mode line - swarmforge.sh's own default); got: $OUT"
pass "autonomous-bootstrap-01: the generated conf declares an autonomous swarm, not a secondary one"

ROLES_LINE="$(grep '^ROLES=' <<< "$OUT" | sed 's/^ROLES=//')"
for role in specifier coder cleaner architect hardender documenter QA coordinator; do
  grep -qw "$role" <<< "$ROLES_LINE" || fail "expected role '$role' in the pack; got roles: $ROLES_LINE"
done
pass "autonomous-bootstrap-01: the full pipeline (specifier..QA) IS granted a coordinator window at launch"

grep -qi "^config swarm_mode" "$PACK_CONF" && fail "the autonomous template must carry no explicit swarm_mode line - autonomous is swarmforge.sh's own default"
pass "the template relies on swarmforge.sh's own autonomous default rather than an explicit swarm_mode line"

echo "ALL PASS"
