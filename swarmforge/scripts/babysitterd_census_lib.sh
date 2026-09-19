#!/usr/bin/env bash
# BL-1639: one root-scoped babysitterd census, shared by finish-shift's
# stop (stop_ancillary_services.sh), its verify (finish_shift_lib.sh) and
# kill_all_swarm.sh's BL-611 babysitterd signal. Before this file, the
# stop signalled ONE pidfile while the verify matched every process whose
# args contained "babysitterd.sh" from ANY root, so a second babysitterd
# (an operator-local copy, a sibling worktree, a mkdtemp fixture) was
# counted by the verify and never reached by the stop: finish-shift
# refused with rc=1 while the orphan kept running.
#
# Root scoping (FIRM, the ticket's invariant 2): a babysitterd whose
# script path sits directly under <root>/swarmforge/scripts/ or
# <root>/.swarmforge/operator/, OR whose args carry a whitespace-delimited
# token equal to <root> exactly (the tracked daemon's own root argument),
# belongs to this root. A path merely PREFIXED by root (a sibling
# worktree, e.g. <root>/.worktrees/coder/...) is another root — checked by
# exact dirname equality, never a prefix match.
#
# Pure function of (root, ps snapshot) — testable with no process alive.
#
# Optional env (tests):
#   SWARMFORGE_SURVIVOR_PS_FILE            — same seam finish_shift_lib.sh
#                                             and stack_survivor_scan.sh
#                                             already honour: read a ps
#                                             snapshot from this file
#                                             instead of the real process
#                                             table.
#   SWARMFORGE_CENSUS_SIGNAL_RECORD_FILE   — when set,
#                                             babysitterd_census_signal_pid
#                                             appends "<pid>\n" to this
#                                             file instead of sending a
#                                             real signal — tests never
#                                             send a real signal to a
#                                             fabricated (ps-snapshot-only)
#                                             pid.

# Every pid, from the ps snapshot, whose args name babysitterd.sh AND
# belong to $root — one pid per line, newline-separated, empty when none.
babysitterd_census_pids() {
  local root="$1" ps_out self=$$
  root="${root%/}"
  if [[ -n "${SWARMFORGE_SURVIVOR_PS_FILE:-}" && -f "$SWARMFORGE_SURVIVOR_PS_FILE" ]]; then
    ps_out="$(cat "$SWARMFORGE_SURVIVOR_PS_FILE")"
  else
    ps_out="$(ps -eo pid=,args= 2>/dev/null || true)"
  fi
  local line pid rest token script_token found dir
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    pid="$(printf '%s\n' "$line" | awk '{print $1}')"
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    [[ "$pid" != "$self" ]] || continue
    rest="$(printf '%s\n' "$line" | sed -E 's/^[[:space:]]*[0-9]+[[:space:]]*//')"
    case "$rest" in
      *babysitterd.sh*) ;;
      *) continue ;;
    esac
    script_token=""
    found=0
    for token in $rest; do
      case "$token" in
        */babysitterd.sh|babysitterd.sh) script_token="$token" ;;
      esac
      if [[ "$token" == "$root" ]]; then
        found=1
      fi
    done
    [[ -n "$script_token" ]] || continue
    if [[ "$found" -eq 0 ]]; then
      dir="${script_token%/*}"
      if [[ "$dir" == "$root/swarmforge/scripts" || "$dir" == "$root/.swarmforge/operator" ]]; then
        found=1
      fi
    fi
    if [[ "$found" -eq 1 ]]; then
      printf '%s\n' "$pid"
    fi
  done <<< "$ps_out"
}

# Signal one pid — TERM, then KILL after the same short wait
# signal_pid_file/signal_pid already use — unless
# SWARMFORGE_CENSUS_SIGNAL_RECORD_FILE is set, in which case the pid is
# recorded instead of signalled (the test seam: a ps-snapshot-only pid
# fixture is never a real, killable process).
babysitterd_census_signal_pid() {
  local pid="$1"
  if [[ -n "${SWARMFORGE_CENSUS_SIGNAL_RECORD_FILE:-}" ]]; then
    printf '%s\n' "$pid" >> "$SWARMFORGE_CENSUS_SIGNAL_RECORD_FILE"
    return 0
  fi
  kill -TERM "$pid" 2>/dev/null || true
  sleep 0.3
  kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null || true
}

# Signal every pid the census names for $root.
babysitterd_census_signal() {
  local root="$1" pid
  while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    babysitterd_census_signal_pid "$pid"
  done < <(babysitterd_census_pids "$root")
}
