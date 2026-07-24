#!/usr/bin/env zsh
# BL-563: real-code harness for the JS step handlers - sources the REAL
# swarmforge.sh against a fixture project root and calls its own functions
# directly (write_role_launch_script for the settings-file scenarios,
# write_agent_instruction_file for the compose scenario), never
# reimplementing swarmforge.sh's own overlay-resolution decisions in JS.
#
# Usage: bl563ModelFactoryHarness.sh <settings|compose> <root> <role> <swarmforge.sh path>
# MODEL_FACTORY_STATE_DIR should be exported by the caller (fixture root has
# no copy of swarmforge/scripts of its own, so model_factory_cli.bb's own
# repo-root-derived default would otherwise read THIS repo's real
# .swarmforge/model-factory/ instead of the fixture's).
set -euo pipefail

MODE="${1:?Usage: bl563ModelFactoryHarness.sh <settings|compose> <root> <role> <swarmforge.sh path>}"
ROOT="${2:?}"
ROLE="${3:?}"
SWARMFORGE_SH="${4:?}"

source "$SWARMFORGE_SH" "$ROOT"
parse_config

index_of_role() {
  local target="$1" i
  for (( i = 1; i <= ${#ROLES[@]}; i++ )); do
    [[ "${ROLES[$i]}" == "$target" ]] && { echo "$i"; return; }
  done
}

idx="$(index_of_role "$ROLE")"
if [[ -z "$idx" ]]; then
  echo "bl563ModelFactoryHarness: unknown role $ROLE" >&2
  exit 1
fi

case "$MODE" in
  settings)
    write_role_launch_script "$idx" >/dev/null
    ;;
  compose)
    agent="${AGENTS[$idx]}"
    resolved_model="$(resolve_claude_model_for_index "$idx")"
    write_agent_instruction_file "$ROLE" "$PROMPTS_DIR/${ROLE}.md" "$agent" "$resolved_model"
    ;;
  *)
    echo "bl563ModelFactoryHarness: unknown mode $MODE" >&2
    exit 1
    ;;
esac
