#!/usr/bin/env bash
# BL-1162: shared root-scoped swarmforge crontab line detection and filtering.
# Sourced by install/uninstall helpers — not executed directly.
set -euo pipefail

swarmforge_cron_freshness_marker() {
  local root="$1"
  printf '# swarmforge-BL-675-freshness-check root=[%s]' "$root"
}

swarmforge_cron_operator_schedule_marker() {
  local root="$1"
  printf '# swarmforge-operator-schedule root=[%s]' "$root"
}

swarmforge_cron_line_belongs_to_root() {
  local line="$1" root="$2"
  local freshness_marker operator_marker
  freshness_marker="$(swarmforge_cron_freshness_marker "$root")"
  operator_marker="$(swarmforge_cron_operator_schedule_marker "$root")"

  [[ "$line" == *"$freshness_marker"* ]] && return 0
  [[ "$line" == *"$operator_marker"* ]] && return 0
  [[ "$line" == *"# swarmforge-shift-schedule-begin $root"* ]] && return 0
  [[ "$line" == *"# swarmforge-shift-schedule-end $root"* ]] && return 0
  [[ "$line" == *"FRESHNESS_ROOT=$root "* ]] && return 0
  [[ "$line" == *"$root/.swarmforge/operator/"* ]] && return 0
  [[ "$line" == *"$root/start-swarm.sh"* ]] && return 0
  [[ "$line" == *"$root/stop-swarm.sh"* ]] && return 0
  return 1
}

swarmforge_cron_filter_out_root() {
  local root="$1"
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ -z "${line//[[:space:]]/}" ]]; then
      continue
    fi
    if swarmforge_cron_line_belongs_to_root "$line" "$root"; then
      continue
    fi
    printf '%s\n' "$line"
  done
}

swarmforge_cron_root_has_lines() {
  local root="$1" existing="${2:-}"
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    if swarmforge_cron_line_belongs_to_root "$line" "$root"; then
      return 0
    fi
  done <<< "$existing"
  return 1
}
