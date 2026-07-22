#!/usr/bin/env bash
# Smoke test for openrouter_claude_env.sh + ancillary launcher OpenRouter wiring.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$SCRIPT_DIR/.." && pwd)"
PACKS="$(cd "$SRC/../packs" && pwd)"
ROOT="$(mktemp -d)"
fail=0

unset SWARMFORGE_PACK

cleanup() { rm -rf "$ROOT"; }
trap cleanup EXIT

pass() { echo "PASS: $1"; }
fail_check() { echo "FAIL: $1"; fail=1; }
check() { local msg="$1" expr="$2"; if eval "$expr"; then pass "$msg"; else fail_check "$msg"; fi }

OR_CONF="$PACKS/openrouter-anthropic-mono-router.conf"
MONO_CONF="$PACKS/mono-router.conf"

mkdir -p "$ROOT/.swarmforge"
echo 'export OPENROUTER_API_KEY=sk-or-test-key' > "$ROOT/.swarmforge/openrouter.env"
printf 'active_backlog_max_depth_conf_path\t%s\n' "$OR_CONF" > "$ROOT/.swarmforge/swarm-identity"

# shellcheck source=../openrouter_claude_env.sh
source "$SRC/openrouter_claude_env.sh"
openrouter_claude_env_load "$ROOT"
check "loads OPENROUTER_API_KEY from openrouter.env" '[[ "$OPENROUTER_API_KEY" == "sk-or-test-key" ]]'
check "detects OpenRouter as active" 'openrouter_claude_env_active'
EXPORTS="$(openrouter_claude_env_exports)"
check "exports OpenRouter base URL" '[[ "$EXPORTS" == *"openrouter.ai/api"* ]]'
check "exports ANTHROPIC_AUTH_TOKEN from OPENROUTER_API_KEY" '[[ "$EXPORTS" == *ANTHROPIC_AUTH_TOKEN* ]]'

SETTINGS_OUT="$ROOT/settings.json"
openrouter_claude_env_write_settings "$SRC/front-desk-operator.claude-settings.json" "$SETTINGS_OUT" "anthropic/claude-sonnet-5" "high"
check "writes per-launch settings with OpenRouter model slug" 'grep -q "anthropic/claude-sonnet-5" "$SETTINGS_OUT"'

DRY_FD="$(FRONT_DESK_LAUNCH_DRYRUN=1 bash "$SRC/launch_front_desk_operator.sh" "$ROOT" /tmp/fd-prompt.txt /tmp/fd-result.json 2>&1)"
check "front-desk dryrun reports openrouter provider" '[[ "$DRY_FD" == *"provider=openrouter"* ]]'

DRY_OP="$(OPERATOR_LAUNCH_DRYRUN=1 bash "$SRC/launch_operator.sh" "$ROOT" /tmp/x.jsonl 2>&1)"
check "operator dryrun reports openrouter provider" '[[ "$DRY_OP" == *"provider=openrouter"* ]]'
check "operator dryrun passes --model for OpenRouter" '[[ "$DRY_OP" == *"--model anthropic/claude-sonnet-5"* ]]'

# mono-router pack without OpenRouter key: direct Claude, no cross-vendor fallback.
ROOT2="$(mktemp -d)"
HOME_EMPTY="$(mktemp -d)"
mkdir -p "$ROOT2/.swarmforge"
printf 'active_backlog_max_depth_conf_path\t%s\n' "$MONO_CONF" > "$ROOT2/.swarmforge/swarm-identity"
DRY_DIRECT="$(
  env -i HOME="$HOME_EMPTY" PATH="$PATH" bash -c "
    unset SWARMFORGE_PACK
    FRONT_DESK_LAUNCH_DRYRUN=1 bash '$SRC/launch_front_desk_operator.sh' '$ROOT2' /tmp/fd-prompt.txt /tmp/fd-result.json 2>&1
  "
)"
check "mono-router pack uses direct Claude (claude_direct)" '[[ "$DRY_DIRECT" == *"provider=claude_direct"* ]]'
rm -rf "$ROOT2" "$HOME_EMPTY"

if [[ "$fail" -eq 0 ]]; then
  echo "openrouter_claude_env smoke: ALL CHECKS PASSED"
else
  echo "openrouter_claude_env smoke: FAILURES"; exit 1
fi
