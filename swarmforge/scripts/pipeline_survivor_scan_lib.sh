#!/usr/bin/env bash
# BL-730: kill_pipeline_swarm.sh's post-teardown "remaining survivors" check,
# scoped to $ROOT so a sibling worktree's own handoffd.bb / copilot process
# is never reported. Parses `ps -eo pid=,args=` (never `pgrep -f`), the same
# technique stack_survivor_scan.sh (BL-637) already established, so the
# scanning shell's own argv can never invent a phantom survivor of itself.
#
# Sourced by kill_pipeline_swarm.sh. Exposes:
#   pipeline_survivor_scan <root>  — sets pipeline_survivor_lines, returns
#     0 (true) when at least one survivor of <root> is found.
#
# Optional env:
#   SWARMFORGE_PIPELINE_SURVIVOR_PS_FILE  — read a ps snapshot from this
#     file instead of the live `ps` (tests).

pipeline_survivor_scan() {
  local root="${1:?usage: pipeline_survivor_scan <root>}"
  local self=$$
  local ps_out line pid rest
  pipeline_survivor_lines=""

  if [[ -n "${SWARMFORGE_PIPELINE_SURVIVOR_PS_FILE:-}" && -f "$SWARMFORGE_PIPELINE_SURVIVOR_PS_FILE" ]]; then
    ps_out="$(cat "$SWARMFORGE_PIPELINE_SURVIVOR_PS_FILE")"
  else
    ps_out="$(ps -eo pid=,args= 2>/dev/null || true)"
  fi

  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    pid="$(printf '%s\n' "$line" | awk '{print $1}')"
    rest="$(printf '%s\n' "$line" | sed -E 's/^[[:space:]]*[0-9]+[[:space:]]*//')"
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    [[ "$pid" != "$self" ]] || continue
    case "$rest" in
      *pipeline_survivor_scan*|*kill_pipeline_swarm.sh*|*kill_all_swarm.sh*) continue ;;
    esac

    if [[ "$rest" == *"handoffd.bb"* && "$rest" == *"$root"* ]]; then
      pipeline_survivor_lines+="${pid} ${rest}"$'\n'
    elif [[ "$rest" == *"copilot"* && "$rest" == *"SwarmForge"* && "$rest" == *"$root"* ]]; then
      pipeline_survivor_lines+="${pid} ${rest}"$'\n'
    fi
  done <<< "$ps_out"

  pipeline_survivor_lines="${pipeline_survivor_lines%$'\n'}"
  [[ -n "$pipeline_survivor_lines" ]]
}
