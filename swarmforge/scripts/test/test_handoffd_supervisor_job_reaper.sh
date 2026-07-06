#!/usr/bin/env bash
# BL-108 (supervisor-level reaper, added 2026-07-06): an agent-spawned mutation
# or test-batch process (Stryker root, `node --test` batch) can crash-orphan
# when its owning agent dies mid-run - the process reparents to launchd
# (PPID 1) with no owner left alive to reap it. Structurally, agent-side
# pre-run/pre-handoff cleanup cannot catch this: the agent that would run the
# cleanup is the one that died. The always-on handoffd_supervisor must own it:
# on every check tick it reaps PPID-1 stryker/node --test processes rooted
# under a swarm worktree that no live agent owns, but must NEVER kill a
# process that is still parented to a live process (a legitimately-running
# job), only a true PPID-1 orphan.
#
# Covers acceptance scenarios BL-108 supervisor-reaper-04 and -05.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SUPERVISOR="$SCRIPT_DIR/../handoffd_supervisor.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

check_once() {
  SUPERVISOR_STALL_MS=500 SUPERVISOR_RAPID_WINDOW_MS=60000 SUPERVISOR_MAX_RAPID=3 \
  SUPERVISOR_BACKOFF_MS=60000 PATH="$FAKE_BIN:$PATH" bb "$SUPERVISOR" "$ROOT" --check-once
}

make_fixture() {
  ROOT="$(cd "$(mktemp -d)" && pwd -P)"
  DAEMON_DIR="$ROOT/.swarmforge/daemon"
  CODER_WT="$ROOT/.worktrees/coder"
  mkdir -p "$DAEMON_DIR" "$CODER_WT/.swarmforge/handoffs/outbox" "$CODER_WT/.stryker-tmp"
  echo "$ROOT/fake.sock" > "$ROOT/.swarmforge/tmux-socket"
  touch "$ROOT/fake.sock"
  printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" \
    > "$ROOT/.swarmforge/roles.tsv"
  # a healthy tracked daemon so reaping is exercised independent of restart logic
  echo "$$" > "$DAEMON_DIR/handoffd.pid"
  touch "$DAEMON_DIR/handoffd.heartbeat"

  FAKE_BIN="$ROOT/bin"
  mkdir -p "$FAKE_BIN"
  cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
exit 0
TMUX
  chmod +x "$FAKE_BIN/tmux"
  "$FAKE_BIN/tmux" >/dev/null 2>&1 || true
}

pid_alive() { kill -0 "$1" 2>/dev/null; }

# The command line the supervisor must match on is the fixture script's own
# path, so it naturally embeds both "stryker" and the coder worktree path -
# no argv0 renaming needed. It writes its own pid to $2 once running.
write_fake_stryker_script() {
  local name="$1"
  cat > "$CODER_WT/$name" <<'PYEOF'
import os, sys, time
pid_file = sys.argv[1]
daemonize = sys.argv[2] == "orphan"
if daemonize:
    if os.fork() > 0:
        sys.exit(0)  # parent exits immediately: child reparents to launchd/init
    # Real detached mutation/test roots are spawned as their own session/
    # process-group leader (child_process detached:true, or a tmux pane).
    # Without this the fixture's group would collide with the test
    # runner's own group, so a group-kill of the fixture would also signal
    # the test script itself.
    os.setpgrp()
with open(pid_file, "w") as f:
    f.write(str(os.getpid()))
time.sleep(100)
PYEOF
}

# job-process-pattern matches "stryker" OR "node --test" (BL-108's other
# targeted job class: a node --test batch, not a Stryker root). This writer
# execs into a real `node --test <file>` after the same fork+reparent dance,
# so its ps command line is the literal "node --test ..." the pattern must
# also catch - the stryker-only fixture above never exercises this half of
# job-process-pattern's alternation.
write_fake_node_test_script() {
  local name="$1"
  cat > "$CODER_WT/$name" <<'PYEOF'
import os, sys
pid_file = sys.argv[1]
daemonize = sys.argv[2] == "orphan"
sleepy_js = sys.argv[3]
if daemonize:
    if os.fork() > 0:
        sys.exit(0)  # parent exits immediately: child reparents to launchd/init
    os.setpgrp()
with open(pid_file, "w") as f:
    f.write(str(os.getpid()))
os.execvp("node", ["node", "--test", sleepy_js])
PYEOF
  cat > "$CODER_WT/sleepy.test.js" <<'JSEOF'
setTimeout(() => {}, 100000);
JSEOF
}

trap 'jobs -p | xargs -r kill -9 2>/dev/null || true; rm -rf "$ROOT"' EXIT

# ── 04: a crash-orphaned stryker root (PPID 1) under a swarm worktree is reaped ─
make_fixture
write_fake_stryker_script "run_stryker.py"
python3 "$CODER_WT/run_stryker.py" "$ROOT/orphan.pid" orphan >/dev/null 2>&1 &
for _ in $(seq 1 40); do
  [[ -s "$ROOT/orphan.pid" ]] && break
  sleep 0.1
done
[[ -s "$ROOT/orphan.pid" ]] || fail "04 setup: fake stryker process never wrote its pid file"
ORPHAN_PID="$(cat "$ROOT/orphan.pid")"
# confirm it really did reparent to launchd/init before asserting anything
PPID_NOW=""
for _ in $(seq 1 40); do
  PPID_NOW="$(ps -o ppid= -p "$ORPHAN_PID" 2>/dev/null | tr -d ' ' || true)"
  if [[ "$PPID_NOW" == "1" ]]; then break; fi
  sleep 0.1
done
[[ "$PPID_NOW" == "1" ]] || fail "04 setup: process did not reparent to PPID 1 (got $PPID_NOW)"

check_once

if pid_alive "$ORPHAN_PID"; then
  kill -9 "$ORPHAN_PID"
  fail "04: crash-orphaned job process was not reaped"
fi
pass "04: crash-orphaned stryker/node-test process (PPID 1) rooted under a swarm worktree is reaped"

# ── 05: a live agent's in-progress run (not PPID 1) is left untouched ──────────
make_fixture
write_fake_stryker_script "run_stryker.py"
python3 "$CODER_WT/run_stryker.py" "$ROOT/owned.pid" owned >/dev/null 2>&1 &
OWNED_PID=$!
disown "$OWNED_PID" 2>/dev/null || true
for _ in $(seq 1 40); do
  [[ -s "$ROOT/owned.pid" ]] && break
  sleep 0.1
done
[[ -s "$ROOT/owned.pid" ]] || fail "05 setup: owned job process never wrote its pid file"
pid_alive "$OWNED_PID" || fail "05 setup: owned job process did not start"

check_once

pid_alive "$OWNED_PID" || fail "05: a live (non-orphaned) agent job process was killed"
kill -9 "$OWNED_PID" 2>/dev/null || true
pass "05: a live agent's in-progress mutation/test run (not PPID 1) is never touched"

# ── 06: a crash-orphaned `node --test` batch (the pattern's other alternative) ─
make_fixture
write_fake_node_test_script "run_node_test.py"
python3 "$CODER_WT/run_node_test.py" "$ROOT/orphan_node.pid" orphan "$CODER_WT/sleepy.test.js" >/dev/null 2>&1 &
for _ in $(seq 1 40); do
  [[ -s "$ROOT/orphan_node.pid" ]] && break
  sleep 0.1
done
[[ -s "$ROOT/orphan_node.pid" ]] || fail "06 setup: fake node --test process never wrote its pid file"
ORPHAN_NODE_PID="$(cat "$ROOT/orphan_node.pid")"
PPID_NOW=""
for _ in $(seq 1 40); do
  PPID_NOW="$(ps -o ppid= -p "$ORPHAN_NODE_PID" 2>/dev/null | tr -d ' ' || true)"
  if [[ "$PPID_NOW" == "1" ]]; then break; fi
  sleep 0.1
done
[[ "$PPID_NOW" == "1" ]] || fail "06 setup: process did not reparent to PPID 1 (got $PPID_NOW)"

check_once

if pid_alive "$ORPHAN_NODE_PID"; then
  kill -9 "$ORPHAN_NODE_PID"
  fail "06: crash-orphaned node --test process was not reaped"
fi
pass "06: crash-orphaned node --test batch (PPID 1) rooted under a swarm worktree is reaped"

echo "ALL PASS"
