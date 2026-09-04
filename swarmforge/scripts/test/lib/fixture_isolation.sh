#!/usr/bin/env bash
# BL-1390 (second incident): a suite that can run concurrently must not destroy
# its own siblings.
#
# QA counted 1156 concurrent copies of one e2e exhausting the host. The
# established mechanism is not the multiplier - it is that each copy began with
# a BLIND prefix sweep (`rm -rf "$TMPDIR/<prefix>"*`) and so deleted every other
# copy's fixture mid-run, turning contention into a storm of retries and
# half-built repositories.
#
# BL-971's "sweep the prefix before the run too" is a rule for a suite that runs
# ONE AT A TIME - a killed run traps no `finally`, and nothing else owns those
# roots. The moment a suite can be invoked concurrently (an acceptance handler
# runs it once per scenario; several roles run acceptance at once) that same
# sweep is a cross-run delete.
#
# What replaces it, and what every suite sourcing this file gets:
#   * a LOCK, so at most one instance runs at a time;
#   * reaping that removes only roots NO LIVE RUN OWNS - a recorded owner pid
#     that is gone, or an age past a generous bound - never a blind prefix rm;
#   * a wall-clock BOUND, so a wedged run ends by itself;
#   * an invoker LOG line, so a storm can be traced to whoever started it.
#
# Usage, right after the suite sets its own FIXTURE_PREFIX:
#   source "<...>/lib/fixture_isolation.sh"
#   fixture_isolation_begin "$FIXTURE_PREFIX" [<bound-seconds>]
#   ... "$WORK" is created for you, owner-stamped ...

fixture_isolation_lock_path() {
  printf '%s/%s.lock' "${TMPDIR:-/tmp}" "${1%-}"
}

# Every root records the pid that owns it, so a sibling can tell "still running"
# from "left behind by a killed run" without guessing.
fixture_isolation_stamp_owner() {
  printf '%s\n' "$$" > "$1/.fixture-owner-pid" 2>/dev/null || true
}

# Reap ONLY what no live run owns. A root whose owner pid is alive is another
# instance's and is left strictly alone.
fixture_isolation_reap() {
  local prefix="$1" max_age_min="${2:-720}" dir owner
  for dir in "${TMPDIR:-/tmp}/${prefix}"*; do
    [[ -d "$dir" ]] || continue
    owner="$(cat "$dir/.fixture-owner-pid" 2>/dev/null || true)"
    if [[ -n "$owner" ]] && kill -0 "$owner" 2>/dev/null; then
      continue                      # a LIVE run owns this - never touch it
    fi
    if [[ -z "$owner" ]]; then
      # No stamp at all: only age makes it safe to remove, never presence.
      [[ -n "$(find "$dir" -maxdepth 0 -mmin "+$max_age_min" 2>/dev/null)" ]] || continue
    fi
    rm -rf "$dir" 2>/dev/null || true
  done
}

# The process chain that started this run, so a storm names its source.
fixture_isolation_log_invoker() {
  local ppid_cmd
  ppid_cmd="$(ps -o args= -p "$PPID" 2>/dev/null | head -1)"
  echo "SUITE_INVOKER pid=$$ ppid=$PPID parent=${ppid_cmd:-unknown}"
}

# Bound, lock, reap, stamp - in that order, because a wedged run must end even
# if it never reaches the lock.
fixture_isolation_begin() {
  local prefix="$1" bound="${2:-900}"

  # Wall-clock bound: re-exec once under `timeout`, marked so it happens once.
  if [[ -z "${FIXTURE_ISOLATION_BOUNDED:-}" ]]; then
    export FIXTURE_ISOLATION_BOUNDED=1
    exec timeout "$bound" bash "$0" "$@"
  fi

  fixture_isolation_log_invoker

  local lock; lock="$(fixture_isolation_lock_path "$prefix")"
  exec {FIXTURE_ISOLATION_LOCK_FD}>>"$lock"
  if ! flock -w "${FIXTURE_ISOLATION_LOCK_WAIT:-600}" "$FIXTURE_ISOLATION_LOCK_FD"; then
    local holder; holder="$(cat "$lock.owner" 2>/dev/null || echo unknown)"
    echo "SUITE_BUSY: another instance of this suite (pid ${holder}) holds ${lock}; exiting cleanly without touching its fixtures."
    exit 0
  fi
  printf '%s\n' "$$" > "$lock.owner" 2>/dev/null || true

  # A probe (an invocation that only wants to reach the lock decision) must
  # never be able to delete anything, whichever path it takes. Closing the
  # mechanism outright beats reasoning about whether it can be reached.
  if [[ -z "${FIXTURE_ISOLATION_NO_REAP:-}" ]]; then
    fixture_isolation_reap "$prefix"
  fi

  WORK="$(mktemp -d "${TMPDIR:-/tmp}/${prefix}XXXXXX")" || exit 1
  fixture_isolation_stamp_owner "$WORK"
  export WORK
}
