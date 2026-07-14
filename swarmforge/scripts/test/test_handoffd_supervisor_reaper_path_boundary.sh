#!/usr/bin/env bash
# BL-321: handoffd_supervisor.bb's orphan reaper (handoffd-pids-for-root)
# used to match "is this process serving MY project root" with a bare
# substring test over the whole command line - so it reaped daemons whose
# root merely lay BENEATH this root (a nested test fixture) or whose path
# merely EXTENDED this root as a text prefix (a sibling project). This
# proves the fixed path-boundary (canonicalized equality) matcher: a fake
# "handoffd.bb"-named process is a stand-in for a real daemon here (real
# babashka startup is unnecessary weight for a pure process-table-matching
# check) - what matters is its `ps` command line shape
# (".../handoffd.bb <root>"), exactly what handoffd-pids-for-root parses.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SUPERVISOR="$SCRIPT_DIR/../handoffd_supervisor.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

BASE="$(mktemp -d)"
declare -a FAKE_PIDS=()
cleanup() {
  for pid in "${FAKE_PIDS[@]:-}"; do
    kill -9 "$pid" 2>/dev/null || true
  done
  rm -rf "$BASE"
}
trap cleanup EXIT

SUPERVISED_ROOT="$BASE/srv/swarm"
mkdir -p "$SUPERVISED_ROOT/.swarmforge/daemon"
# The supervisor needs a live tracked daemon's pid file to exist (even if
# stale/mismatched) - reap-orphans! runs independent of the tracked
# daemon's own health (its own comment says so), so a plainly-absent one
# is fine; give it a pid file naming an unrelated-but-alive process (this
# test's own pid) so --check-once's OTHER health checks don't also fire
# an alarm/halt that would confuse this test's own focus.
echo "$$" > "$SUPERVISED_ROOT/.swarmforge/daemon/handoffd.pid"
touch "$SUPERVISED_ROOT/.swarmforge/daemon/handoffd.heartbeat"

# Every root example the scenario outline names, as a REAL directory (BL-321's
# canonicalize step doesn't require existence, but a real directory matches
# what a genuine daemon's root always is).
for rel in "srv/swarm" "srv/swarm/tmp/fx" "srv/swarm/target" "srv/swarm-2" "srv/swarmforge" "srv/other"; do
  mkdir -p "$BASE/$rel"
done

FAKE_HANDOFFD="$BASE/fake-handoffd-holder/handoffd.bb"
mkdir -p "$(dirname "$FAKE_HANDOFFD")"
cat > "$FAKE_HANDOFFD" <<'EOF'
#!/usr/bin/env bash
trap 'exit 0' TERM
sleep 300 &
wait
EOF
chmod +x "$FAKE_HANDOFFD"

start_fake_daemon() {
  local root="$1"
  # Redirected away from this function's own stdout, NOT just /dev/null
  # for tidiness: start_fake_daemon's callers capture its pid via $(...)
  # command substitution, which waits for EOF on ITS pipe - a backgrounded
  # long-running child that inherits (rather than redirects) that same
  # pipe never closes it, so every caller would hang forever waiting for
  # a pid that was already echoed.
  bash "$FAKE_HANDOFFD" "$root" >/dev/null 2>&1 &
  local pid=$!
  FAKE_PIDS+=("$pid")
  echo "$pid"
}

run_check_once() {
  SUPERVISOR_KILL_TIMEOUT_MS=1000 bb "$SUPERVISOR" "$SUPERVISED_ROOT" --check-once >/dev/null 2>&1 || true
}

alive() { kill -0 "$1" 2>/dev/null; }

SUP_LOG="$SUPERVISED_ROOT/.swarmforge/daemon/handoffd-supervisor.log"

# ── supervisor-reaper-path-boundary-01 (Scenario Outline, all 6 examples) ──

PID_SAME="$(start_fake_daemon "$BASE/srv/swarm")"
PID_NESTED_FIXTURE="$(start_fake_daemon "$BASE/srv/swarm/tmp/fx")"
PID_NESTED_TARGET="$(start_fake_daemon "$BASE/srv/swarm/target")"
PID_SIBLING="$(start_fake_daemon "$BASE/srv/swarm-2")"
PID_PREFIX_EXTEND="$(start_fake_daemon "$BASE/srv/swarmforge")"
PID_UNRELATED="$(start_fake_daemon "$BASE/srv/other")"

sleep 0.3
run_check_once
sleep 0.3

alive "$PID_SAME" && { kill -9 "$PID_SAME"; fail "01: expected the SAME-root daemon (root == supervised root) to be reaped"; }
pass "01 [/srv/swarm -> is reaped]: a daemon whose root IS the supervised root is reaped"

alive "$PID_NESTED_FIXTURE" || fail "01: expected the nested-fixture daemon (/srv/swarm/tmp/fx) to be left alive"
pass "01 [/srv/swarm/tmp/fx -> is left alive]: a daemon rooted BENEATH the supervised root is never reaped"

alive "$PID_NESTED_TARGET" || fail "01: expected the nested-target daemon (/srv/swarm/target) to be left alive"
pass "01 [/srv/swarm/target -> is left alive]: a different nested root is never reaped"

alive "$PID_SIBLING" || fail "01: expected the sibling-suffix daemon (/srv/swarm-2) to be left alive"
pass "01 [/srv/swarm-2 -> is left alive]: a sibling project whose path extends the root as a text suffix is never reaped"

alive "$PID_PREFIX_EXTEND" || fail "01: expected the prefix-extending daemon (/srv/swarmforge) to be left alive"
pass "01 [/srv/swarmforge -> is left alive]: a differently-named project whose path extends the root as a text prefix is never reaped"

alive "$PID_UNRELATED" || fail "01: expected the unrelated daemon (/srv/other) to be left alive"
pass "01 [/srv/other -> is left alive]: a wholly unrelated root is never reaped"

kill -9 "$PID_NESTED_FIXTURE" "$PID_NESTED_TARGET" "$PID_SIBLING" "$PID_PREFIX_EXTEND" "$PID_UNRELATED" 2>/dev/null || true

# ── supervisor-reaper-path-boundary-02: reaping a genuine orphan logs it ───

: > "$SUP_LOG"
PID_ORPHAN="$(start_fake_daemon "$BASE/srv/swarm")"
sleep 0.3
run_check_once
sleep 0.3
alive "$PID_ORPHAN" && { kill -9 "$PID_ORPHAN"; fail "02: expected the genuine same-root orphan to be reaped"; }
grep -q "reap-orphan $PID_ORPHAN" "$SUP_LOG" \
  || fail "02: expected a reap-orphan log entry naming pid $PID_ORPHAN, got: $(cat "$SUP_LOG")"
pass "02: reaping a genuine orphan records a reap-orphan entry naming its pid in the supervisor log"

# ── supervisor-reaper-path-boundary-03: a spared daemon keeps delivering ───
# Uses a REAL handoffd.bb (not the fake stub) so "remains able to deliver
# handoffs" is a real, observable claim - a sibling root's daemon actually
# relays a real outbox entry to a real inbox after the reap sweep runs.

SIBLING_ROOT="$BASE/srv/swarm-2"
# coordinator is master-resident (its own mailbox lives under a per-role
# ".../handoffs/coordinator/" subdir, BL-128); coder has its own dedicated
# worktree (worktree-name != "master"), so its mailbox is the FLAT
# ".../handoffs/" layout - reusing the same physical SIBLING_ROOT for both
# is harmless (mailbox-base-dir branches on worktree-name, not on path
# uniqueness).
mkdir -p "$SIBLING_ROOT/.swarmforge/handoffs/coordinator/outbox/tmp" \
  "$SIBLING_ROOT/.swarmforge/handoffs/inbox/new" \
  "$SIBLING_ROOT/.swarmforge/daemon"
cat > "$SIBLING_ROOT/.swarmforge/roles.tsv" <<TSV
coordinator	master	$SIBLING_ROOT	swarmforge-coordinator	Coordinator	claude	task
coder	coder	$SIBLING_ROOT	swarmforge-coder	Coder	claude	task
TSV
echo "/dev/null" > "$SIBLING_ROOT/.swarmforge/tmux-socket"
: > "$SUP_LOG"

SIBLING_HANDOFFD_PID=""
env -u RESEND_API_KEY bb "$SCRIPT_DIR/../handoffd.bb" "$SIBLING_ROOT" >/dev/null 2>&1 &
SIBLING_HANDOFFD_PID=$!
FAKE_PIDS+=("$SIBLING_HANDOFFD_PID")

# Wait for the real daemon to actually claim its pid file before sweeping.
for _ in $(seq 1 40); do
  [[ -f "$SIBLING_ROOT/.swarmforge/daemon/handoffd.pid" ]] && break
  sleep 0.1
done
[[ -f "$SIBLING_ROOT/.swarmforge/daemon/handoffd.pid" ]] || fail "03 setup: sibling daemon never wrote its pid file"

run_check_once
sleep 0.3

alive "$SIBLING_HANDOFFD_PID" || fail "03: expected the sibling-root daemon to survive this root's reap sweep"
grep -q "reap-orphan" "$SUP_LOG" && fail "03: expected NO reap-orphan entry for the untouched sibling daemon, got: $(cat "$SUP_LOG")"
pass "03: a sibling-root daemon is never reaped, no reap-orphan entry written for it"

# Prove it can still actually deliver: drop a handoff into the coordinator's
# (master-resident) outbox and confirm it lands in coder's (flat) inbox.
printf 'from: coordinator\nto: coder\npriority: 50\ntype: note\nmessage: still alive\n\nbody\n' \
  > "$SIBLING_ROOT/.swarmforge/handoffs/coordinator/outbox/50_still_alive.handoff"
DELIVERED=0
for _ in $(seq 1 40); do
  if compgen -G "$SIBLING_ROOT/.swarmforge/handoffs/inbox/new/*.handoff" > /dev/null; then
    DELIVERED=1
    break
  fi
  sleep 0.1
done
[[ "$DELIVERED" == "1" ]] || fail "03: expected the spared sibling daemon to still deliver a real handoff after the reap sweep"
pass "03: the spared sibling-root daemon remains able to deliver handoffs after the reap sweep"

kill -9 "$SIBLING_HANDOFFD_PID" 2>/dev/null || true

# ── supervisor-reaper-path-boundary-04: the supervisor never reaps itself ──
# handoffd-pids-for-root already excludes any cmd containing
# "handoffd_supervisor.bb" - proven here against THIS supervisor's own
# real, currently-running --check-once invocation rather than only by
# code inspection.

: > "$SUP_LOG"
SUPERVISOR_KILL_TIMEOUT_MS=1000 bb "$SUPERVISOR" "$SUPERVISED_ROOT" --check-once >/dev/null 2>&1 &
SELF_PID=$!
FAKE_PIDS+=("$SELF_PID")
sleep 0.3
alive "$SELF_PID" || true # --check-once may have already exited cleanly; that is fine
wait "$SELF_PID" 2>/dev/null || true
grep -q "reap-orphan $SELF_PID" "$SUP_LOG" && fail "04: the supervisor must never reap its own pid"
pass "04: the supervisor never reaps itself"

echo "ALL PASS"
