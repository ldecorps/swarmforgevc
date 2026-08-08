#!/usr/bin/env bash
# BL-762: the bedtime verb's library. finish-shift stops the token-burning
# ancillaries (babysitterd, operator runtime, onboarder) and the full
# pipeline, while leaving the phone path (Telegram front desk + remote
# tunnels) reachable — composed from stop_ancillary_services.sh's named
# component functions and kill_pipeline_swarm.sh, never a second teardown
# implementation.
#
# Sourced by ./finish-shift (repo root). Exposes:
#   finish_shift_stop_ancillaries <root>       — stops finish-shift's
#                                                 lifecycle_matrix.sh-driven
#                                                 stop-set
#   finish_shift_keep_snapshot <root>          — sets
#                                                 finish_shift_keep_running to
#                                                 the newline-separated
#                                                 keep-set components
#                                                 CURRENTLY showing a live
#                                                 process (a before/after
#                                                 snapshot, not a verdict)
#   finish_shift_verify <root> <before-running>  — BL-637-style verify,
#                                                 extended to bedtime's own
#                                                 contract: refuses success
#                                                 while a stop-set component
#                                                 still shows a live
#                                                 process, OR a keep-set
#                                                 component that WAS running
#                                                 before finish-shift ran is
#                                                 no longer running now.
#                                                 A keep-set component that
#                                                 was already down before
#                                                 finish-shift ran is not
#                                                 bedtime's problem (BL-762
#                                                 idempotent-05: an
#                                                 already-stopped swarm's
#                                                 kept components stay
#                                                 "unchanged", not "forced
#                                                 up"). Sets
#                                                 finish_shift_verify_survivors
#                                                 / _unexpectedly_stopped
#                                                 (newline-separated);
#                                                 returns 0 when either is
#                                                 non-empty (a problem
#                                                 exists — same truthy
#                                                 convention as
#                                                 stack_survivor_scan.sh).
#
# Optional env (tests):
#   SWARMFORGE_SURVIVOR_PS_FILE  — same seam stack_survivor_scan.sh uses;
#                                   read a ps snapshot from this file instead
#                                   of the real process table.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lifecycle_matrix.sh"
source "$SCRIPT_DIR/stop_ancillary_services.sh"

# BL-820: the closing-ceremony lean pass - a named step invoked before the
# shift fully winds down (called from ./finish-shift ahead of
# kill_pipeline_swarm.sh, while ancillaries and the pipeline are still up).
# Wraps the compiled extension/out/tools/closing-ceremony-run.js CLI, which
# owns the real behavior (fold BL-819's ledger into a shift packet, deliver
# it to the specifier via swarm_handoff.sh, or auto-record an explicit
# no-change outcome for an empty shift). A missing compile is a loud skip,
# never a bedtime failure - the ceremony is additive to bedtime's own
# contract (BL-762), not a new way for it to fail closed.
finish_shift_run_closing_ceremony() {
  local root="$1"
  local cli="$root/extension/out/tools/closing-ceremony-run.js"
  if [[ ! -f "$cli" ]]; then
    echo "finish-shift: closing-ceremony CLI not compiled ($cli) - skipping lean pass" >&2
    return 0
  fi
  if ! node "$cli" --target "$root"; then
    echo "finish-shift: closing-ceremony lean pass exited non-zero - continuing bedtime" >&2
  fi
}

finish_shift_stop_ancillaries() {
  local root="$1" component
  stop_ancillary_init "$root"
  while IFS= read -r component; do
    stop_ancillary_component "$component"
  done < <(lifecycle_matrix_stop_set finish-shift)
}

_finish_shift_pidfile_alive() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] || return 1
  local pid
  pid="$(tr -d '[:space:]' < "$pid_file" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

_finish_shift_ps_matches() {
  local pattern="$1" ps_out self=$$
  if [[ -n "${SWARMFORGE_SURVIVOR_PS_FILE:-}" && -f "$SWARMFORGE_SURVIVOR_PS_FILE" ]]; then
    ps_out="$(cat "$SWARMFORGE_SURVIVOR_PS_FILE")"
  else
    ps_out="$(ps -eo pid=,args= 2>/dev/null || true)"
  fi
  local line pid rest
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    pid="$(printf '%s\n' "$line" | awk '{print $1}')"
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    [[ "$pid" != "$self" ]] || continue
    rest="$(printf '%s\n' "$line" | sed -E 's/^[[:space:]]*[0-9]+[[:space:]]*//')"
    case "$rest" in
      $pattern) return 0 ;;
    esac
  done <<< "$ps_out"
  return 1
}

# Per-component "is a live process still up" check. babysitterd/operator-
# runtime reuse stack_survivor_scan.sh's own ps patterns (BL-637's tested
# survivor signatures); onboarder/front-desk/tunnels check their pidfiles
# directly (kill -0), the same liveness idiom stop_ancillary_services.sh's
# own signal_pid_file already trusts.
finish_shift_component_running() {
  local root="$1" component="$2"
  local op_dir="$root/.swarmforge/operator"
  case "$component" in
    babysitterd)
      _finish_shift_ps_matches "*babysitterd.sh*"
      ;;
    operator-runtime)
      _finish_shift_ps_matches "*--remote-control Operator*"
      ;;
    onboarder)
      _finish_shift_pidfile_alive "$op_dir/onboarder-supervisor.pid" \
        || _finish_shift_pidfile_alive "$op_dir/onboarding-facilitator-supervisor.pid"
      ;;
    front-desk)
      _finish_shift_pidfile_alive "$op_dir/front-desk-supervisor.pid"
      ;;
    tunnels)
      _finish_shift_pidfile_alive "$op_dir/resident-spy-cloudflared.pid"
      ;;
    *)
      echo "finish_shift_component_running: ERROR — unknown component \"$component\"" >&2
      return 2
      ;;
  esac
}

# Snapshot of finish-shift's keep-set components currently showing a live
# process — call BEFORE finish_shift_stop_ancillaries so finish_shift_verify
# can tell "was running, now isn't" (a real regression) apart from "was
# never running" (nothing to verify stays up).
finish_shift_keep_snapshot() {
  local root="$1" component
  finish_shift_keep_running=""
  while IFS= read -r component; do
    if finish_shift_component_running "$root" "$component"; then
      finish_shift_keep_running+="${component}"$'\n'
    fi
  done < <(lifecycle_matrix_keep_set finish-shift)
  finish_shift_keep_running="${finish_shift_keep_running%$'\n'}"
}

_finish_shift_contains_line() {
  local needle="$1" haystack="$2" line
  while IFS= read -r line; do
    [[ "$line" == "$needle" ]] && return 0
  done <<< "$haystack"
  return 1
}

finish_shift_verify() {
  local root="$1" before_running="$2" component
  finish_shift_verify_survivors=""
  finish_shift_verify_unexpectedly_stopped=""

  while IFS= read -r component; do
    if finish_shift_component_running "$root" "$component"; then
      finish_shift_verify_survivors+="${component}"$'\n'
    fi
  done < <(lifecycle_matrix_stop_set finish-shift)

  while IFS= read -r component; do
    if _finish_shift_contains_line "$component" "$before_running" \
       && ! finish_shift_component_running "$root" "$component"; then
      finish_shift_verify_unexpectedly_stopped+="${component}"$'\n'
    fi
  done < <(lifecycle_matrix_keep_set finish-shift)

  finish_shift_verify_survivors="${finish_shift_verify_survivors%$'\n'}"
  finish_shift_verify_unexpectedly_stopped="${finish_shift_verify_unexpectedly_stopped%$'\n'}"
  [[ -n "$finish_shift_verify_survivors" || -n "$finish_shift_verify_unexpectedly_stopped" ]]
}
