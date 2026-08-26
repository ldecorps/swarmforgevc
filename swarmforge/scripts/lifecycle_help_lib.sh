#!/usr/bin/env bash
# BL-736: shared --help bodies for launch_/start_ lifecycle entry points.
# Sourced by lifecycle scripts; not executed directly.

print_lifecycle_help() {
  # $1=script basename  $2=title suffix after em dash
  # $3=stop line (optional)  $4=usage line (optional)  $5=extra body (optional)
  local script_name="$1"
  local title_suffix="$2"
  local stop_line="${3:-Stop: stop_ancillary_services.sh / ./stop-swarm.sh (or ./swarm-kill for pipeline-only)}"
  local usage_line="${4:-Usage: see header comments above.}"
  local extra_block="${5:-}"
  if [[ -n "$extra_block" ]]; then
    printf '%s\n\n%s\n\n%s\n\n%s\n' \
      "${script_name} — ${title_suffix}" \
      "${stop_line}" \
      "${extra_block}" \
      "${usage_line}"
  else
    printf '%s\n\n%s\n\n%s\n' \
      "${script_name} — ${title_suffix}" \
      "${stop_line}" \
      "${usage_line}"
  fi
}

print_kill_pipeline_help() {
  cat <<'EOF'
kill_pipeline_swarm.sh — pipeline-only stop.

Scope: pipeline-only
Stops: role agents, handoffd (+ supervisor), stale tmux sockets, state markers.
Does NOT stop: operator runtime, Telegram front desk, onboarder, tunnels,
               operator-launched babysitterd outside managed paths.

Full stack stop: ./stop-swarm.sh
Legacy alias: kill_all_swarm.sh
EOF
}
