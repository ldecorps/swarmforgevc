#!/usr/bin/env bash
# BL-878: setsid is util-linux and absent from stock macOS. A wiring test
# that backgrounds the handoff daemon through it unguarded finds the daemon
# never starts, and only discovers this much later in its own wait_for_log
# poll - which reads as a timeout on a slow daemon, not as a missing tool,
# because the failure happens inside a backgrounded job (`... &`), invisible
# to the script's own control flow. Two independent problems, two
# independent guards, both in one shared place so neither can drift between
# call sites:
#   1. setsid itself may be missing -> fall back to nohup. Same shape as
#      BL-802's start_babysitterd.sh and the in-suite precedent this ticket
#      follows, test_handoffd_role_context_clear_skip_rotation_router.sh:65.
#   2. the daemon's own interpreter may be missing -> that is NOT
#      recoverable by a fallback, so fail loud and NAME it, in the
#      foreground, before ever backgrounding - never let it die silently
#      inside the background job and read as a wait_for_log timeout.

# portable_spawn_daemon_or_fail <required-interpreter> <cmd...>
#
# Backgrounds "<cmd...>" via setsid when available, else nohup. Caller must
# read $! IMMEDIATELY after calling: a bash function does not get its own
# job table, so $! set by the `&` inside this function is still the correct
# value in the caller's own scope right after this function returns - same
# mechanic the in-suite precedent above already relies on.
portable_spawn_daemon_or_fail() {
  local interpreter="$1"
  shift
  command -v "$interpreter" >/dev/null 2>&1 || {
    echo "FAIL: required tool '$interpreter' not found on PATH; refusing to start the daemon (would otherwise fail silently inside the background job and read as a wait_for_log timeout)" >&2
    exit 1
  }
  if command -v setsid >/dev/null 2>&1; then
    setsid "$@" &
  else
    nohup "$@" >/dev/null 2>&1 &
  fi
}
