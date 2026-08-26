#!/usr/bin/env bash
# Guard against bare ./swarm relaunch downgrading mono-router → full pack.
# Exercises swarm_launch_pack_guard.bb and swarmforge.sh's early check without
# launching tmux (ZSH_EVAL_CONTEXT guard skips the launch body when sourced).

set -euo pipefail

unset SWARMFORGE_CONFIG SWARMFORGE_PACK SWARMFORGE_ALLOW_FULL_PACK

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"
GUARD="$SCRIPT_DIR/../swarm_launch_pack_guard.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

mk_fixture_root() {
  local root
  root="$(cd "$(mktemp -d)" && pwd -P)"
  mkdir -p "$root/swarmforge/packs" "$root/swarmforge/roles" "$root/.swarmforge"
  touch "$root/swarmforge/constitution.prompt"
  echo "role prompt" > "$root/swarmforge/roles/coder.prompt"
  echo "config active_backlog_max_depth -1" > "$root/swarmforge/swarmforge.conf"
  echo "config rotation router" > "$root/swarmforge/packs/openrouter-anthropic-mono-router.conf"
  echo "$root"
}

# ── 01: bare default config blocked when identity says mono-router ───────────
ROOT="$(mk_fixture_root)"
trap 'rm -rf "$ROOT"' EXIT

printf 'launch_pack\topenrouter-anthropic-mono-router\nrotation\trouter\nactive_backlog_max_depth_conf_path\t%s/swarmforge/packs/openrouter-anthropic-mono-router.conf\n' \
  "$ROOT" > "$ROOT/.swarmforge/swarm-identity"

if bb "$GUARD" check "$ROOT" "$ROOT/swarmforge/swarmforge.conf" "" "" 0 "" 2>/dev/null; then
  fail "01: expected guard to block bare default config on mono-router project"
fi
pass "01: guard blocks bare ./swarm default config on mono-router project"

# ── 02: explicit --pack is allowed ─────────────────────────────────────────
if ! bb "$GUARD" check "$ROOT" "$ROOT/swarmforge/swarmforge.conf" "" "" 1 "" >/dev/null; then
  fail "02: expected explicit --pack to bypass guard"
fi
pass "02: explicit --pack bypasses guard"

# ── 03: SWARMFORGE_ALLOW_FULL_PACK=1 is allowed ────────────────────────────
if ! bb "$GUARD" check "$ROOT" "$ROOT/swarmforge/swarmforge.conf" "" "" 0 1 >/dev/null; then
  fail "03: expected SWARMFORGE_ALLOW_FULL_PACK=1 to bypass guard"
fi
pass "03: SWARMFORGE_ALLOW_FULL_PACK=1 bypasses guard"

# ── 04: rotation pack config is allowed even without CLI flag ─────────────
if ! bb "$GUARD" check "$ROOT" "$ROOT/swarmforge/packs/openrouter-anthropic-mono-router.conf" "" "" 0 "" >/dev/null; then
  fail "04: expected rotation pack config to pass guard"
fi
pass "04: implicit launch with rotation pack config passes guard"

# ── 05: write_swarm_identity_file persists launch_pack ─────────────────────
OUT_DIR="$ROOT/.out05"
mkdir -p "$OUT_DIR"
cat > "$ROOT/swarmforge/packs/test-mono-router.conf" <<'CONF'
config rotation router
window coder claude coder --model x
CONF

zsh -c "
  source '$SWARMFORGE_SH' '$ROOT' --pack test-mono-router
  parse_config
  write_swarm_identity_file
" >/dev/null

grep -q $'launch_pack\ttest-mono-router' "$ROOT/.swarmforge/swarm-identity" \
  || fail "05: expected launch_pack in swarm-identity"
pass "05: write_swarm_identity_file persists launch_pack"

# ── 06: existing BL-090 identity helpers still work ────────────────────────
bash "$SCRIPT_DIR/test_swarm_identity_lib.sh"
pass "06: BL-090 swarm identity helpers unchanged"

echo "ALL PASS"
