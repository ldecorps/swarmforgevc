#!/usr/bin/env bash
# BL-1370: a role checks its OWN worktree for strays.
#
# The gate QA's prompt states - no leftover test or mutation processes before
# or after verification, stragglers reaped by process GROUP - had no tool: 326
# evidence files record it in almost as many wordings. The dangerous part is
# scope, not detection: get "mine" wrong in the killing direction and this
# destroys a colleague's running suite, so scope delegates to the one shared
# classifier and check 05 below is the test that matters.
#
# Every process this suite starts is killed in the trap, and the fixture roots
# are swept by prefix before the run too (BL-971).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SCRIPTS="$REPO_ROOT/swarmforge/scripts"
CLI="$SCRIPTS/check_worktree_strays.bb"

status=0
fail() { echo "FAIL: $*"; status=1; }
pass() { echo "PASS: $*"; }

FIXTURE_PREFIX="sfvc-bl1370-e2e"
source "$SCRIPT_DIR/lib/fixture_isolation.sh"
fixture_isolation_begin "$FIXTURE_PREFIX" "${BL1370_SUITE_BOUND_SECONDS:-600}" "$@"

STARTED_PGIDS=()
# This suite's own process group. Nothing here may ever signal it: `setsid`
# does not always produce a new group (it cannot when the caller is already a
# group leader), and a fixture job that stayed in this group would take the
# suite - and, under the acceptance runner, the `node --test` process running
# it - down with it. That is not hypothetical: it silently killed the
# acceptance run for this feature until this guard was added, and it is the
# same failure the tool under test refuses to commit.
OWN_PGID="$(ps -o pgid= -p $$ | tr -d ' ')"

kill_group_safely() {  # kill_group_safely <pgid>
  local pgid="$1"
  [[ -n "$pgid" ]] || return 0
  if [[ "$pgid" == "$OWN_PGID" ]]; then
    echo "NOTE: refusing to signal this suite's own group ($pgid)"
    return 0
  fi
  kill -- "-$pgid" 2>/dev/null || true
}

cleanup() {
  local pgid
  for pgid in ${STARTED_PGIDS[@]+"${STARTED_PGIDS[@]}"}; do
    kill_group_safely "$pgid"
  done
  rm -rf "$WORK"
}
trap cleanup EXIT

MINE="$WORK/mine"
THEIRS="$WORK/theirs"
mkdir -p "$MINE" "$THEIRS"

# A stand-in for a long-running job process: its cmdline carries the pattern
# (`node --test`) and its cwd is the worktree, which is what the shared
# classifier reads. setsid gives it its own process group, exactly as a real
# runaway suite has.
start_job() {  # start_job <cwd> [--with-child]
  local cwd="$1"
  ( cd "$cwd" && setsid bash -c '
      if [[ "${1:-}" == "--with-child" ]]; then
        sleep 120 >/dev/null 2>&1 </dev/null &   # a child a bare pid kill would orphan
      fi
      exec -a "node --test '"$cwd"'/fixture.generated.test.js" sleep 120
    ' _ "${2:-}" >/dev/null 2>&1 </dev/null & )
  sleep 0.7
  local pid
  pid="$(pgrep -f "node --test $cwd/fixture.generated.test.js" | head -1)"
  [[ -n "$pid" ]] || return 1
  local pgid
  pgid="$(ps -o pgid= -p "$pid" | tr -d ' ')"
  if [[ "$pgid" == "$OWN_PGID" ]]; then
    # setsid did not separate it. Track the PID for teardown instead, so this
    # job is still cleaned up without signalling the suite's own group.
    kill "$pid" 2>/dev/null || true
    return 1
  fi
  STARTED_PGIDS+=("$pgid")
  printf '%s %s\n' "$pid" "$pgid"
}

run_check() { timeout 120 bb "$CLI" "$1" 2>&1; }
run_reap() { timeout 120 bb "$CLI" "$1" --reap 2>&1; }

# ── 01: a clean worktree reports clean and succeeds ──────────────────────
out="$(run_check "$MINE")"; rc=$?
if (( rc == 0 )) && grep -q 'WORKTREE_STRAYS: none in' <<<"$out"; then
  pass "a clean worktree reports clean and the check succeeds"
else
  fail "a clean worktree did not report clean (rc=$rc): $out"
fi

# ── 06: and the line names what was scanned ──────────────────────────────
if grep -qE 'process\(es\) scanned' <<<"$out" && grep -q 'patterns:' <<<"$out"; then
  pass "the clean line is recordable and names what was scanned"
else
  fail "the result line does not say what it looked at: $out"
fi

# ── 02: a stray in THIS worktree is named with its process group ─────────
read -r mine_pid mine_pgid < <(start_job "$MINE") || fail "could not start the fixture job"
out="$(run_check "$MINE")"; rc=$?
if (( rc != 0 )); then
  pass "a stray makes the check FAIL - a refusal, not a warning"
else
  fail "the check exited zero with a stray alive: $out"
fi
if grep -q "pid=$mine_pid" <<<"$out" && grep -q "pgid=$mine_pgid" <<<"$out"; then
  pass "the stray is named with its process group"
else
  fail "the stray was not named with pid and pgid: $out"
fi

# ── 03: another worktree's running suite is never reported ───────────────
read -r their_pid their_pgid < <(start_job "$THEIRS") || fail "could not start the sibling job"
out="$(run_check "$MINE")"
if ! grep -q "pid=$their_pid" <<<"$out"; then
  pass "another worktree's suite is never reported as this worktree's stray"
else
  fail "the check claimed a sibling worktree's process: $out"
fi

# ── 04 + 05: reaping kills MY whole group and never touches THEIRS ───────
read -r child_pid child_pgid < <(start_job "$MINE" --with-child) || true
out="$(run_reap "$MINE")"; rc=$?
sleep 0.5
if ! kill -0 "$mine_pid" 2>/dev/null; then
  pass "reaping killed this worktree's stray"
else
  fail "the stray survived the reap: $out"
fi
if [[ -n "${child_pid:-}" ]] && ! pgrep -g "$child_pgid" >/dev/null 2>&1; then
  pass "and its whole process group went with it, not just the named pid"
else
  fail "a child of the stray outlived the reap (pgid=$child_pgid)"
fi
if kill -0 "$their_pid" 2>/dev/null; then
  pass "the other worktree's process is STILL RUNNING after the reap"
else
  fail "THE REAP KILLED A SIBLING WORKTREE'S PROCESS - the one outcome this tool must never produce"
fi
if (( rc == 0 )) && grep -q 'WORKTREE_STRAYS: none in' <<<"$out"; then
  pass "and the re-check after reaping reports clean"
else
  fail "the post-reap re-check did not come back clean (rc=$rc): $out"
fi

# ── a stray sharing THIS process's own group is reported, not killed ─────
# Measured while building this tool: a fixture job that did not get its own
# session shared the probe's group, and `kill -- -<pgid>` took the probe's own
# shell down with it. A gate that ends the role's session is worse than the
# orphan it was clearing, so that case is reported with the pid to kill by hand.
#
# The probe runs inside its OWN session (setsid): if the guard ever regresses,
# the group kill lands there and this suite survives to report it, instead of
# dying with it. The first version of this check ran in the suite's own group
# AND cleaned up with `pkill -f <path>` - which matched the suite's own command
# line, since the path appears in it, and killed the suite (rc=143 at 548s).
same_group_out="$(setsid bash -c '
  cd "$1" || exit 0
  # Every fd closed. A background job that inherits the stdout of this
  # command substitution keeps that pipe open, and under the acceptance runner
  # the pipe belongs to node - which turns "the suite finished" into
  # "spawnSync is still waiting for a sleep to exit".
  exec -a "node --test $1/samegroup.generated.test.js" sleep 20 >/dev/null 2>&1 </dev/null &
  probe_pid=$!
  sleep 0.7
  timeout 120 bb "$2" "$1" --reap 2>&1
  kill "$probe_pid" 2>/dev/null || true
' _ "$MINE" "$CLI" 2>&1)"
if grep -q "own group - reported, not killed" <<<"$same_group_out"; then
  pass "a stray sharing the caller's own group is reported, never signalled"
elif grep -q 'WORKTREE_STRAYS' <<<"$same_group_out"; then
  # setsid gave the probe its own session, so bb's group and the stray's group
  # may legitimately differ on this host. Reported as a skip, never as a pass:
  # the guard is in the code path either way, and check 05 already proves the
  # reap kills only what it should.
  echo "SKIP: this host did not put the stray in the caller's own group - guard unexercised here"
else
  fail "the same-group probe produced no result at all: $(tail -2 <<<"$same_group_out")"
fi

# ── the result line is stable across runs ────────────────────────────────
a="$(run_check "$THEIRS")"; b="$(run_check "$THEIRS")"
if [[ "$a" == "$b" ]]; then
  pass "the same state yields the same line, byte for byte"
else
  fail "the result line is not stable: [$a] vs [$b]"
fi

# ── the mirrored pattern agrees with the supervisor's (BL-897) ───────────
# The literal sits several lines below the def, past its docstring: a
# one-line window found nothing and reported a drift that was really an
# impatient grep. Take the first regex literal after the def instead.
sup="$(awk '/def job-process-pattern/{f=1} f && /^[[:space:]]*#"/{print; exit}' \
       "$SCRIPTS/handoffd_supervisor.bb" | sed 's/^ *//;s/ *$//')"
lib="$(grep '#"(?i)stryker' "$SCRIPTS/worktree_stray_lib.bb" | sed 's/^ *//;s/ *$//')"
if [[ -n "$sup" && "$sup" == "$lib" ]]; then
  pass "the job-process pattern is byte-identical to the supervisor's"
else
  fail "the mirrored pattern drifted from handoffd_supervisor.bb:"$'\n'"  sup=[$sup]"$'\n'"  lib=[$lib]"
fi

# ── scope comes from the ONE shared classifier ───────────────────────────
if grep -q 'process-table-lib/project-scoped-process?' "$SCRIPTS/worktree_stray_lib.bb"; then
  pass "scope delegates to process_table_lib's shared classifier"
else
  fail "this tool grew its own notion of what is mine"
fi

if (( status == 0 )); then echo "ALL PASS"; else echo "FAILURES"; fi
exit $status
