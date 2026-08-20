#!/usr/bin/env bash
# BL-995: THE single sanctioned way to run a >120s job on this host. Wraps
# the hardender.prompt:1010 python3 double-fork + os.setsid escape hatch
# (the Bash tool cap, run_in_background and nohup all fail here - see that
# rule's own text) and REGISTERS the detach so handoffd_supervisor's BL-108
# orphan reaper can tell deliberate detachment from abandonment:
#
#   - The registration entry (.swarmforge/daemon/detached-jobs/<pgid>.json)
#     is written by the INTERMEDIATE process after os.setsid() and BEFORE
#     it exits - the grandchild cannot become orphan-visible until the
#     intermediate exits, so a reaper sweep can never land in a window
#     where the job is orphaned but unregistered (BL-995 qa_e2e step 6, by
#     construction rather than by timing).
#   - Registration EXPIRES (default 120 minutes, --expires-minutes N to
#     override): a crashed owner's job is still reaped once its entry ages
#     out - registration is not immunity (BL-995 invariant 2).
#   - The job runs under a bash wrapper whose TERM trap appends a KILLED
#     notice to the job's own log, so an owner collecting the run
#     discovers a reaping from the run's own artifacts (invariant 3).
#
# Usage: detach_job.sh <log-file> [--expires-minutes N] -- <command...>
# Stock macOS bash 3.2 + python3 stdlib only.
set -euo pipefail

if [ $# -lt 3 ]; then
  echo "Usage: detach_job.sh <log-file> [--expires-minutes N] -- <command...>" >&2
  exit 2
fi

LOG="$1"; shift
EXPIRES_MIN=120
if [ "$1" = "--expires-minutes" ]; then
  EXPIRES_MIN="$2"; shift 2
fi
if [ "$1" != "--" ]; then
  echo "detach_job.sh: expected '--' before the command" >&2
  exit 2
fi
shift

# Project root: parent of the git common dir - the same derivation the rest
# of the machinery uses, so the registry lands where the supervisor reads it.
COMMON="$(git rev-parse --git-common-dir 2>/dev/null || true)"
if [ -z "$COMMON" ]; then
  echo "detach_job.sh: not inside a git checkout - cannot resolve the registry root" >&2
  exit 2
fi
case "$COMMON" in
  /*) : ;;
  *) COMMON="$PWD/$COMMON" ;;
esac
ROOT="$(cd "$(dirname "$COMMON")" && pwd -P)"

exec python3 - "$LOG" "$EXPIRES_MIN" "$ROOT" "${SWARMFORGE_ROLE:-unknown}" "$PWD" "$@" <<'PY'
import json, os, sys, time

log, exp_min, root, owner, cwd = sys.argv[1:6]
cmd = sys.argv[6:]
log = os.path.abspath(log)

pid = os.fork()
if pid:
    # Original parent: returns to the caller immediately (the whole point).
    os._exit(0)

# Intermediate: new session (PPID-1 orphan by construction once we exit).
os.setsid()
pgid = os.getpid()

# Register BEFORE forking the worker and BEFORE exiting - the worker can
# only become orphan-visible after this process exits, so the entry always
# precedes any state the reaper could sweep.
reg_dir = os.path.join(root, ".swarmforge", "daemon", "detached-jobs")
os.makedirs(reg_dir, exist_ok=True)
now_ms = int(time.time() * 1000)
entry = {
    "pgid": pgid,
    "owner": owner,
    "log": log,
    "cwd": cwd,
    "cmd": " ".join(cmd),
    "started_at_ms": now_ms,
    "expires_at_ms": now_ms + int(exp_min) * 60 * 1000,
}
tmp = os.path.join(reg_dir, ".%d.tmp" % pgid)
with open(tmp, "w") as f:
    json.dump(entry, f)
os.replace(tmp, os.path.join(reg_dir, "%d.json" % pgid))
with open(log, "a") as f:
    f.write("[detach_job] STARTED pgid=%d owner=%s expires_min=%s cmd=%s\n"
            % (pgid, owner, exp_min, " ".join(cmd)))

worker = os.fork()
if worker:
    os._exit(0)  # orphaning happens HERE - after the registration landed

# Worker: bash wrapper so a SIGTERM (the reaper's signal) leaves a KILLED
# notice in the job's own log before dying (BL-995 invariant 3), and a
# normal exit records its code.
# Detach stdio first: the worker inherited the CALLER's stdin/stdout/stderr,
# and a caller that captures this helper's output ($(...), a pipeline, a
# test harness) would otherwise block until the detached job exits - the
# job's real output goes to the log via the wrapper's redirect.
devnull = os.open(os.devnull, os.O_RDWR)
os.dup2(devnull, 0)
os.dup2(devnull, 1)
os.dup2(devnull, 2)
os.chdir(cwd)
os.environ["DJ_LOG"] = log
wrapper = (
    "trap 'echo \"[detach_job] KILLED by SIGTERM - if this run matched the "
    "BL-108 job pattern, the handoffd supervisor reaper is the likely sender "
    "(expired or missing registration); see .swarmforge/daemon/"
    "handoffd-supervisor.log\" >> \"$DJ_LOG\"; exit 143' TERM\n"
    '"$@" >> "$DJ_LOG" 2>&1\n'
    "ec=$?\n"
    'echo "[detach_job] EXIT=$ec" >> "$DJ_LOG"\n'
    "exit $ec\n"
)
os.execvp("bash", ["bash", "-c", wrapper, "detach_job"] + cmd)
PY
