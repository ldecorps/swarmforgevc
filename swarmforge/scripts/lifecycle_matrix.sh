#!/usr/bin/env bash
# BL-762: single source of truth for which ancillary components each
# lifecycle verb stops vs keeps. Both finish-shift (bedtime) and
# stop_ancillary_services.sh (lights-out, via stop-swarm.sh) read this table
# instead of each encoding their own copy, so "which ancillaries does
# bedtime keep?" has one answer in one place, and adding a component here
# forces an explicit decision for EVERY verb.
#
# Deliberately plain indexed arrays, no `declare -A`: this project targets
# stock macOS /bin/bash 3.2 (see engineering.prompt's Test Speed And
# Isolation rule), which predates bash 4's associative arrays.
#
# Sourced by finish-shift and stop_ancillary_services.sh. Exposes:
#   LIFECYCLE_COMPONENTS            — the known ancillary components
#   LIFECYCLE_VERBS                 — the known lifecycle verbs
#   lifecycle_matrix_validate       — loud (stderr + non-zero) failure if any
#                                      component x verb cell is unclassified
#                                      (BL-762's first declared invariant: a
#                                      component neither in a verb's stop set
#                                      nor its keep set is an error, never a
#                                      default)
#   lifecycle_matrix_disposition <component> <verb>   — echoes stop|keep
#   lifecycle_matrix_stop_set <verb>   — newline-separated components this
#                                         verb stops
#   lifecycle_matrix_keep_set <verb>   — newline-separated components this
#                                         verb leaves running

# Order matches stop_ancillary_services.sh's pre-BL-762 execution sequence,
# so a matrix-driven iteration preserves today's exact stop order.
LIFECYCLE_COMPONENTS=(babysitterd front-desk onboarder operator-runtime tunnels)
LIFECYCLE_VERBS=(finish-shift stop-swarm)

# One entry per (component, verb) cell: "component:verb:disposition".
# lifecycle_matrix_validate below is what actually enforces every cell in
# LIFECYCLE_COMPONENTS x LIFECYCLE_VERBS is present here — this list itself
# is just data, so a missing/misspelled entry is a validation FAILURE, not a
# silent gap (BL-762's first invariant lives in the validator, not in the
# hope that this list stays complete by inspection).
LIFECYCLE_MATRIX_ENTRIES=(
  "babysitterd:finish-shift:stop"
  "babysitterd:stop-swarm:stop"
  "operator-runtime:finish-shift:stop"
  "operator-runtime:stop-swarm:stop"
  "onboarder:finish-shift:stop"
  "onboarder:stop-swarm:stop"
  "front-desk:finish-shift:keep"
  "front-desk:stop-swarm:stop"
  "tunnels:finish-shift:keep"
  "tunnels:stop-swarm:stop"
)

# Components that, left running, can relaunch a stopped agent seat.
# BL-762's second declared invariant ("bedtime never leaves running
# anything that can revive a seat it just stopped") reduces to: this list
# has empty intersection with finish-shift's keep-set. babysitterd is the
# only one today (it is a supervised respawn loop for agent seats); the
# operator runtime and onboarder burn tokens but do not relaunch a seat,
# and neither does the front desk or a tunnel.
LIFECYCLE_SEAT_REVIVING_COMPONENTS=(babysitterd)

lifecycle_matrix_disposition() {
  local component="$1" verb="$2" entry
  for entry in "${LIFECYCLE_MATRIX_ENTRIES[@]}"; do
    if [[ "$entry" == "${component}:${verb}:"* ]]; then
      echo "${entry##*:}"
      return 0
    fi
  done
  echo "lifecycle_matrix: ERROR — no classification for component \"$component\" under verb \"$verb\"" >&2
  return 1
}

lifecycle_matrix_validate() {
  local component verb value rc=0
  for component in "${LIFECYCLE_COMPONENTS[@]}"; do
    for verb in "${LIFECYCLE_VERBS[@]}"; do
      if ! value="$(lifecycle_matrix_disposition "$component" "$verb" 2>&1)"; then
        echo "lifecycle_matrix_validate: $value" >&2
        rc=1
        continue
      fi
      if [[ "$value" != "stop" && "$value" != "keep" ]]; then
        echo "lifecycle_matrix_validate: ERROR — component \"$component\" verb \"$verb\" has an invalid disposition \"$value\" (must be stop|keep)" >&2
        rc=1
      fi
    done
  done
  return "$rc"
}

lifecycle_matrix_stop_set() {
  # Explicit `return 0` at the end: without it, this function's own exit
  # status is whatever its LAST loop iteration's `[[ ... ]] && echo` left
  # behind — false (1) whenever the LAST component in LIFECYCLE_COMPONENTS
  # is classified "keep" for this verb (true today for "tunnels" under
  # "finish-shift"), which under `set -e`/pipefail silently aborts any
  # caller capturing this in a command substitution, even though the
  # function produced the exact right output. Caught by
  # test_finish_shift_lib.sh under `set -euo pipefail` — see
  # backlog/evidence/BL-762-coder-pass.md.
  local verb="$1" component
  for component in "${LIFECYCLE_COMPONENTS[@]}"; do
    [[ "$(lifecycle_matrix_disposition "$component" "$verb")" == "stop" ]] && echo "$component"
  done
  return 0
}

lifecycle_matrix_keep_set() {
  # Same explicit `return 0` and for the same reason — see
  # lifecycle_matrix_stop_set's comment above.
  local verb="$1" component
  for component in "${LIFECYCLE_COMPONENTS[@]}"; do
    [[ "$(lifecycle_matrix_disposition "$component" "$verb")" == "keep" ]] && echo "$component"
  done
  return 0
}
