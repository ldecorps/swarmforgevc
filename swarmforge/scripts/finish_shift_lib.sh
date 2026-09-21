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
source "$SCRIPT_DIR/babysitterd_census_lib.sh"

# BL-1393: THE closing ceremony - one sequence, on every sleep after work.
#
# Until 2026-09-04 this called the BL-820 lean CLI directly and nothing else,
# while BL-658's full ceremony (freeze, drain, briefing, email, stop) ran only
# inside the daemon's overnight window. A weekday 17:00 bedtime - the ordinary
# way this swarm sleeps - therefore got the lean pass alone and the full
# ceremony never ran on a weekday at all. The human's directive was "820 should
# be part of 658. the closing ceremony should happen each time the swarm does
# at least 1 shift and goes to sleep", so bedtime now drives the ONE sequence
# and the lean pass is a step inside it.
#
# `--sleep-path finish-shift` says "this stop is a sleep": the ceremony runs
# whatever the hour, where the daemon's own trigger stays gated by its closure
# window. A missing compile is a loud skip, never a bedtime failure - the
# ceremony is additive to bedtime's own contract (BL-762), not a new way for it
# to fail closed.
#
# BL-1640: a single tick is ONE step of the ceremony's state machine (freeze,
# OR drain-to-briefing, OR briefing-to-done) - the daemon's later sweeps used
# to drive the rest, but finish-shift stops the stack seconds after this
# call, so a weekday bedtime got only the freeze and nothing after it (no
# lean packet, no documenter instruction). This now LOOPS the same CLI,
# unchanged, until its own state reports the sleep done, bounded by a
# ceiling (the state's own hardDeadlineMs, which already folds in the drain
# and briefing budgets, plus a fixed grace) so bedtime still never hangs on a
# ceremony that never finishes.
#
# Seams (tests):
#   FINISH_SHIFT_CEREMONY_CLI            — override the CLI path/command
#                                           entirely (the fixture never has
#                                           its own compiled extension/out;
#                                           scenario 06 also uses this to
#                                           swap in a stand-in that never
#                                           reports done).
#   FINISH_SHIFT_CEREMONY_TICK_SECONDS   — sleep between ticks (default 30,
#                                           0 in tests).
_finish_shift_ceremony_lib_dir() {
  cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
}

# The decision helper lives in THIS repo's own compiled machinery, resolved
# from where this library file sits - never from `--target`, which may be an
# unrelated (or fixture) root with no compiled extension/out of its own.
_finish_shift_ceremony_repo_root() {
  cd "$(_finish_shift_ceremony_lib_dir)/../.." && pwd
}

_finish_shift_now_ms() {
  node -e 'process.stdout.write(String(Date.now()))'
}

# Reads .state.<field> out of one tick's JSON stdout. Empty output (never a
# bash error) on anything unreadable - absence is for the caller to decide.
_finish_shift_ceremony_state_field() {  # <json> <field>
  local json="$1" field="$2"
  printf '%s' "$json" | node -e '
    const fs = require("fs");
    try {
      const data = JSON.parse(fs.readFileSync(0, "utf8"));
      const v = data && data.state ? data.state[process.argv[1]] : undefined;
      if (v === undefined || v === null) process.exit(0);
      process.stdout.write(String(v));
    } catch {
      process.exit(0);
    }
  ' "$field" 2>/dev/null
}

# wait | done | overran — the one decision the loop below acts on, computed
# by the SAME pure function the property test covers (BL-654 invariant 1),
# never a second copy of the ceiling arithmetic here.
_finish_shift_sleep_loop_decision() {  # <phase-or-empty> <now_ms> <hard_deadline_ms>
  local phase="$1" now_ms="$2" hard_deadline_ms="$3" repo_root="$4"
  node -e '
    const path = require("path");
    const { sleepLoopDecision } = require(
      path.join(process.argv[1], "extension", "out", "quality", "nightClosingCeremonyLive.js")
    );
    const phase = process.argv[2] === "" ? undefined : process.argv[2];
    process.stdout.write(sleepLoopDecision(phase, Number(process.argv[3]), Number(process.argv[4])));
  ' "$repo_root" "$phase" "$now_ms" "$hard_deadline_ms"
}

finish_shift_run_closing_ceremony() {
  local root="$1"
  local cli="${FINISH_SHIFT_CEREMONY_CLI:-$root/extension/out/tools/night-closing-ceremony-run.js}"
  if [[ ! -f "$cli" ]]; then
    echo "finish-shift: closing-ceremony CLI not compiled ($cli) - skipping ceremony" >&2
    return 0
  fi
  local repo_root
  repo_root="$(_finish_shift_ceremony_repo_root)"
  local tick_seconds="${FINISH_SHIFT_CEREMONY_TICK_SECONDS:-30}"
  local out phase hard_deadline_ms now_ms decision

  while :; do
    if ! out="$(node "$cli" --target "$root" --sleep-path finish-shift 2>&1)"; then
      echo "finish-shift: closing ceremony exited non-zero - continuing bedtime" >&2
      echo "$out" >&2
      return 0
    fi
    hard_deadline_ms="$(_finish_shift_ceremony_state_field "$out" hardDeadlineMs)"
    if [[ -z "$hard_deadline_ms" ]]; then
      # No state at all (the gate bypass, unreachable with --sleep-path set,
      # or an unreadable tick) - never loop forever on a read failure.
      return 0
    fi
    phase="$(_finish_shift_ceremony_state_field "$out" phase)"
    now_ms="$(_finish_shift_now_ms)"
    decision="$(_finish_shift_sleep_loop_decision "$phase" "$now_ms" "$hard_deadline_ms" "$repo_root")"
    case "$decision" in
      done) return 0 ;;
      overran)
        echo "finish-shift: closing ceremony overran its budgets - stopping anyway" >&2
        return 0
        ;;
      wait) sleep "$tick_seconds" ;;
      *)
        echo "finish-shift: closing ceremony decision unreadable ($decision) - continuing bedtime" >&2
        return 0
        ;;
    esac
  done
}

finish_shift_stop_ancillaries() {
  local root="$1" component
  stop_ancillary_init "$root"
  while IFS= read -r component; do
    stop_ancillary_component "$component"
  done < <(lifecycle_matrix_stop_set finish-shift)
}

# BL-1647: kill -0 alone succeeds on a zombie (exited, not yet reaped by
# its parent) - a pidfile owner that has already exited must never read
# as running just because nothing has claimed its exit status yet.
# `ps -o stat=` is the one check both stock macOS ps and procps print a
# leading "Z" for; stock bash 3.2 throughout (BL-801/BL-1627), never
# /proc (macOS has none).
_finish_shift_pid_is_zombie() {
  local pid="$1" stat
  # `|| true`: this runs under whatever set -e the caller (the real
  # finish-shift entrypoint) has active, and a pid that has already fully
  # exited between the kill -0 check above and this one is a legitimate,
  # narrow race - ps failing here must read as "not a zombie" (stat stays
  # empty, falls through to the ordinary not-alive path), never abort the
  # whole bedtime run.
  # BSD `ps` (stock macOS) can right-justify a single-column `-o stat=`
  # value with leading whitespace even with the header suppressed - the
  # same reason specs/pipeline/scripts/reap_stale_tmp_roots.js's own
  # isZombiePid matches `/^\s*Z/` rather than a bare prefix. Strip
  # leading/trailing whitespace before comparing so this check is not
  # blind to a zombie on a platform whose ps pads it.
  stat="$(ps -o stat= -p "$pid" 2>/dev/null || true)"
  stat="${stat#"${stat%%[![:space:]]*}"}"
  [[ "$stat" == Z* ]]
}

_finish_shift_pidfile_alive() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] || return 1
  local pid
  pid="$(tr -d '[:space:]' < "$pid_file" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  ! _finish_shift_pid_is_zombie "$pid"
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
      # BL-1639: root-scoped — a babysitterd of another root (an
      # operator-local copy, a sibling worktree, a mkdtemp fixture) is
      # never counted here, matching what stop_babysitterd (and
      # kill_all_swarm.sh's BL-611 exception) actually signal.
      [[ -n "$(babysitterd_census_pids "$root")" ]]
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
