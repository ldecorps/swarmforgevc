#!/usr/bin/env bash
# BL-1703: ollama as a swarm-managed ancillary process, start-and-probe half
# (BL-1704 sources this same lib for the stop side). Sourced by
# swarmforge.sh (zsh) at launch time and, for tests, run directly under
# bash - every function here uses only constructs identical under POSIX
# sh, bash 3.2, and zsh: no arrays, no bash-4-only builtins. The caller
# supplies whatever it already resolved (whether the pack uses the local
# endpoint, the endpoint URL) as plain arguments; this file never inspects
# a pack conf or a shell array itself (BL-1703's own direction: "read the
# pack conf the launch path already resolved; do not re-derive it").
#
# BL-1727: ollama_ancillary_stop_pid's own bounds - seconds of TERM grace
# before escalating to KILL, the poll interval while waiting, and a short
# wait after KILL before giving up and reporting failure. `:=` only sets a
# value when unset/null, so a test can override any of the three by
# exporting it before sourcing this file; production keeps the defaults, a
# real server time to shut down cleanly.
: "${OLLAMA_ANCILLARY_STOP_TERM_GRACE_SECONDS:=5}"
: "${OLLAMA_ANCILLARY_STOP_KILL_GRACE_SECONDS:=2}"
: "${OLLAMA_ANCILLARY_STOP_POLL_INTERVAL_SECONDS:=1}"

# The same two probe paths swarmforge.sh's own local_model_endpoint_ready
# already uses (Ollama's native tags endpoint, then the OpenAI /models
# path) - kept identical so a healthy answer means the same thing in both
# places.
ollama_ancillary_probe() {
  local url="$1"
  local probe_root="${url%/v1}"
  curl -sf --max-time 2 "${probe_root}/api/tags" >/dev/null 2>&1 \
    && return 0
  curl -sf --max-time 2 "${url}/models" >/dev/null 2>&1
}

ollama_ancillary_record_path() {
  local state_dir="$1"
  printf '%s/ollama/serve.json\n' "$state_dir"
}

# owner is "external" or "swarm-owned"; pid/started_at are empty for
# "external" (the swarm never started it, so it has nothing of its own to
# record about the process).
ollama_ancillary_write_record() {
  local record_path="$1"
  local owner="$2"
  local pid="$3"
  local started_at="$4"
  local endpoint="$5"
  local record_dir
  record_dir="$(dirname "$record_path")"
  mkdir -p "$record_dir"
  {
    printf '{\n'
    printf '  "owner": "%s",\n' "$owner"
    if [ -n "$pid" ]; then
      printf '  "pid": %s,\n' "$pid"
    else
      printf '  "pid": null,\n'
    fi
    if [ -n "$started_at" ]; then
      printf '  "startedAt": "%s",\n' "$started_at"
    else
      printf '  "startedAt": null,\n'
    fi
    printf '  "endpoint": "%s"\n' "$endpoint"
    printf '}\n'
  } > "$record_path"
}

# Starts `<binary> serve` detached, models dir and context length taken
# from the caller's own resolved swarm.env values (empty means: leave the
# corresponding ollama env var unset, matching whatever the binary already
# defaults to). Prints the started pid on stdout.
ollama_ancillary_start_server() {
  local binary="$1"
  local models_dir="$2"
  local context_length="$3"
  local log_path="$4"
  local log_dir
  log_dir="$(dirname "$log_path")"
  mkdir -p "$log_dir"
  if [ -n "$models_dir" ]; then
    OLLAMA_MODELS="$models_dir"
    export OLLAMA_MODELS
  fi
  if [ -n "$context_length" ]; then
    OLLAMA_CONTEXT_LENGTH="$context_length"
    export OLLAMA_CONTEXT_LENGTH
  fi
  nohup "$binary" serve >"$log_path" 2>&1 < /dev/null &
  local server_pid=$!
  disown 2>/dev/null || true
  printf '%s\n' "$server_pid"
}

# 0 (still alive) / 1 (already gone) - never errors on an unknown pid.
ollama_ancillary_pid_alive() {
  local pid="$1"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" >/dev/null 2>&1
}

# Polls until PID is gone or BOUND_SECONDS elapse, at
# OLLAMA_ANCILLARY_STOP_POLL_INTERVAL_SECONDS intervals. Returns 0 the
# moment it is gone (including immediately, if it already was); 1 if the
# bound is reached with it still alive.
ollama_ancillary_wait_gone() {
  local pid="$1"
  local bound_seconds="$2"
  local elapsed=0
  while [ "$elapsed" -lt "$bound_seconds" ]; do
    ollama_ancillary_pid_alive "$pid" || return 0
    sleep "$OLLAMA_ANCILLARY_STOP_POLL_INTERVAL_SECONDS"
    elapsed=$((elapsed + OLLAMA_ANCILLARY_STOP_POLL_INTERVAL_SECONDS))
  done
  ! ollama_ancillary_pid_alive "$pid"
}

# BL-1727: never left running by a launch that stops using it (a refused
# launch, or BL-1704's own stop paths): only ever signals a pid THIS lib
# itself started, never a server the swarm did not start (that pid is
# simply never passed in - the FIRM constraint from the ticket's
# approval_context is enforced by the CALLER never handing this an
# externally-owned pid, not by anything guessed here). Waits, bounded, for
# the pid to actually be gone rather than firing one signal and returning
# at once: success means the pid is not alive the moment this returns; a
# pid still alive after TERM's grace and a KILL escalation is a named
# failure, never silently reported as stopped.
ollama_ancillary_stop_pid() {
  local pid="$1"
  ollama_ancillary_pid_alive "$pid" || return 0

  kill "$pid" >/dev/null 2>&1 || true
  ollama_ancillary_wait_gone "$pid" "$OLLAMA_ANCILLARY_STOP_TERM_GRACE_SECONDS" && return 0

  kill -9 "$pid" >/dev/null 2>&1 || true
  ollama_ancillary_wait_gone "$pid" "$OLLAMA_ANCILLARY_STOP_KILL_GRACE_SECONDS" && return 0

  echo "ollama-ancillary: pid $pid still alive after TERM and KILL" >&2
  return 1
}

# ── BL-1704: the stop side, using BL-1703's own record ──────────────────

# One fixed-format field out of ollama_ancillary_write_record's own JSON
# shape - never a general JSON parser, matched to that exact writer.
ollama_ancillary_read_record_field() {
  local record_path="$1"
  local field="$2"
  case "$field" in
    pid)
      sed -n 's/^  "pid": \([0-9]*\),\{0,1\}$/\1/p' "$record_path"
      ;;
    *)
      sed -n "s/^  \"$field\": \"\\(.*\\)\",\\{0,1\\}\$/\\1/p" "$record_path"
      ;;
  esac
}

# POSIX `ps -o args=` - the full command line, identical shape on stock
# macOS ps and Linux procps. Empty when the pid is gone.
ollama_ancillary_pid_cmdline() {
  local pid="$1"
  ps -o args= -p "$pid" 2>/dev/null | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

# True only when PID is alive AND its live command line still reads like
# `ollama serve` - never assumed from the record alone (BL-1704's own
# invariant: a pid that now belongs to something else is never signalled).
ollama_ancillary_pid_is_ollama_serve() {
  local pid="$1"
  [ -n "$pid" ] || return 1
  ollama_ancillary_pid_alive "$pid" || return 1
  case "$(ollama_ancillary_pid_cmdline "$pid")" in
    *ollama*serve*) return 0 ;;
    *) return 1 ;;
  esac
}

# Direct children of SERVER_PID (pgrep -P, never a host-wide pattern sweep
# - BL-1385/1390) whose command line reads like ollama's own model runner
# (`ollama runner` or `llama-server`). One pid per line on stdout.
ollama_ancillary_runner_children() {
  local server_pid="$1"
  local child
  pgrep -P "$server_pid" 2>/dev/null | while IFS= read -r child; do
    [ -n "$child" ] || continue
    case "$(ollama_ancillary_pid_cmdline "$child")" in
      *llama-server*) printf '%s\n' "$child" ;;
      *"ollama runner"*) printf '%s\n' "$child" ;;
    esac
  done
}

# The whole stop contract for one root (BL-1704), called once from each
# stop path. Idempotent (a no-op with no record); never signals a pid the
# record does not name as swarm-owned, and never signals one whose live
# command line has drifted away from ollama serve. The record is removed
# in every case except "no record" (nothing to remove). Every outcome logs
# one line to stderr naming what happened, so the stop log always says why.
ollama_ancillary_stop_swarm_owned() {
  local state_dir="$1"
  local record_path
  record_path="$(ollama_ancillary_record_path "$state_dir")"

  [ -f "$record_path" ] || return 0

  local owner pid endpoint
  owner="$(ollama_ancillary_read_record_field "$record_path" "owner")"
  pid="$(ollama_ancillary_read_record_field "$record_path" "pid")"
  endpoint="$(ollama_ancillary_read_record_field "$record_path" "endpoint")"

  if [ "$owner" != "swarm-owned" ]; then
    echo "ollama-ancillary: leaving an external ollama server running at $endpoint" >&2
    return 0
  fi

  if ! ollama_ancillary_pid_is_ollama_serve "$pid"; then
    # BL-1704 QA D1: ollama_ancillary_pid_is_ollama_serve folds "pid gone"
    # and "pid alive but recycled by something else" into one false - the
    # stop log must tell them apart (requirement 3's "the stop log says
    # which"), so split on liveness here rather than in that predicate.
    if ollama_ancillary_pid_alive "$pid"; then
      echo "ollama-ancillary: recorded swarm-owned ollama server (pid $pid) now belongs to $(ollama_ancillary_pid_cmdline "$pid") - clearing the stale record, nothing signalled" >&2
    else
      echo "ollama-ancillary: recorded swarm-owned ollama server (pid ${pid:-unknown}) is gone - clearing the stale record, nothing signalled" >&2
    fi
    rm -f "$record_path"
    return 0
  fi

  local runner runner_result=0
  while IFS= read -r runner; do
    [ -n "$runner" ] || continue
    ollama_ancillary_stop_pid "$runner" || runner_result=1
  done <<EOF
$(ollama_ancillary_runner_children "$pid")
EOF

  ollama_ancillary_stop_pid "$pid"
  local server_result=$?
  rm -f "$record_path"

  if [ "$server_result" -eq 0 ] && [ "$runner_result" -eq 0 ]; then
    echo "ollama-ancillary: stopped swarm-owned ollama server (pid $pid) and its runner children" >&2
    return 0
  fi
  echo "ollama-ancillary: ollama server (pid $pid) or a runner child did not stop cleanly" >&2
  return 1
}

# The whole start-and-probe contract for one launch (BL-1703 invariant: no
# seat of a pack using the local endpoint starts unless this returns 0).
#
# Args: uses_local(yes|no) url state_dir binary models_dir context_length
#       wait_seconds poll_interval_seconds log_path
#
# Returns 0 and (for a pack that uses the endpoint) writes a record when
# the launch may proceed; returns 1, stops anything it started, and writes
# no record when the endpoint never answered within the wait.
ollama_ancillary_ensure_ready_for_launch() {
  local uses_local="$1"
  local url="$2"
  local state_dir="$3"
  local binary="$4"
  local models_dir="$5"
  local context_length="$6"
  local wait_seconds="$7"
  local poll_interval="$8"
  local log_path="$9"

  # BL-1703 scenario 03: a pack with no seat on the local endpoint probes
  # nothing, starts nothing, and leaves no record - launch unchanged.
  if [ "$uses_local" != "yes" ]; then
    return 0
  fi

  local record_path
  record_path="$(ollama_ancillary_record_path "$state_dir")"

  if ollama_ancillary_probe "$url"; then
    ollama_ancillary_write_record "$record_path" "external" "" "" "$url"
    return 0
  fi

  local started_pid
  started_pid="$(ollama_ancillary_start_server "$binary" "$models_dir" "$context_length" "$log_path")"
  local started_at
  started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  local elapsed=0
  while [ "$elapsed" -lt "$wait_seconds" ]; do
    if ollama_ancillary_probe "$url"; then
      ollama_ancillary_write_record "$record_path" "swarm-owned" "$started_pid" "$started_at" "$url"
      return 0
    fi
    sleep "$poll_interval"
    elapsed=$((elapsed + poll_interval))
  done

  # BL-1727: ollama_ancillary_stop_pid can now return 1 (a pid that
  # outlives KILL). Under a caller's `set -e` an unguarded call here would
  # abort right at this line, silently skipping the diagnostic below and
  # this function's own `return 1` - a real change to "every caller's
  # behaviour is otherwise unchanged" (FIRM). `|| true`: this function
  # already reports ITS OWN failure unconditionally next.
  ollama_ancillary_stop_pid "$started_pid" || true
  echo "ollama-ancillary: local-model endpoint $url never answered within ${wait_seconds}s (server log: $log_path)" >&2
  return 1
}
