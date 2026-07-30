#!/usr/bin/env bash
# BL-637: scan for known full-stack survivors after teardown.
#
# Parses `ps -eo pid=,args=` (never `pgrep -f` / `ps | grep`) so the auditing
# shell's own argv cannot invent phantom survivors.
#
# Sourced by stop-swarm.sh. Exposes:
#   stack_survivor_lines  — newline-separated "pid args" for known survivors
#   stack_survivor_names  — human labels (babysitterd / Operator)
#
# Optional env:
#   SWARMFORGE_SURVIVOR_PS_FILE  — read ps snapshot from this file (tests)

stack_survivor_scan() {
  local self=$$
  local ps_out line pid rest
  stack_survivor_lines=""
  stack_survivor_names=""

  if [[ -n "${SWARMFORGE_SURVIVOR_PS_FILE:-}" && -f "$SWARMFORGE_SURVIVOR_PS_FILE" ]]; then
    ps_out="$(cat "$SWARMFORGE_SURVIVOR_PS_FILE")"
  else
    ps_out="$(ps -eo pid=,args= 2>/dev/null || true)"
  fi

  local found_bb=0 found_op=0
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    pid="$(printf '%s\n' "$line" | awk '{print $1}')"
    rest="$(printf '%s\n' "$line" | sed -E 's/^[[:space:]]*[0-9]+[[:space:]]*//')"
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    [[ "$pid" != "$self" ]] || continue
    case "$rest" in
      *stack_survivor_scan*|*stop-swarm.sh*|*kill_pipeline_swarm.sh*|*kill_all_swarm.sh*) continue ;;
    esac

    if [[ "$rest" == *babysitterd.sh* ]]; then
      stack_survivor_lines+="${pid} ${rest}"$'\n'
      found_bb=1
    elif [[ "$rest" == *"--remote-control Operator"* ]]; then
      stack_survivor_lines+="${pid} ${rest}"$'\n'
      found_op=1
    fi
  done <<< "$ps_out"

  [[ "$found_bb" -eq 1 ]] && stack_survivor_names+="babysitterd "
  [[ "$found_op" -eq 1 ]] && stack_survivor_names+="Operator "
  stack_survivor_names="${stack_survivor_names%% }"
  stack_survivor_lines="${stack_survivor_lines%$'\n'}"
  [[ -n "$stack_survivor_lines" ]]
}
