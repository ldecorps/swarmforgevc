#!/usr/bin/env bash
# Pack-following ancillary provider routing — no cross-vendor fallback.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
PACKS="$(cd "$SRC/../packs" && pwd)"
fail=0

unset SWARMFORGE_PACK

pass() { echo "PASS: $1"; }
fail_check() { echo "FAIL: $1"; fail=1; }
check() { local msg="$1" expr="$2"; if eval "$expr"; then pass "$msg"; else fail_check "$msg"; fi }

# shellcheck source=../ancillary_provider_lib.sh
source "$SRC/ancillary_provider_lib.sh"

ROOT_OR="$(mktemp -d)"
ROOT_GEM="$(mktemp -d)"
cleanup() { rm -rf "$ROOT_OR" "$ROOT_GEM"; }
trap cleanup EXIT

OR_CONF="$PACKS/openrouter-anthropic-mono-router.conf"
GEM_CONF="$PACKS/gemini-mono-router.conf"

mkdir -p "$ROOT_OR/.swarmforge" "$ROOT_GEM/.swarmforge"
echo 'export OPENROUTER_API_KEY=sk-or-test' > "$ROOT_OR/.swarmforge/openrouter.env"
printf 'active_backlog_max_depth_conf_path\t%s\n' "$OR_CONF" > "$ROOT_OR/.swarmforge/swarm-identity"
printf 'active_backlog_max_depth_conf_path\t%s\n' "$GEM_CONF" > "$ROOT_GEM/.swarmforge/swarm-identity"
export GEMINI_API_KEY=gem-test-key

ancillary_provider_load "$ROOT_OR"
check "openrouter pack resolves family" '[[ "$(ancillary_provider_family)" == openrouter ]]'
check "openrouter pack name from identity" '[[ "$(ancillary_provider_pack)" == openrouter-anthropic-mono-router ]]'

ancillary_provider_load "$ROOT_GEM"
check "gemini pack resolves family" '[[ "$(ancillary_provider_family)" == gemini ]]'
check "gemini pack clears OpenRouter routing vars" '[[ -z "${OPENROUTER_API_KEY:-}" && -z "${ANTHROPIC_BASE_URL:-}" ]]'

# Gemini pack must not silently use OpenRouter even if a stale key exists in the env.
ROOT_GEM2="$(mktemp -d)"
mkdir -p "$ROOT_GEM2/.swarmforge"
printf 'active_backlog_max_depth_conf_path\t%s\n' "$GEM_CONF" > "$ROOT_GEM2/.swarmforge/swarm-identity"
HOME_EMPTY="$(mktemp -d)"
FAIL_MSG="$(
  env -i HOME="$HOME_EMPTY" PATH="$PATH" OPENROUTER_API_KEY=stale-or-key bash -c "
    unset SWARMFORGE_PACK GEMINI_API_KEY SWARMFORGE_GEMINI_API_KEY
    source '$SRC/ancillary_provider_lib.sh'
    ancillary_provider_load '$ROOT_GEM2'
    ancillary_provider_require_credentials 2>&1 || true
  "
)"
check "gemini pack fails without GEMINI_API_KEY (no OpenRouter fallback)" '[[ "$FAIL_MSG" == *"requires GEMINI_API_KEY"* ]]'
rm -rf "$ROOT_GEM2" "$HOME_EMPTY"

ancillary_provider_load "$ROOT_GEM"
check "gemini front desk model" '[[ "$(ancillary_provider_default_model front_desk)" == gemini-2.5-flash ]]'

if [[ "$fail" -eq 0 ]]; then
  echo "ancillary_provider_lib smoke: ALL CHECKS PASSED"
else
  echo "ancillary_provider_lib smoke: FAILURES"; exit 1
fi
