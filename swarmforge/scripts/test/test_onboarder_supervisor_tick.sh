#!/usr/bin/env bash
# Smoke test for the Onboarder supervisor
# (onboarder_supervisor.bb, BL-590). Mirrors
# test_negotiation_relay_supervisor_tick.sh's own shape (real child
# processes, real liveness checks, a fake compiled entrypoint instead of
# live Telegram credentials) but for this supervisor's single
# :onboarder process-spec and its swarm-repo-root-only
# argument (no per-target path - the Onboarding topic lives in the PRIMARY
# swarm's own group).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fixture() {
  local d; d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/swarm/extension/out/tools" "$d/swarm/.swarmforge/operator" "$d/fleet-home"
  cp "$SRC/onboarder_supervisor.bb" "$SRC/front_desk_supervisor_lib.bb" \
     "$SRC/swarm_identity_lib.bb" "$SRC/fleet_telegram_creds_lib.bb" \
     "$SRC/process_table_lib.bb" "$d/swarm/"
  write_healthy_reconcile_js "$d"
  printf '%s' "$d"
}

# A "healthy" fake reconcile CLI must write the SAME heartbeat shape the
# real onboarder-reconcile.ts writes - without it, a process
# that merely stays alive reads as stalled (nil heartbeat counts as stale),
# which would falsely trip every "stays running" assertion below.
# swarm-repo-root is process.argv[2] (poll-loop's own first CLI arg).
write_healthy_reconcile_js() {
  cat > "$1/swarm/extension/out/tools/onboarder-reconcile.js" <<'EOF'
const fs = require('fs');
const path = require('path');
const root = process.argv[2] || '.';
const hbPath = path.join(root, '.swarmforge', 'operator', 'onboarder-heartbeat.json');
function beat() {
  fs.mkdirSync(path.dirname(hbPath), { recursive: true });
  fs.writeFileSync(hbPath, JSON.stringify({ lastHeartbeatMs: Date.now() }));
}
beat();
setInterval(beat, 200);
EOF
}

STATUS() { echo "$1/swarm/.swarmforge/operator/onboarder-supervisor.status.json"; }

check_once() {
  SWARMFORGE_FLEET_HOME="$1/fleet-home" \
    TELEGRAM_BOT_TOKEN=fake-token \
    TELEGRAM_CHAT_ID=fake-chat \
    ONBOARDER_MAX_ATTEMPTS="${ONBOARDER_MAX_ATTEMPTS:-3}" \
    ONBOARDER_BACKOFF_BASE_MS="${ONBOARDER_BACKOFF_BASE_MS:-10}" \
    ONBOARDER_BACKOFF_MAX_MS="${ONBOARDER_BACKOFF_MAX_MS:-40}" \
    bb "$1/swarm/onboarder_supervisor.bb" "$1/swarm" --check-once
}
jget() { bb -e "(require '[cheshire.core :as j]) (println (get-in (j/parse-string (slurp \"$1\") true) $2))"; }
cleanup_children() {
  pkill -f "$1/swarm/extension/out/tools/onboarder-reconcile.js" 2>/dev/null || true
}
die() { echo "FAIL: $*" >&2; exit 1; }

# BL-928: spawns a REAL orphaned onboarder-reconcile.js process for fixture
# root $1, writing its pid to $2, invoked with subcommand $3 (default
# "poll-loop" - pass e.g. "once" to get a same-root, same-entrypoint
# process that is deliberately NOT a poll-loop, for the "must not be
# touched" negative case). Uses the same fork+setpgrp+exec double-fork
# technique test_handoffd_supervisor_job_reaper.sh already established for
# a genuine PPID-1 orphan (the python3 parent exits immediately after
# forking, so the child reparents to launchd/init) - never a lingering
# job-controlled bash child, which a live supervisor process would still
# parent.
spawn_orphaned_reconcile() {
  local root="$1" pidfile="$2" mode="${3:-poll-loop}"
  python3 - "$root" "$pidfile" "$mode" > /dev/null 2>&1 <<'PYEOF' &
import os, sys
root, pidfile, mode = sys.argv[1], sys.argv[2], sys.argv[3]
if os.fork() > 0:
    sys.exit(0)
os.setpgrp()
with open(pidfile, "w") as f:
    f.write(str(os.getpid()))
    f.flush()
entry = os.path.join(root, "swarm", "extension", "out", "tools", "onboarder-reconcile.js")
os.execvp("node", ["node", entry, os.path.join(root, "swarm"), mode])
PYEOF
  local i
  for i in $(seq 1 500); do
    [[ -s "$pidfile" ]] && break
    sleep 0.02
  done
  [[ -s "$pidfile" ]] || die "spawn_orphaned_reconcile: $pidfile was never written"
  local p ppid_now
  p="$(cat "$pidfile")"
  ppid_now="0"
  for i in $(seq 1 500); do
    ppid_now="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
    [[ "$ppid_now" == "1" ]] && break
    sleep 0.02
  done
  [[ "$ppid_now" == "1" ]] || die "spawn_orphaned_reconcile: pid $p did not reparent to PPID 1 (got $ppid_now)"
}

# BL-928: starts the REAL (non-check-once) supervisor loop in the
# background - the only path the startup reap sweep runs on - and prints
# its own bb process pid. ONBOARDER_INTERVAL_MS is generous (not tight) -
# onboarder_supervisor.bb's :heartbeat-stale? wires poll-heartbeat-stale?'s
# 3-arity form only (no started-at-ms/startup-grace-ms, unlike
# front_desk_supervisor.bb's own 5-arity wiring), so a freshly-spawned
# child with no heartbeat file yet reads as immediately stale rather than
# within a grace window - a real, pre-existing gap unrelated to this
# ticket's own scope, surfaced first-hand while writing this fixture (a
# 100ms interval occasionally raced real Node.js interpreter startup and
# tripped a false "stalled"/restart under host load - not a decapitation
# bug: see the BL-928 handoff notes). A slower tick keeps this fixture out
# of that race without touching the pre-existing behavior.
start_background_supervisor() {
  local root="$1"
  ONBOARDER_INTERVAL_MS="${ONBOARDER_INTERVAL_MS:-1000}" \
    SWARMFORGE_FLEET_HOME="$root/fleet-home" \
    TELEGRAM_BOT_TOKEN=fake-token \
    TELEGRAM_CHAT_ID=fake-chat \
    ONBOARDER_MAX_ATTEMPTS="${ONBOARDER_MAX_ATTEMPTS:-3}" \
    ONBOARDER_BACKOFF_BASE_MS="${ONBOARDER_BACKOFF_BASE_MS:-10}" \
    ONBOARDER_BACKOFF_MAX_MS="${ONBOARDER_BACKOFF_MAX_MS:-40}" \
    ONBOARDER_REAP_FORCE_UNREADABLE="${ONBOARDER_REAP_FORCE_UNREADABLE:-}" \
    bb "$root/swarm/onboarder_supervisor.bb" "$root/swarm" \
    >> "$root/swarm/.swarmforge/operator/onboarder-supervisor.log" 2>&1 &
  echo $!
}

wait_for_supervisor_pidfile() {
  local root="$1"
  local pidfile="$root/swarm/.swarmforge/operator/onboarder-supervisor.pid"
  local i p
  for i in $(seq 1 500); do
    if [[ -f "$pidfile" ]]; then
      p="$(cat "$pidfile")"
      if [[ "$p" =~ ^[0-9]+$ ]] && kill -0 "$p" 2>/dev/null; then
        echo "$p"; return 0
      fi
    fi
    sleep 0.02
  done
  return 1
}

# The pid-file is written BEFORE the first tick! ever runs (reap, then
# pid-file, then the loop's first tick!, in that program order) - a real
# gap where pid-file exists but status.json's :onboarder entry does not
# yet. Callers that read status.json right after wait_for_supervisor_pidfile
# must wait for this too, or race a FileNotFoundException / stale read.
wait_for_onboarder_running() {
  local root="$1"
  local status_file="$root/swarm/.swarmforge/operator/onboarder-supervisor.status.json"
  local i st
  for i in $(seq 1 500); do
    if [[ -f "$status_file" ]]; then
      st="$(jget "$status_file" "[:onboarder :status]" 2>/dev/null || true)"
      [[ "$st" == "running" ]] && return 0
    fi
    sleep 0.02
  done
  return 1
}

# Waits specifically until THIS supervisor's own bb pid ($2) has claimed the
# pid file - proves its startup sequence (reap, then pid-file write, in that
# program order) has completed, not merely that SOME supervisor has.
wait_for_specific_supervisor_claim() {
  local root="$1" want_pid="$2"
  local pidfile="$root/swarm/.swarmforge/operator/onboarder-supervisor.pid"
  local i
  for i in $(seq 1 500); do
    [[ -f "$pidfile" ]] && [[ "$(cat "$pidfile")" == "$want_pid" ]] && return 0
    sleep 0.02
  done
  return 1
}

# Retries kill -0 for a few seconds before giving up - absorbs transient
# scheduling/liveness-check lag on a heavily loaded host without weakening
# the assertion: a pid that is GENUINELY dead (e.g. truly reaped) never
# starts answering kill -0 again, so this can only rescue a false negative,
# never mask a real one past this short window.
pid_alive_within() {
  local pid="$1"
  local i
  for i in $(seq 1 250); do
    kill -0 "$pid" 2>/dev/null && return 0
    sleep 0.02
  done
  return 1
}

stop_background_supervisor() {
  local root="$1" sup_pid="$2"
  touch "$root/swarm/.swarmforge/operator/onboarder-supervisor.stop"
  local i
  for i in $(seq 1 500); do
    kill -0 "$sup_pid" 2>/dev/null || return 0
    sleep 0.02
  done
  kill "$sup_pid" 2>/dev/null || true
}

# ── 1. first check-once: the reconcile loop is started, attempt 1, running ──
F="$(make_fixture)"
check_once "$F" > /dev/null
check "first check-once starts the reconcile loop (attempt 1, running)" \
  '[[ "$(jget "$(STATUS "$F")" "[:onboarder :status]")" == running ]]'
check "status.json records attempt 1" \
  '[[ "$(jget "$(STATUS "$F")" "[:onboarder :attempts]")" -eq 1 ]]'

# ── 2. a second check-once (nothing crashed) leaves it alone at attempt 1 ───
check_once "$F" > /dev/null
check "a healthy process is never restarted (still attempt 1)" \
  '[[ "$(jget "$(STATUS "$F")" "[:onboarder :attempts]")" -eq 1 ]]'
cleanup_children "$F"
rm -rf "$F"

# ── 3. a crashed process is detected, waits out its backoff, then restarts
#      (bounded) - and after the configured cap, gives up ──────────────────
F="$(make_fixture)"
cat > "$F/swarm/extension/out/tools/onboarder-reconcile.js" <<'EOF'
process.exit(1);
EOF
export ONBOARDER_MAX_ATTEMPTS=2 ONBOARDER_BACKOFF_BASE_MS=10 ONBOARDER_BACKOFF_MAX_MS=20
check_once "$F" > /dev/null
check "attempt 1 starts (briefly) before crashing" \
  '[[ "$(jget "$(STATUS "$F")" "[:onboarder :attempts]")" -eq 1 ]]'
sleep 0.2
check_once "$F" > /dev/null
check "a crashed process is detected and moved to waiting-or-restarted" \
  '[[ "$(jget "$(STATUS "$F")" "[:onboarder :status]")" != running ]] || [[ "$(jget "$(STATUS "$F")" "[:onboarder :attempts]")" -gt 1 ]]'
gave_up=0
for _ in $(seq 1 15); do
  sleep 0.2
  check_once "$F" > /dev/null
  if [[ "$(jget "$(STATUS "$F")" "[:onboarder :status]")" == gave-up ]]; then
    gave_up=1
    break
  fi
done
check "after the bounded cap (max-attempts=2), the onboarder gives up rather than restarting forever" \
  '[[ "$gave_up" -eq 1 ]]'
check "the onboarder never exceeds the configured attempt cap" \
  '[[ "$(jget "$(STATUS "$F")" "[:onboarder :attempts]")" -eq 2 ]]'
unset ONBOARDER_MAX_ATTEMPTS ONBOARDER_BACKOFF_BASE_MS ONBOARDER_BACKOFF_MAX_MS
cleanup_children "$F"
rm -rf "$F"

# ── 4. fixture root, the reap: real pre-existing orphaned poll-loops for
#      THIS root are gone once the supervisor starts, its own child is
#      alive, and the reap is named in the log ─────────────────────────────
F="$(make_fixture)"
spawn_orphaned_reconcile "$F" "$F/orphan1.pid"
spawn_orphaned_reconcile "$F" "$F/orphan2.pid"
ORPHAN1_PID="$(cat "$F/orphan1.pid")"
ORPHAN2_PID="$(cat "$F/orphan2.pid")"
SUP_PID="$(start_background_supervisor "$F")"
wait_for_supervisor_pidfile "$F" > /dev/null || die "04 setup: supervisor never claimed its own pid file"
wait_for_onboarder_running "$F" || die "04 setup: supervisor never reported its child running"
check "04: both pre-existing orphaned poll-loops for this root are gone after startup" \
  '! kill -0 "$ORPHAN1_PID" 2>/dev/null && ! kill -0 "$ORPHAN2_PID" 2>/dev/null'
check "04: the supervisor spawned its own child (status running)" \
  'wait_for_onboarder_running "$F"'
CHILD_PID="$(jget "$(STATUS "$F")" "[:onboarder :pid]")"
check "04: exactly one pid is recorded for the supervised child, and it is alive" \
  'pid_alive_within "$CHILD_PID"'
check "04: the reap is named in the log for both orphaned pids" \
  'grep -q "reaped pid= $ORPHAN1_PID" "$F/swarm/.swarmforge/operator/onboarder-supervisor.log" && grep -q "reaped pid= $ORPHAN2_PID" "$F/swarm/.swarmforge/operator/onboarder-supervisor.log"'
stop_background_supervisor "$F" "$SUP_PID"
kill "$CHILD_PID" 2>/dev/null || true
cleanup_children "$F"
rm -rf "$F"

# ── 5. decapitation guard: a SECOND supervisor sweeping the SAME root while
#      the first is still running never reaps the first's own live child -
#      its parent is alive, so it was never a candidate. Invariant 1, and
#      the single most important negative check in the ticket ─────────────
F="$(make_fixture)"
SUP1_PID="$(start_background_supervisor "$F")"
wait_for_supervisor_pidfile "$F" > /dev/null || die "05 setup: supervisor 1 never claimed its own pid file"
wait_for_onboarder_running "$F" || die "05 setup: supervisor 1 never reported its child running"
CHILD1_PID="$(jget "$(STATUS "$F")" "[:onboarder :pid]")"
kill -0 "$CHILD1_PID" 2>/dev/null || die "05 setup: supervisor 1's own child is not alive"
# Second supervisor process for the SAME fixture root, started directly -
# bypassing launch_onboarder.sh's own already-running pidfile guard, which
# lives in the launcher, not in onboarder_supervisor.bb itself.
SUP2_PID="$(start_background_supervisor "$F")"
wait_for_specific_supervisor_claim "$F" "$SUP2_PID" \
  || die "05 setup: supervisor 2 never claimed its own pid file"
check "05: supervisor 1's own live child is still alive after supervisor 2's startup sweep" \
  'pid_alive_within "$CHILD1_PID"'
check "05: supervisor 2 also starts and spawns/adopts its own running child" \
  'wait_for_onboarder_running "$F"'
stop_background_supervisor "$F" "$SUP1_PID"
stop_background_supervisor "$F" "$SUP2_PID"
kill "$CHILD1_PID" 2>/dev/null || true
cleanup_children "$F"
rm -rf "$F"

# ── 6. root scoping: an orphaned poll-loop naming a DIFFERENT fixture root
#      is untouched by a supervisor started for a different root ──────────
F="$(make_fixture)"
OTHER="$(make_fixture)"
spawn_orphaned_reconcile "$OTHER" "$F/other-orphan.pid"
OTHER_ORPHAN_PID="$(cat "$F/other-orphan.pid")"
SUP_PID="$(start_background_supervisor "$F")"
wait_for_supervisor_pidfile "$F" > /dev/null || die "06 setup: supervisor never claimed its own pid file"
wait_for_onboarder_running "$F" || die "06 setup: supervisor never reported its child running"
check "06: an orphaned poll-loop for a DIFFERENT fixture root is untouched" \
  'pid_alive_within "$OTHER_ORPHAN_PID"'
check "06: the supervisor still starts and spawns its own child" \
  'wait_for_onboarder_running "$F"'
stop_background_supervisor "$F" "$SUP_PID"
kill "$OTHER_ORPHAN_PID" 2>/dev/null || true
cleanup_children "$F"
cleanup_children "$OTHER"
rm -rf "$F" "$OTHER"

# ── 7. unreadable process table: reaps nothing, logs a line naming the read
#      failure - a clean/no-siblings run never logs that same line, so the
#      two are distinguishable from the log alone (invariant 3) ───────────
F="$(make_fixture)"
spawn_orphaned_reconcile "$F" "$F/orphan.pid"
ORPHAN_PID="$(cat "$F/orphan.pid")"
SUP_PID="$(ONBOARDER_REAP_FORCE_UNREADABLE=1 start_background_supervisor "$F")"
wait_for_supervisor_pidfile "$F" > /dev/null || die "07 setup: supervisor never claimed its own pid file"
wait_for_onboarder_running "$F" || die "07 setup: supervisor never reported its child running"
check "07: a real orphaned poll-loop is NOT reaped when the process-table read is forced unreadable" \
  'pid_alive_within "$ORPHAN_PID"'
check "07: the log names the process-table read failure" \
  'grep -q "reap-unreadable" "$F/swarm/.swarmforge/operator/onboarder-supervisor.log"'
check "07: the supervisor still starts and spawns its own child despite the unreadable table" \
  'wait_for_onboarder_running "$F"'
stop_background_supervisor "$F" "$SUP_PID"
kill "$ORPHAN_PID" 2>/dev/null || true
cleanup_children "$F"
rm -rf "$F"

F="$(make_fixture)"
SUP_PID="$(start_background_supervisor "$F")"
wait_for_supervisor_pidfile "$F" > /dev/null || die "07b setup: supervisor never claimed its own pid file"
wait_for_onboarder_running "$F" || die "07b setup: supervisor never reported its child running"
check "07: a clean run with no siblings and a readable table never logs the unreadable-table line" \
  '! grep -q "reap-unreadable" "$F/swarm/.swarmforge/operator/onboarder-supervisor.log"'
check "07: a clean run reaps nothing (no reaped log line either)" \
  '! grep -q "^.* reaped " "$F/swarm/.swarmforge/operator/onboarder-supervisor.log"'
check "07: the supervisor still starts and spawns its own child on a clean host" \
  'wait_for_onboarder_running "$F"'
CHILD_PID="$(jget "$(STATUS "$F")" "[:onboarder :pid]")"
stop_background_supervisor "$F" "$SUP_PID"
kill "$CHILD_PID" 2>/dev/null || true
cleanup_children "$F"
rm -rf "$F"

# ── 8. an orphaned node process for THIS root that is NOT the poll-loop
#      subcommand is never reaped - cmdline match requires "poll-loop" too,
#      not just the entrypoint and the root ────────────────────────────────
F="$(make_fixture)"
spawn_orphaned_reconcile "$F" "$F/notpoll.pid" "once"
NOTPOLL_PID="$(cat "$F/notpoll.pid")"
SUP_PID="$(start_background_supervisor "$F")"
wait_for_supervisor_pidfile "$F" > /dev/null || die "08 setup: supervisor never claimed its own pid file"
wait_for_onboarder_running "$F" || die "08 setup: supervisor never reported its child running"
check "08: an orphaned node process for this root that is NOT the poll-loop subcommand is untouched" \
  'pid_alive_within "$NOTPOLL_PID"'
check "08: the supervisor still starts and spawns its own child" \
  'wait_for_onboarder_running "$F"'
stop_background_supervisor "$F" "$SUP_PID"
kill "$NOTPOLL_PID" 2>/dev/null || true
cleanup_children "$F"
rm -rf "$F"

if [[ "$fail" -ne 0 ]]; then
  note "FAILED: test_onboarder_supervisor_tick.sh"
  exit 1
fi
note "PASSED: test_onboarder_supervisor_tick.sh"
