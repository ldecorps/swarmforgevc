#!/usr/bin/env bash
# BL-145: `./swarm ensure` brings the swarm (extension host, every configured
# agent pane, the daemon, operator runtime, and Telegram front desk when
# configured) to a known-good state in one idempotent command.
# Each component reports HEALTHY / FIXED (naming the repair) / FAILED, never
# silently; a failed repair must not abort the remaining checks.
#
# The decision logic (swarm_ensure.bb's `classify`) is exercised here through
# its normal invocation path with injected fake probes/repairs (fake tmux,
# fake extension check/bounce, fake daemon supervisor) rather than unit-
# tested in isolation, mirroring test_handoffd_supervisor.sh's own approach
# to evaluate-health.
#
# Covers acceptance scenarios BL-145 swarm-ensure-01..04.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENSURE="$SCRIPT_DIR/../swarm_ensure.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

make_fixture() {
  # BL-461: scrub ambient Telegram creds so every scenario starts from a
  # clean slate regardless of the calling shell's own exported vars (a dev
  # box routinely has real TELEGRAM_BOT_TOKEN/CHAT_ID/PRINCIPAL_USER_ID set,
  # per the engineering guard-fires rule) - scenarios that need Telegram
  # configured (05b) export it explicitly AFTER calling make_fixture.
  # BL-763: CURSOR_BRIDGE_BOT_TOKEN scrubbed for the same reason.
  unset TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID TELEGRAM_PRINCIPAL_USER_ID CURSOR_BRIDGE_BOT_TOKEN || true

  ROOT="$(cd "$(mktemp -d)" && pwd -P)"
  mkdir -p "$ROOT/.swarmforge/daemon" "$ROOT/.swarmforge/operator" \
           "$ROOT/.swarmforge/launch" "$ROOT/.swarmforge/babysitterd" \
           "$ROOT/.worktrees/coder"
  echo "$ROOT/fake.sock" > "$ROOT/.swarmforge/tmux-socket"
  printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT/.worktrees/coder" \
    > "$ROOT/.swarmforge/roles.tsv"

  FAKE_BIN="$ROOT/bin"
  mkdir -p "$FAKE_BIN"

  # Healthy by default: pane present and not dead, daemon pid alive.
  echo "0" > "$ROOT/pane_dead"
  cat > "$FAKE_BIN/tmux" <<EOF
#!/usr/bin/env bash
if [[ "\$3" == "list-panes" ]]; then
  cat "$ROOT/pane_dead"
  exit 0
fi
if [[ "\$3" == "respawn-pane" ]]; then
  echo "0" > "$ROOT/pane_dead"
  exit 0
fi
exit 0
EOF
  chmod +x "$FAKE_BIN/tmux"

  echo "healthy" > "$ROOT/ext_state"
  cat > "$FAKE_BIN/fake_ext_check.sh" <<EOF
#!/usr/bin/env bash
[[ "\$(cat "$ROOT/ext_state")" == "healthy" ]] && exit 0 || exit 1
EOF
  chmod +x "$FAKE_BIN/fake_ext_check.sh"

  cat > "$FAKE_BIN/fake_ext_bounce.sh" <<EOF
#!/usr/bin/env bash
echo "healthy" > "$ROOT/ext_state"
exit 0
EOF
  chmod +x "$FAKE_BIN/fake_ext_bounce.sh"

  echo "$$" > "$ROOT/.swarmforge/daemon/handoffd.pid"
  # Same stand-in as handoffd: this test script's pid is alive. Without it,
  # ensure called the REAL start_babysitterd.sh against every temp root and
  # leaked looping daemons (cleanup never signalled babysitterd.pid).
  echo "$$" > "$ROOT/.swarmforge/babysitterd/babysitterd.pid"
  # BL-690: this fake must mirror the real repair command's START semantics
  # (start_handoff_daemon.sh), never a health PROBE - the previous fake here
  # (a bare `sleep` spawn standing in for `handoffd_supervisor.bb
  # --check-once`) never exercised the real command at all, which is exactly
  # how the alarm-and-halt! defect went undetected. It leaves a live process
  # behind (same real-background-sleep survival idiom as fake_operator_start.sh
  # below - a piped/inherited child does not survive this script's own exit,
  # a backgrounded one does) and appends a SUCCESS line to the same
  # daemon-start-audit.log path the real script writes, so scenarios can
  # assert on it the same way. Scenarios 01 and 06 of the BL-690 acceptance
  # feature (specs/pipeline/steps) exercise the REAL start_handoff_daemon.sh
  # with no override at all - this fake only needs to stand in for it here.
  cat > "$FAKE_BIN/fake_daemon_start.sh" <<EOF
#!/usr/bin/env bash
mkdir -p "$ROOT/.swarmforge/daemon"
sleep 100 >"$ROOT/fake-daemon.log" 2>&1 &
echo \$! > "$ROOT/.swarmforge/daemon/handoffd.pid"
printf '%s SUCCESS handoffd+supervisor running\n' "\$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  >> "$ROOT/.swarmforge/daemon/daemon-start-audit.log"
EOF
  chmod +x "$FAKE_BIN/fake_daemon_start.sh"

  # Operator healthy by default (this test script's pid as a live stand-in).
  # Front desk is omitted unless a fixture sets TELEGRAM_* or a pid file.
  echo "$$" > "$ROOT/.swarmforge/operator/runtime.pid"

  # Use a real background sleep so the repair leaves a live pid - same
  # survival rule as the fake daemon supervisor above.
  cat > "$FAKE_BIN/fake_operator_start.sh" <<EOF
#!/usr/bin/env bash
sleep 100 >"$ROOT/fake-operator.log" 2>&1 &
echo \$! > "$ROOT/.swarmforge/operator/runtime.pid"
EOF
  chmod +x "$FAKE_BIN/fake_operator_start.sh"

  cat > "$FAKE_BIN/fake_front_desk_start.sh" <<EOF
#!/usr/bin/env bash
sleep 100 >"$ROOT/fake-front-desk.log" 2>&1 &
echo \$! > "$ROOT/.swarmforge/operator/front-desk-supervisor.pid"
EOF
  chmod +x "$FAKE_BIN/fake_front_desk_start.sh"

  # BL-763: cursor bridge is omitted unless a fixture sets CURSOR_BRIDGE_BOT_TOKEN
  # or TELEGRAM_BOT_TOKEN (+ chat id + principal user id), or a pid file.
  cat > "$FAKE_BIN/fake_cursor_bridge_start.sh" <<EOF
#!/usr/bin/env bash
sleep 100 >"$ROOT/fake-cursor-bridge.log" 2>&1 &
echo \$! > "$ROOT/.swarmforge/operator/cursor-bridge-supervisor.pid"
EOF
  chmod +x "$FAKE_BIN/fake_cursor_bridge_start.sh"
}

run_ensure() {
  SWARM_ENSURE_EXTENSION_CHECK_CMD="$FAKE_BIN/fake_ext_check.sh" \
  SWARM_ENSURE_EXTENSION_BOUNCE_CMD="$FAKE_BIN/fake_ext_bounce.sh" \
  SWARM_ENSURE_SUPERVISOR_CMD="$FAKE_BIN/fake_daemon_start.sh" \
  SWARM_ENSURE_OPERATOR_CMD="$FAKE_BIN/fake_operator_start.sh" \
  SWARM_ENSURE_FRONT_DESK_CMD="$FAKE_BIN/fake_front_desk_start.sh" \
  SWARM_ENSURE_CURSOR_BRIDGE_CMD="$FAKE_BIN/fake_cursor_bridge_start.sh" \
  PATH="$FAKE_BIN:$PATH" bb "$ENSURE" "$ROOT"
}

cleanup_daemon() {
  local pid
  # The "already healthy" fixture records this test script's OWN pid as a
  # stand-in tracked process (it just needs to be alive, not a real daemon) -
  # never kill it.
  for pid_file in \
      "$ROOT/.swarmforge/daemon/handoffd.pid" \
      "$ROOT/.swarmforge/babysitterd/babysitterd.pid" \
      "$ROOT/.swarmforge/operator/runtime.pid" \
      "$ROOT/.swarmforge/operator/front-desk-supervisor.pid" \
      "$ROOT/.swarmforge/operator/cursor-bridge-supervisor.pid"; do
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "$pid" && "$pid" != "$$" ]]; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
}

trap 'cleanup_daemon; rm -rf "${ROOT:-}"' EXIT

# ── 01: healthy swarm is a fast no-op, all HEALTHY, exit 0 ──────────────────
make_fixture
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^extension: HEALTHY$" || fail "01: extension not reported HEALTHY"
echo "$OUT" | grep -q "^agent:coder: HEALTHY$" || fail "01: agent pane not reported HEALTHY"
echo "$OUT" | grep -q "^daemon: HEALTHY$" || fail "01: daemon not reported HEALTHY"
echo "$OUT" | grep -q "^operator: HEALTHY$" || fail "01: operator not reported HEALTHY"
echo "$OUT" | grep -q "front-desk:" && fail "01: front-desk was checked without Telegram config"
[[ "$RC" -eq 0 ]] || fail "01: exit status was $RC, expected 0"
[[ "$(cat "$ROOT/ext_state")" == "healthy" ]] || fail "01: healthy extension state was changed"
[[ "$(cat "$ROOT/pane_dead")" == "0" ]] || fail "01: healthy pane state was changed"
cleanup_daemon
pass "01: healthy swarm is a fast no-op reporting all-HEALTHY with exit 0"

# ── 02a: extension not running is repaired and reported FIXED ──────────────
make_fixture
echo "unhealthy" > "$ROOT/ext_state"
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^extension: FIXED (bounced the extension dev host)$" \
  || fail "02a: extension repair not reported as FIXED naming the action"
[[ "$(cat "$ROOT/ext_state")" == "healthy" ]] || fail "02a: extension was not actually repaired"
cleanup_daemon
pass "02a: extension host not running is repaired and reported FIXED naming the action"

# ── 02b: agent pane absent from the tmux session is repaired ───────────────
make_fixture
echo "absent" > "$ROOT/session_state"
cat > "$FAKE_BIN/tmux" <<EOF
#!/usr/bin/env bash
if [[ "\$3" == "list-panes" ]]; then
  [[ "\$(cat "$ROOT/session_state")" == "absent" ]] && exit 1
  echo "0"
  exit 0
fi
if [[ "\$3" == "respawn-pane" ]]; then
  echo "present" > "$ROOT/session_state"
  echo "present" >> "$ROOT/respawned"
  exit 0
fi
exit 0
EOF
chmod +x "$FAKE_BIN/tmux"
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^agent:coder: FIXED (respawned pane from its persisted launch script)$" \
  || fail "02b: absent pane repair not reported as FIXED naming the action"
[[ -s "$ROOT/respawned" ]] || fail "02b: absent pane was not actually respawned"
cleanup_daemon
pass "02b: agent pane absent from the tmux session is repaired and reported FIXED"

# ── 02c: agent pane present but dead is repaired ────────────────────────────
make_fixture
echo "1" > "$ROOT/pane_dead"
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^agent:coder: FIXED (respawned pane from its persisted launch script)$" \
  || fail "02c: dead-pane repair not reported as FIXED naming the action"
[[ "$(cat "$ROOT/pane_dead")" == "0" ]] || fail "02c: dead pane was not actually respawned"
cleanup_daemon
pass "02c: agent pane present but its process is dead is repaired and reported FIXED"

# ── 02d: daemon not running is repaired and reported FIXED ──────────────────
make_fixture
echo "999999" > "$ROOT/.swarmforge/daemon/handoffd.pid"
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^daemon: FIXED (restarted the handoff daemon)$" \
  || fail "02d: daemon repair not reported as FIXED naming the action"
NEW_PID="$(cat "$ROOT/.swarmforge/daemon/handoffd.pid")"
kill -0 "$NEW_PID" 2>/dev/null || fail "02d: daemon repair did not leave a live process behind"
cleanup_daemon
pass "02d: daemon not running is repaired and reported FIXED, leaving a live process behind"

# ── 03: one failed repair does not abort the remaining checks ──────────────
make_fixture
echo "unhealthy" > "$ROOT/ext_state"
cat > "$FAKE_BIN/fake_ext_bounce.sh" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$FAKE_BIN/fake_ext_bounce.sh"
echo "999999" > "$ROOT/.swarmforge/daemon/handoffd.pid"
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^extension: FAILED" || fail "03: extension failure not reported as FAILED"
echo "$OUT" | grep -q "^daemon: FIXED" || fail "03: daemon check did not still run and repair after extension failed"
[[ "$RC" -ne 0 ]] || fail "03: exit status was 0, expected non-zero after a failed repair"
cleanup_daemon
pass "03: one failed repair (extension) does not abort the remaining checks (daemon still repaired); exit status is non-zero"

# ── 04: no tmux socket at all - every configured agent pane is reported
#        FAILED (not silently skipped), and the other components still run ──
make_fixture
rm -f "$ROOT/.swarmforge/tmux-socket"
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
# BL-207: FAILED lines now also name the stable Forge error category
# (classify-provider-error) alongside the raw reason, never in place of it.
echo "$OUT" | grep -q "^agent:coder: FAILED \[launch-failed\] (no tmux socket found for this project root)$" \
  || fail "04: missing tmux socket did not report agent:coder as FAILED naming the category and reason; got: $OUT"
echo "$OUT" | grep -q "^rc:coder: HEALTHY$" \
  || fail "04 (BL-514): missing tmux socket did not still report rc:coder as HEALTHY (no separate rc failure); got: $OUT"
echo "$OUT" | grep -q "^extension: HEALTHY$" || fail "04: extension check did not still run without a tmux socket"
echo "$OUT" | grep -q "^daemon: HEALTHY$" || fail "04: daemon check did not still run without a tmux socket"
[[ "$RC" -ne 0 ]] || fail "04: exit status was 0, expected non-zero when an agent pane could not be checked"
cleanup_daemon
pass "04: no tmux socket found reports every configured agent pane as FAILED naming the category and reason, other checks still run"

# ── 05a: operator runtime not running is repaired and reported FIXED ───────
make_fixture
echo "999999" > "$ROOT/.swarmforge/operator/runtime.pid"
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^operator: FIXED (restarted the operator runtime)$" \
  || fail "05a: operator repair not reported as FIXED naming the action; got: $OUT"
NEW_OP_PID="$(cat "$ROOT/.swarmforge/operator/runtime.pid")"
kill -0 "$NEW_OP_PID" 2>/dev/null || fail "05a: operator repair did not leave a live process behind"
cleanup_daemon
pass "05a: operator runtime not running is repaired and reported FIXED"

# ── 05b: front desk is repaired when Telegram is configured ────────────────
make_fixture
export TELEGRAM_BOT_TOKEN="test-token"
export TELEGRAM_CHAT_ID="1"
export TELEGRAM_PRINCIPAL_USER_ID="2"
echo "999999" > "$ROOT/.swarmforge/operator/front-desk-supervisor.pid"
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^front-desk: FIXED (restarted the Telegram front desk (bridge + bot))$" \
  || fail "05b: front-desk repair not reported as FIXED naming the action; got: $OUT"
NEW_FD_PID="$(cat "$ROOT/.swarmforge/operator/front-desk-supervisor.pid")"
kill -0 "$NEW_FD_PID" 2>/dev/null || fail "05b: front-desk repair did not leave a live process behind"
unset TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID TELEGRAM_PRINCIPAL_USER_ID
cleanup_daemon
pass "05b: front desk not running (Telegram configured) is repaired and reported FIXED"

# ── 05c: prior front-desk pid file alone is enough to enable repair ────────
make_fixture
unset TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID TELEGRAM_PRINCIPAL_USER_ID || true
echo "999999" > "$ROOT/.swarmforge/operator/front-desk-supervisor.pid"
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^front-desk: FIXED" \
  || fail "05c: stale front-desk pid file did not trigger repair; got: $OUT"
cleanup_daemon
pass "05c: a prior front-desk pid file enables repair even without Telegram env in this shell"

# ── 05d: a blank (but SET) Telegram env var does not count as configured ───
# env-set? guards against both unset AND blank (`and (some? v) (not (blank? v))`);
# every other scenario only ever exercises the fully-unset case, so a mutant
# collapsing that guard to just `(some? v)` (blank counts as configured) would
# survive undetected without this.
make_fixture
unset TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID TELEGRAM_PRINCIPAL_USER_ID || true
export TELEGRAM_BOT_TOKEN=""
export TELEGRAM_CHAT_ID="1"
export TELEGRAM_PRINCIPAL_USER_ID="2"
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "front-desk:" \
  && fail "05d: blank TELEGRAM_BOT_TOKEN was treated as configured; got: $OUT"
unset TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID TELEGRAM_PRINCIPAL_USER_ID
cleanup_daemon
pass "05d: a blank (but set) TELEGRAM_BOT_TOKEN does not count as Telegram configured"

# ── 05e: partial Telegram env (only one of three vars set) is not configured ─
# telegram-configured? ANDs all three env-set? checks; every other scenario
# sets all three together or none, so an AND->OR mutant would survive
# undetected without a partial-set case.
make_fixture
unset TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID TELEGRAM_PRINCIPAL_USER_ID || true
export TELEGRAM_BOT_TOKEN="only-one-set"
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "front-desk:" \
  && fail "05e: partial Telegram env (bot token only) was treated as configured; got: $OUT"
unset TELEGRAM_BOT_TOKEN
cleanup_daemon
pass "05e: partial Telegram env (only one of three vars set) does not count as configured"

# ── 05f: cursor bridge is repaired when configured via CURSOR_BRIDGE_BOT_TOKEN ─
make_fixture
export CURSOR_BRIDGE_BOT_TOKEN="test-token"
export TELEGRAM_CHAT_ID="1"
export TELEGRAM_PRINCIPAL_USER_ID="2"
echo "999999" > "$ROOT/.swarmforge/operator/cursor-bridge-supervisor.pid"
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^cursor-bridge: FIXED (restarted the Cursor Remote bridge)$" \
  || fail "05f: cursor-bridge repair not reported as FIXED naming the action; got: $OUT"
NEW_CB_PID="$(cat "$ROOT/.swarmforge/operator/cursor-bridge-supervisor.pid")"
kill -0 "$NEW_CB_PID" 2>/dev/null || fail "05f: cursor-bridge repair did not leave a live process behind"
unset CURSOR_BRIDGE_BOT_TOKEN TELEGRAM_CHAT_ID TELEGRAM_PRINCIPAL_USER_ID
cleanup_daemon
pass "05f: cursor bridge not running (CURSOR_BRIDGE_BOT_TOKEN configured) is repaired and reported FIXED"

# ── 05g: cursor bridge also repairs off the shared TELEGRAM_BOT_TOKEN ──────
make_fixture
export TELEGRAM_BOT_TOKEN="test-token"
export TELEGRAM_CHAT_ID="1"
export TELEGRAM_PRINCIPAL_USER_ID="2"
echo "999999" > "$ROOT/.swarmforge/operator/cursor-bridge-supervisor.pid"
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^cursor-bridge: FIXED" \
  || fail "05g: cursor-bridge repair not reported as FIXED off shared TELEGRAM_BOT_TOKEN; got: $OUT"
unset TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID TELEGRAM_PRINCIPAL_USER_ID
cleanup_daemon
pass "05g: cursor bridge also repairs when only the shared TELEGRAM_BOT_TOKEN is set"

# ── 05h: a prior cursor-bridge pid file alone is enough to enable repair ───
make_fixture
echo "999999" > "$ROOT/.swarmforge/operator/cursor-bridge-supervisor.pid"
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^cursor-bridge: FIXED" \
  || fail "05h: stale cursor-bridge pid file did not trigger repair; got: $OUT"
cleanup_daemon
pass "05h: a prior cursor-bridge pid file enables repair even without any bridge env in this shell"

# ── 05i: SWARMFORGE_SKIP_CURSOR_BRIDGE=1 wins even when configured ─────────
make_fixture
export SWARMFORGE_SKIP_CURSOR_BRIDGE=1
export CURSOR_BRIDGE_BOT_TOKEN="test-token"
export TELEGRAM_CHAT_ID="1"
export TELEGRAM_PRINCIPAL_USER_ID="2"
echo "999999" > "$ROOT/.swarmforge/operator/cursor-bridge-supervisor.pid"
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "cursor-bridge:" \
  && fail "05i: SWARMFORGE_SKIP_CURSOR_BRIDGE=1 did not suppress cursor-bridge; got: $OUT"
unset SWARMFORGE_SKIP_CURSOR_BRIDGE CURSOR_BRIDGE_BOT_TOKEN TELEGRAM_CHAT_ID TELEGRAM_PRINCIPAL_USER_ID
cleanup_daemon
pass "05i: SWARMFORGE_SKIP_CURSOR_BRIDGE=1 wins even with credentials present and a stale pid file"

# ── 07a: launch-contract HEALTHY when no swarm-identity file exists at all ─
make_fixture
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^launch-contract: HEALTHY$" \
  || fail "07a: launch-contract not reported HEALTHY with no swarm-identity file; got: $OUT"
cleanup_daemon
pass "07a: launch-contract reports HEALTHY when no swarm-identity file exists"

# ── 07b: launch-contract FAILED when the effective pack conf names a
#         non-default coordinator_agent but omits coordinator_model/rotation
#         (BL-530 / BL-512 audit rank 3 - the cerebras-mono-router.conf bug) ─
make_fixture
cat > "$ROOT/broken-pack.conf" <<'EOF'
config rotation router
config coordinator_agent aider
EOF
printf 'active_backlog_max_depth_conf_path\t%s\n' "$ROOT/broken-pack.conf" >> "$ROOT/.swarmforge/swarm-identity"
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^launch-contract: FAILED (coordinator_agent is 'aider' but coordinator_model is unset" \
  || fail "07b: launch-contract did not report the missing coordinator_model; got: $OUT"
[[ "$RC" -ne 0 ]] || fail "07b: exit status was 0, expected non-zero with a broken launch contract"
cleanup_daemon
pass "07b: launch-contract reports FAILED naming the missing coordinator_model, non-zero exit"

# ── 07c: launch-contract HEALTHY when the effective pack conf declares its
#         full contract (coordinator_model AND rotation both set) ──────────
make_fixture
cat > "$ROOT/compliant-pack.conf" <<'EOF'
config rotation router
config coordinator_agent aider
config coordinator_model openai/gpt-oss-120b
EOF
printf 'active_backlog_max_depth_conf_path\t%s\n' "$ROOT/compliant-pack.conf" >> "$ROOT/.swarmforge/swarm-identity"
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^launch-contract: HEALTHY$" \
  || fail "07c: launch-contract not reported HEALTHY for a fully-declared pack; got: $OUT"
[[ "$RC" -eq 0 ]] || fail "07c: exit status was $RC, expected 0 for a fully-declared pack"
cleanup_daemon
pass "07c: launch-contract reports HEALTHY when the effective pack declares its full contract"

# ── 07d: a broken launch contract refuses to respawn a dead agent pane
#         instead of repairing it onto the same broken argv (BL-530 architect
#         bounce, defect 1) ─────────────────────────────────────────────────
make_fixture
echo "1" > "$ROOT/pane_dead"
cat > "$ROOT/broken-pack.conf" <<'EOF'
config rotation router
config coordinator_agent aider
EOF
printf 'active_backlog_max_depth_conf_path\t%s\n' "$ROOT/broken-pack.conf" >> "$ROOT/.swarmforge/swarm-identity"
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^agent:coder: FAILED (respawn refused: launch contract broken - fix the pack conf, then rerun ensure)$" \
  || fail "07d: dead pane under a broken contract was not reported as respawn-refused; got: $OUT"
[[ "$(cat "$ROOT/pane_dead")" == "1" ]] \
  || fail "07d: dead pane was respawned despite a broken launch contract"
[[ "$RC" -ne 0 ]] || fail "07d: exit status was 0, expected non-zero"
cleanup_daemon
pass "07d: a broken launch contract refuses to respawn a dead agent pane"

# ── 07e: a broken launch contract leaves an already-healthy pane alone
#         (no refusal message, no respawn attempt either) ──────────────────
make_fixture
cat > "$ROOT/broken-pack.conf" <<'EOF'
config rotation router
config coordinator_agent aider
EOF
printf 'active_backlog_max_depth_conf_path\t%s\n' "$ROOT/broken-pack.conf" >> "$ROOT/.swarmforge/swarm-identity"
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^agent:coder: HEALTHY$" \
  || fail "07e: an already-healthy pane was disturbed by a broken launch contract; got: $OUT"
cleanup_daemon
pass "07e: a broken launch contract leaves an already-healthy agent pane untouched"

# ── 07f: a stale/unreadable persisted conf path falls back to the tracked
#         default conf rather than silently reporting HEALTHY (BL-530
#         architect bounce, defect 2) ────────────────────────────────────────
make_fixture
mkdir -p "$ROOT/swarmforge"
cat > "$ROOT/swarmforge/swarmforge.conf" <<'EOF'
config rotation router
config coordinator_agent aider
EOF
printf 'active_backlog_max_depth_conf_path\t%s\n' "$ROOT/no-longer-exists.conf" >> "$ROOT/.swarmforge/swarm-identity"
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^launch-contract: FAILED (coordinator_agent is 'aider' but coordinator_model is unset" \
  || fail "07f: a stale persisted conf path did not fall back to the tracked default conf; got: $OUT"
[[ "$RC" -ne 0 ]] || fail "07f: exit status was 0, expected non-zero"
cleanup_daemon
pass "07f: a stale persisted conf path falls back to the tracked default conf instead of reading HEALTHY"

# ── 06: SWARMFORGE_SKIP_OPERATOR omits the operator check entirely ─────────
make_fixture
echo "999999" > "$ROOT/.swarmforge/operator/runtime.pid"
if OUT="$(SWARMFORGE_SKIP_OPERATOR=1 run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "operator:" && fail "06: operator was checked despite SWARMFORGE_SKIP_OPERATOR=1"
echo "$OUT" | grep -q "^daemon: HEALTHY$" || fail "06: daemon check did not still run"
[[ "$RC" -eq 0 ]] || fail "06: exit status was $RC, expected 0"
cleanup_daemon
pass "06: SWARMFORGE_SKIP_OPERATOR=1 omits the operator component"



# ---------------------------------------------------------------------------
# Extra: mono-router dormant roles report DORMANT (not FAILED)
# ---------------------------------------------------------------------------
make_fixture
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT/.worktrees/coder" > "$ROOT/.swarmforge/roles.tsv"
printf 'specifier\tspecifier\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$ROOT/.worktrees/coder" >> "$ROOT/.swarmforge/roles.tsv"
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"
# BL-530 architect bounce (round 3): mono-router-ness must come from a
# declared signal, not an inferred live shape — declare it explicitly.
printf 'rotation\trouter\n' > "$ROOT/.swarmforge/swarm-identity"
# BL-537: rotate_to_role specifier needs specifier's own launch script on
# disk (the router launcher pre-generates one per pipeline role at startup);
# a live resident to rotate onto is confirmed via the "swarmforge-coder"
# has-session/list-panes branches below.
touch "$ROOT/.swarmforge/launch/specifier.sh"
RESPAWN_LOG="$ROOT/respawns"
: > "$RESPAWN_LOG"
cat > "$FAKE_BIN/tmux" <<TMUXFAKE
#!/usr/bin/env bash
sock_cmd="\$3"
if [[ "\$sock_cmd" == "has-session" ]]; then
  target="\$5"
  case "\$target" in
    swarmforge-coder|swarmforge-coordinator) exit 0 ;;
    *) exit 1 ;;
  esac
fi
if [[ "\$sock_cmd" == "list-panes" ]]; then
  echo "0"
  exit 0
fi
if [[ "\$sock_cmd" == "respawn-pane" ]]; then
  echo "RESPAWN" >> "$RESPAWN_LOG"
  exit 0
fi
exit 0
TMUXFAKE
chmod +x "$FAKE_BIN/tmux"
OUTPUT=$(PATH="$FAKE_BIN:$PATH" \
  SWARMFORGE_ENSURE_EXTENSION_CHECK="$FAKE_BIN/fake_ext_check.sh" \
  SWARMFORGE_ENSURE_EXTENSION_BOUNCE="$FAKE_BIN/fake_ext_bounce.sh" \
  SWARMFORGE_ENSURE_SUPERVISOR="$FAKE_BIN/fake_supervisor.bb" \
  SWARMFORGE_SKIP_OPERATOR=1 SWARMFORGE_SKIP_FRONT_DESK=1 \
  bb "$ENSURE" "$ROOT" 2>&1) || true
echo "$OUTPUT" | grep -q 'agent:specifier: DORMANT' || fail "expected specifier DORMANT, got: $OUTPUT"
echo "$OUTPUT" | grep -q 'agent:coder: HEALTHY' || fail "expected coder HEALTHY"
if [[ -s "$RESPAWN_LOG" ]]; then fail "dormant role should not be respawned"; fi
pass "mono-router dormant roles report DORMANT without respawn"

# ---------------------------------------------------------------------------
# Extra (BL-537): a dormant rotate target whose own launch script is missing
# must report FAILED, not DORMANT — rotate_to_role would hit "no-launch-script"
# even though the resident (coder) is perfectly healthy. Never let "no
# standing session" (expected/by-design) get confused with "rotate would
# actually fail if invoked right now".
# ---------------------------------------------------------------------------
make_fixture
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT/.worktrees/coder" > "$ROOT/.swarmforge/roles.tsv"
printf 'specifier\tspecifier\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$ROOT/.worktrees/coder" >> "$ROOT/.swarmforge/roles.tsv"
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"
printf 'rotation\trouter\n' > "$ROOT/.swarmforge/swarm-identity"
# Deliberately no launch/specifier.sh — the launcher failed to pre-generate it.
cat > "$FAKE_BIN/tmux" <<TMUXFAKE
#!/usr/bin/env bash
sock_cmd="\$3"
if [[ "\$sock_cmd" == "has-session" ]]; then
  target="\$5"
  case "\$target" in
    swarmforge-coder|swarmforge-coordinator) exit 0 ;;
    *) exit 1 ;;
  esac
fi
if [[ "\$sock_cmd" == "list-panes" ]]; then
  echo "0"
  exit 0
fi
if [[ "\$sock_cmd" == "respawn-pane" ]]; then
  exit 0
fi
exit 0
TMUXFAKE
chmod +x "$FAKE_BIN/tmux"
OUTPUT=$(PATH="$FAKE_BIN:$PATH" \
  SWARMFORGE_ENSURE_EXTENSION_CHECK="$FAKE_BIN/fake_ext_check.sh" \
  SWARMFORGE_ENSURE_EXTENSION_BOUNCE="$FAKE_BIN/fake_ext_bounce.sh" \
  SWARMFORGE_ENSURE_SUPERVISOR="$FAKE_BIN/fake_supervisor.bb" \
  SWARMFORGE_SKIP_OPERATOR=1 SWARMFORGE_SKIP_FRONT_DESK=1 \
  bb "$ENSURE" "$ROOT" 2>&1) || true
echo "$OUTPUT" | grep -q '^agent:specifier: FAILED (rotate_to_role would fail: missing launch script for role)$' \
  || fail "expected specifier FAILED for missing launch script, got: $OUTPUT"
echo "$OUTPUT" | grep -q 'agent:coder: HEALTHY' || fail "expected coder HEALTHY"
pass "BL-537: mono-router dormant role with no launch script reports FAILED, not DORMANT"

# ---------------------------------------------------------------------------
# Extra (BL-537): a dormant rotate target reports FAILED when the resident
# it would rotate onto is dead AND cannot be revived — rotate_to_role would
# hit "no-resident-session". Mirrors the SRE incident (2026-07-19): killing
# aider tore down both the coder and specifier sessions; ensure must not
# keep reporting specifier as a harmless DORMANT rotate target once there is
# no live resident left for it to ever rotate onto.
# ---------------------------------------------------------------------------
make_fixture
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT/.worktrees/coder" > "$ROOT/.swarmforge/roles.tsv"
printf 'specifier\tspecifier\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$ROOT/.worktrees/coder" >> "$ROOT/.swarmforge/roles.tsv"
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"
printf 'rotation\trouter\n' > "$ROOT/.swarmforge/swarm-identity"
touch "$ROOT/.swarmforge/launch/specifier.sh"
cat > "$FAKE_BIN/tmux" <<TMUXFAKE
#!/usr/bin/env bash
sock_cmd="\$3"
if [[ "\$sock_cmd" == "has-session" ]]; then
  target="\$5"
  [[ "\$target" == "swarmforge-coordinator" ]] && exit 0
  exit 1
fi
if [[ "\$sock_cmd" == "list-panes" ]]; then
  exit 1
fi
if [[ "\$sock_cmd" == "new-session" ]]; then
  exit 1
fi
if [[ "\$sock_cmd" == "respawn-pane" ]]; then
  exit 0
fi
exit 0
TMUXFAKE
chmod +x "$FAKE_BIN/tmux"
OUTPUT=$(PATH="$FAKE_BIN:$PATH" \
  SWARMFORGE_ENSURE_EXTENSION_CHECK="$FAKE_BIN/fake_ext_check.sh" \
  SWARMFORGE_ENSURE_EXTENSION_BOUNCE="$FAKE_BIN/fake_ext_bounce.sh" \
  SWARMFORGE_ENSURE_SUPERVISOR="$FAKE_BIN/fake_supervisor.bb" \
  SWARMFORGE_SKIP_OPERATOR=1 SWARMFORGE_SKIP_FRONT_DESK=1 \
  bb "$ENSURE" "$ROOT" 2>&1) || true
echo "$OUTPUT" | grep -q '^agent:coder: FAILED' \
  || fail "expected coder (resident) FAILED when its session cannot be recreated, got: $OUTPUT"
echo "$OUTPUT" | grep -q '^agent:specifier: FAILED (rotate_to_role would fail: no live resident session to rotate from)$' \
  || fail "expected specifier FAILED for no live resident, got: $OUTPUT"
pass "BL-537: mono-router dormant role reports FAILED when resident cannot be revived, not silently DORMANT"

# ---------------------------------------------------------------------------
# Extra: a classic pack with one half-launched session must NOT be classified
# as mono-router — the live-shape fallback (some sessions standing, some
# absent) that BL-530 round 3 removed was equally the fingerprint of a
# half-launch/partial-crash, which ensure must repair, not tear down.
# ---------------------------------------------------------------------------
make_fixture
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" > "$ROOT/.swarmforge/roles.tsv"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT/.worktrees/coder" >> "$ROOT/.swarmforge/roles.tsv"
printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\ttask\n' "$ROOT/.worktrees/coder" >> "$ROOT/.swarmforge/roles.tsv"
printf 'architect\tarchitect\t%s\tswarmforge-architect\tArchitect\tclaude\ttask\n' "$ROOT/.worktrees/coder" >> "$ROOT/.swarmforge/roles.tsv"
printf 'QA\tQA\t%s\tswarmforge-QA\tQA\tclaude\ttask\n' "$ROOT/.worktrees/coder" >> "$ROOT/.swarmforge/roles.tsv"
# Deliberately no `rotation router` conf and no swarm-identity file: this is
# a classic pack, not mono-router.
KILL_LOG="$ROOT/kills"
: > "$KILL_LOG"
cat > "$FAKE_BIN/tmux" <<TMUXFAKE
#!/usr/bin/env bash
sock_cmd="\$3"
if [[ "\$sock_cmd" == "has-session" ]]; then
  target="\$5"
  [[ "\$target" == "swarmforge-architect" ]] && exit 1
  exit 0
fi
if [[ "\$sock_cmd" == "list-panes" ]]; then
  target="\$5"
  if [[ "\$target" == "swarmforge-architect" ]]; then
    exit 1
  fi
  echo "0"
  exit 0
fi
if [[ "\$sock_cmd" == "kill-session" ]]; then
  echo "KILL \$5" >> "$KILL_LOG"
  exit 0
fi
if [[ "\$sock_cmd" == "respawn-pane" ]]; then
  exit 0
fi
exit 0
TMUXFAKE
chmod +x "$FAKE_BIN/tmux"
OUTPUT=$(PATH="$FAKE_BIN:$PATH" \
  SWARMFORGE_ENSURE_EXTENSION_CHECK="$FAKE_BIN/fake_ext_check.sh" \
  SWARMFORGE_ENSURE_EXTENSION_BOUNCE="$FAKE_BIN/fake_ext_bounce.sh" \
  SWARMFORGE_ENSURE_SUPERVISOR="$FAKE_BIN/fake_supervisor.bb" \
  SWARMFORGE_SKIP_OPERATOR=1 SWARMFORGE_SKIP_FRONT_DESK=1 \
  bb "$ENSURE" "$ROOT" 2>&1) || true
echo "$OUTPUT" | grep -q 'DORMANT' && fail "classic pack must not classify any role as DORMANT, got: $OUTPUT"
if [[ -s "$KILL_LOG" ]]; then fail "classic half-launch must not kill any healthy session, got: $(cat "$KILL_LOG")"; fi
echo "$OUTPUT" | grep -q '^agent:coordinator: HEALTHY$' || fail "expected coordinator HEALTHY, got: $OUTPUT"
echo "$OUTPUT" | grep -q '^agent:cleaner: HEALTHY$' || fail "expected cleaner HEALTHY, got: $OUTPUT"
pass "classic pack with one half-launched session is not treated as mono-router (no kills, no DORMANT)"

# ---------------------------------------------------------------------------
# 08: an ensure repair for a dead agent pane passes provider auth through
# (BL-130 passthrough, lost when 7e2498634 stripped provider-respawn-env-args)
# ---------------------------------------------------------------------------
make_fixture
echo "1" > "$ROOT/pane_dead"
RESPAWN_ARGS_LOG="$ROOT/respawn-args"
cat > "$FAKE_BIN/tmux" <<EOF
#!/usr/bin/env bash
if [[ "\$3" == "list-panes" ]]; then
  cat "$ROOT/pane_dead"
  exit 0
fi
if [[ "\$3" == "respawn-pane" ]]; then
  echo "\$@" > "$RESPAWN_ARGS_LOG"
  echo "0" > "$ROOT/pane_dead"
  exit 0
fi
exit 0
EOF
chmod +x "$FAKE_BIN/tmux"
if OUT="$(OPENROUTER_API_KEY="test-router-key" run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^agent:coder: FIXED (respawned pane from its persisted launch script)$" \
  || fail "08: dead pane repair not reported as FIXED; got: $OUT"
grep -q -- "-e OPENROUTER_API_KEY=test-router-key" "$RESPAWN_ARGS_LOG" \
  || fail "08: ensure repair did not pass OPENROUTER_API_KEY through to the respawned pane; got: $(cat "$RESPAWN_ARGS_LOG")"
cleanup_daemon
pass "08: an ensure repair for a dead agent pane passes OPENROUTER_API_KEY through (BL-130)"

# ---------------------------------------------------------------------------
# 09: mono-router :teardown-illicit wiring — a dormant role with an illicit
#     standing session is torn down via kill-session!, and the post-kill
#     has-session recheck decides FIXED vs FAILED. mono_router_lib_test_runner.bb
#     already proves topology-action returns :teardown-illicit for this shape;
#     this proves ensure_mono_router_role!'s OWN wiring — the kill-session!
#     call and the FIXED/FAILED reclassify — since that wiring is new in this
#     parcel and untouched by any existing test_swarm_ensure.sh scenario.
# ---------------------------------------------------------------------------
make_fixture
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT/.worktrees/coder" > "$ROOT/.swarmforge/roles.tsv"
printf 'specifier\tspecifier\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$ROOT/.worktrees/coder" >> "$ROOT/.swarmforge/roles.tsv"
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"
printf 'rotation\trouter\n' > "$ROOT/.swarmforge/swarm-identity"
KILL_LOG="$ROOT/kills-09"
KILLED_FLAG="$ROOT/specifier-killed"
: > "$KILL_LOG"
rm -f "$KILLED_FLAG"
cat > "$FAKE_BIN/tmux" <<TMUXFAKE
#!/usr/bin/env bash
sock_cmd="\$3"
if [[ "\$sock_cmd" == "has-session" ]]; then
  target="\$5"
  case "\$target" in
    swarmforge-coder|swarmforge-coordinator) exit 0 ;;
    swarmforge-specifier) [[ -f "$KILLED_FLAG" ]] && exit 1 || exit 0 ;;
    *) exit 1 ;;
  esac
fi
if [[ "\$sock_cmd" == "list-panes" ]]; then
  echo "0"
  exit 0
fi
if [[ "\$sock_cmd" == "kill-session" ]]; then
  target="\$5"
  echo "KILL \$target" >> "$KILL_LOG"
  [[ "\$target" == "swarmforge-specifier" ]] && touch "$KILLED_FLAG"
  exit 0
fi
exit 0
TMUXFAKE
chmod +x "$FAKE_BIN/tmux"
OUTPUT=$(PATH="$FAKE_BIN:$PATH" \
  SWARMFORGE_ENSURE_EXTENSION_CHECK="$FAKE_BIN/fake_ext_check.sh" \
  SWARMFORGE_ENSURE_EXTENSION_BOUNCE="$FAKE_BIN/fake_ext_bounce.sh" \
  SWARMFORGE_ENSURE_SUPERVISOR="$FAKE_BIN/fake_supervisor.bb" \
  SWARMFORGE_SKIP_OPERATOR=1 SWARMFORGE_SKIP_FRONT_DESK=1 \
  bb "$ENSURE" "$ROOT" 2>&1) || true
grep -q "^KILL swarmforge-specifier$" "$KILL_LOG" \
  || fail "09a: illicit standing session for a dormant role was never torn down; kill log: $(cat "$KILL_LOG")"
echo "$OUTPUT" | grep -q "^agent:specifier: FIXED (tore down illicit standing session (mono-router dormant target))$" \
  || fail "09a: illicit dormant session teardown not reported as FIXED; got: $OUTPUT"
pass "09a: mono-router illicit standing session for a dormant role is torn down and reported FIXED"

# 09b: kill-session! that does not actually remove the session reports FAILED,
#      never a silent HEALTHY/FIXED that would hide a stuck teardown.
make_fixture
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT/.worktrees/coder" > "$ROOT/.swarmforge/roles.tsv"
printf 'specifier\tspecifier\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$ROOT/.worktrees/coder" >> "$ROOT/.swarmforge/roles.tsv"
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"
printf 'rotation\trouter\n' > "$ROOT/.swarmforge/swarm-identity"
KILL_LOG="$ROOT/kills-09b"
: > "$KILL_LOG"
cat > "$FAKE_BIN/tmux" <<TMUXFAKE
#!/usr/bin/env bash
sock_cmd="\$3"
if [[ "\$sock_cmd" == "has-session" ]]; then
  target="\$5"
  case "\$target" in
    swarmforge-coder|swarmforge-coordinator|swarmforge-specifier) exit 0 ;;
    *) exit 1 ;;
  esac
fi
if [[ "\$sock_cmd" == "list-panes" ]]; then
  echo "0"
  exit 0
fi
if [[ "\$sock_cmd" == "kill-session" ]]; then
  target="\$5"
  echo "KILL \$target" >> "$KILL_LOG"
  exit 0
fi
exit 0
TMUXFAKE
chmod +x "$FAKE_BIN/tmux"
OUTPUT=$(PATH="$FAKE_BIN:$PATH" \
  SWARMFORGE_ENSURE_EXTENSION_CHECK="$FAKE_BIN/fake_ext_check.sh" \
  SWARMFORGE_ENSURE_EXTENSION_BOUNCE="$FAKE_BIN/fake_ext_bounce.sh" \
  SWARMFORGE_ENSURE_SUPERVISOR="$FAKE_BIN/fake_supervisor.bb" \
  SWARMFORGE_SKIP_OPERATOR=1 SWARMFORGE_SKIP_FRONT_DESK=1 \
  bb "$ENSURE" "$ROOT" 2>&1) || true
RC=$?
grep -q "^KILL swarmforge-specifier$" "$KILL_LOG" \
  || fail "09b: kill-session was never attempted; kill log: $(cat "$KILL_LOG")"
echo "$OUTPUT" | grep -q "^agent:specifier: FAILED (could not tear down illicit standing session)$" \
  || fail "09b: a kill-session that leaves the session standing must report FAILED; got: $OUTPUT"
pass "09b: mono-router illicit session that survives kill-session! is reported FAILED, not silently accepted"

# ---------------------------------------------------------------------------
# 10: mono-router :ensure-standing wiring — the resident role's tmux session
#     has vanished entirely (not merely pane-dead), so ensure must create a
#     fresh session (create-session!) before respawning into it
#     (ensure-standing-role!), then report FIXED. Distinct from test 08's
#     dead-pane repair, where the session already exists and only the pane
#     needs respawning; this is the "session itself is gone" repair the
#     mono-router path adds and no existing test exercised.
# ---------------------------------------------------------------------------
make_fixture
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT/.worktrees/coder" > "$ROOT/.swarmforge/roles.tsv"
printf 'specifier\tspecifier\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$ROOT/.worktrees/coder" >> "$ROOT/.swarmforge/roles.tsv"
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"
printf 'rotation\trouter\n' > "$ROOT/.swarmforge/swarm-identity"
CODER_CREATED="$ROOT/coder-created"
CREATE_LOG="$ROOT/creates-10"
RESPAWN_LOG_10="$ROOT/respawns-10"
rm -f "$CODER_CREATED"
: > "$CREATE_LOG"
: > "$RESPAWN_LOG_10"
cat > "$FAKE_BIN/tmux" <<TMUXFAKE
#!/usr/bin/env bash
sock_cmd="\$3"
if [[ "\$sock_cmd" == "has-session" ]]; then
  target="\$5"
  case "\$target" in
    swarmforge-coder) [[ -f "$CODER_CREATED" ]] && exit 0 || exit 1 ;;
    swarmforge-coordinator) exit 0 ;;
    *) exit 1 ;;
  esac
fi
if [[ "\$sock_cmd" == "list-panes" ]]; then
  target="\$5"
  if [[ "\$target" == "swarmforge-coder" && ! -f "$CODER_CREATED" ]]; then
    exit 1
  fi
  echo "0"
  exit 0
fi
if [[ "\$sock_cmd" == "new-session" ]]; then
  target="\$6"
  echo "CREATE \$target" >> "$CREATE_LOG"
  [[ "\$target" == "swarmforge-coder" ]] && touch "$CODER_CREATED"
  exit 0
fi
if [[ "\$sock_cmd" == "respawn-pane" ]]; then
  echo "RESPAWN" >> "$RESPAWN_LOG_10"
  exit 0
fi
exit 0
TMUXFAKE
chmod +x "$FAKE_BIN/tmux"
OUTPUT=$(PATH="$FAKE_BIN:$PATH" \
  SWARMFORGE_ENSURE_EXTENSION_CHECK="$FAKE_BIN/fake_ext_check.sh" \
  SWARMFORGE_ENSURE_EXTENSION_BOUNCE="$FAKE_BIN/fake_ext_bounce.sh" \
  SWARMFORGE_ENSURE_SUPERVISOR="$FAKE_BIN/fake_supervisor.bb" \
  SWARMFORGE_SKIP_OPERATOR=1 SWARMFORGE_SKIP_FRONT_DESK=1 \
  bb "$ENSURE" "$ROOT" 2>&1) || true
grep -q "^CREATE swarmforge-coder$" "$CREATE_LOG" \
  || fail "10: a fully-vanished resident session was never recreated; create log: $(cat "$CREATE_LOG")"
[[ -s "$RESPAWN_LOG_10" ]] \
  || fail "10: the recreated resident session was never respawned into"
echo "$OUTPUT" | grep -q "^agent:coder: FIXED (restored mono-router resident pane)$" \
  || fail "10: a recreated resident session was not reported FIXED; got: $OUTPUT"
pass "10: mono-router resident session that has vanished entirely is recreated and respawned, reported FIXED"

# ---------------------------------------------------------------------------
# BL-514: remote-control (RC) component wiring — rc:<role> alongside
# agent:<role>, right after it in the report. SWARM_ENSURE_RC_CMDLINE_CMD is
# the injectable seam (mirrors the file's own SWARM_ENSURE_*_CMD idiom) since
# the real probe reads /proc/<pid>/cmdline, which this dev/test host (macOS)
# does not provide.
# ---------------------------------------------------------------------------

# ── RC-1: healthy RC (live process carries the expected flag) ──────────────
make_fixture
printf 'exec claude --remote-control SwarmForge-Coder\n' > "$ROOT/.swarmforge/launch/coder.sh"
RC_RESPAWNS="$ROOT/rc-respawns-1"
: > "$RC_RESPAWNS"
cat > "$FAKE_BIN/tmux" <<EOF
#!/usr/bin/env bash
if [[ "\$3" == "list-panes" ]]; then
  cat "$ROOT/pane_dead"
  exit 0
fi
if [[ "\$3" == "respawn-pane" ]]; then
  echo "RESPAWN" >> "$RC_RESPAWNS"
  echo "0" > "$ROOT/pane_dead"
  exit 0
fi
exit 0
EOF
chmod +x "$FAKE_BIN/tmux"
cat > "$FAKE_BIN/rc_cmdline_1.sh" <<'EOF'
#!/usr/bin/env bash
echo "claude --remote-control SwarmForge-Coder"
EOF
chmod +x "$FAKE_BIN/rc_cmdline_1.sh"
if OUT="$(SWARM_ENSURE_RC_CMDLINE_CMD="$FAKE_BIN/rc_cmdline_1.sh" run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^rc:coder: HEALTHY$" \
  || fail "RC-1: a matching --remote-control flag was not reported HEALTHY; got: $OUT"
[[ -s "$RC_RESPAWNS" ]] && fail "RC-1: a healthy RC state triggered an unnecessary respawn"
[[ "$RC" -eq 0 ]] || fail "RC-1: exit status was $RC, expected 0"
cleanup_daemon
pass "RC-1 (BL-514): rc:coder reports HEALTHY when the live process carries the expected --remote-control flag, no repair"

# ── RC-2: degraded RC (flag lost) is repaired and reclassified HEALTHY -> FIXED
make_fixture
printf 'exec claude --remote-control SwarmForge-Coder\n' > "$ROOT/.swarmforge/launch/coder.sh"
RC_RESTORED="$ROOT/rc-restored-2"
RC_RESPAWNS="$ROOT/rc-respawns-2"
echo "0" > "$RC_RESTORED"
: > "$RC_RESPAWNS"
cat > "$FAKE_BIN/tmux" <<EOF
#!/usr/bin/env bash
if [[ "\$3" == "list-panes" ]]; then
  cat "$ROOT/pane_dead"
  exit 0
fi
if [[ "\$3" == "respawn-pane" ]]; then
  echo "RESPAWN" >> "$RC_RESPAWNS"
  echo "1" > "$RC_RESTORED"
  echo "0" > "$ROOT/pane_dead"
  exit 0
fi
exit 0
EOF
chmod +x "$FAKE_BIN/tmux"
cat > "$FAKE_BIN/rc_cmdline_2.sh" <<EOF
#!/usr/bin/env bash
if [[ "\$(cat "$RC_RESTORED")" == "1" ]]; then
  echo "claude --remote-control SwarmForge-Coder"
else
  echo "claude --remote-control SwarmForge-Stale"
fi
EOF
chmod +x "$FAKE_BIN/rc_cmdline_2.sh"
if OUT="$(SWARM_ENSURE_RC_CMDLINE_CMD="$FAKE_BIN/rc_cmdline_2.sh" run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^rc:coder: FIXED (respawned pane to restore --remote-control flag)$" \
  || fail "RC-2: a degraded RC (flag lost) was not repaired and reported FIXED; got: $OUT"
[[ -s "$RC_RESPAWNS" ]] || fail "RC-2: rc:coder FIXED was reported without actually respawning the pane"
cleanup_daemon
pass "RC-2 (BL-514): rc:coder reports FIXED after respawning a degraded pane and reclassifying healthy"

# ── RC-3: degraded RC whose repair does NOT restore the flag -> FAILED ─────
make_fixture
printf 'exec claude --remote-control SwarmForge-Coder\n' > "$ROOT/.swarmforge/launch/coder.sh"
RC_RESPAWNS="$ROOT/rc-respawns-3"
: > "$RC_RESPAWNS"
cat > "$FAKE_BIN/tmux" <<EOF
#!/usr/bin/env bash
if [[ "\$3" == "list-panes" ]]; then
  cat "$ROOT/pane_dead"
  exit 0
fi
if [[ "\$3" == "respawn-pane" ]]; then
  echo "RESPAWN" >> "$RC_RESPAWNS"
  echo "0" > "$ROOT/pane_dead"
  exit 0
fi
exit 0
EOF
chmod +x "$FAKE_BIN/tmux"
cat > "$FAKE_BIN/rc_cmdline_3.sh" <<'EOF'
#!/usr/bin/env bash
echo "claude --remote-control SwarmForge-StillStale"
EOF
chmod +x "$FAKE_BIN/rc_cmdline_3.sh"
if OUT="$(SWARM_ENSURE_RC_CMDLINE_CMD="$FAKE_BIN/rc_cmdline_3.sh" run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^rc:coder: FAILED (respawned pane to restore --remote-control flag)$" \
  || fail "RC-3: a repair that does not restore the flag was not reported FAILED; got: $OUT"
[[ -s "$RC_RESPAWNS" ]] || fail "RC-3: rc:coder FAILED was reported without ever attempting a repair"
[[ "$RC" -ne 0 ]] || fail "RC-3: exit status was 0, expected non-zero after an rc FAILED"
cleanup_daemon
pass "RC-3 (BL-514): rc:coder reports FAILED when respawning does not restore the --remote-control flag"

# ── RC-4: no live claude process (:down) is left entirely to agent:<role>,
#          never double-respawned by the RC check ──────────────────────────
make_fixture
printf 'exec claude --remote-control SwarmForge-Coder\n' > "$ROOT/.swarmforge/launch/coder.sh"
RC_RESPAWNS="$ROOT/rc-respawns-4"
: > "$RC_RESPAWNS"
cat > "$FAKE_BIN/tmux" <<EOF
#!/usr/bin/env bash
if [[ "\$3" == "list-panes" ]]; then
  cat "$ROOT/pane_dead"
  exit 0
fi
if [[ "\$3" == "respawn-pane" ]]; then
  echo "RESPAWN" >> "$RC_RESPAWNS"
  echo "0" > "$ROOT/pane_dead"
  exit 0
fi
exit 0
EOF
chmod +x "$FAKE_BIN/tmux"
cat > "$FAKE_BIN/rc_cmdline_4.sh" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$FAKE_BIN/rc_cmdline_4.sh"
if OUT="$(SWARM_ENSURE_RC_CMDLINE_CMD="$FAKE_BIN/rc_cmdline_4.sh" run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^rc:coder: HEALTHY$" \
  || fail "RC-4: no live claude process (:down) was not left HEALTHY/no-action at the RC level; got: $OUT"
echo "$OUT" | grep -q "^agent:coder: HEALTHY$" \
  || fail "RC-4: agent:coder pane was disturbed by the RC :down case; got: $OUT"
[[ -s "$RC_RESPAWNS" ]] && fail "RC-4: RC check respawned a pane on :down - that is agent:<role>'s job, never RC's"
[[ "$RC" -eq 0 ]] || fail "RC-4: exit status was $RC, expected 0"
cleanup_daemon
pass "RC-4 (BL-514): rc:coder takes no action on :down, never double-respawning a pane the agent check already owns"

# ── RC-5: rc:<role> is reported immediately after its own agent:<role> line ─
make_fixture
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
AGENT_LINE="$(echo "$OUT" | grep -n '^agent:coder:' | head -1 | cut -d: -f1)"
RC_LINE="$(echo "$OUT" | grep -n '^rc:coder:' | head -1 | cut -d: -f1)"
[[ -n "$AGENT_LINE" && -n "$RC_LINE" ]] || fail "RC-5: missing agent:coder or rc:coder line; got: $OUT"
[[ "$RC_LINE" -eq $((AGENT_LINE + 1)) ]] \
  || fail "RC-5: rc:coder did not immediately follow agent:coder; got: $OUT"
cleanup_daemon
pass "RC-5 (BL-514): rc:<role> is reported immediately after its own agent:<role> pane check"

# ── RC-6: launch script declares no --remote-control flag at all -> HEALTHY,
#          and the live process is never probed (ensure-rc-role!'s
#          expected-rc-name nil short-circuit, checked BEFORE rc-status is
#          ever called) ────────────────────────────────────────────────────
make_fixture
printf 'exec claude --dangerously-skip-permissions\n' > "$ROOT/.swarmforge/launch/coder.sh"
RC6_PROBED="$ROOT/rc6-probed"
cat > "$FAKE_BIN/rc_cmdline_6.sh" <<EOF
#!/usr/bin/env bash
touch "$RC6_PROBED"
echo "claude --remote-control SwarmForge-Coder"
EOF
chmod +x "$FAKE_BIN/rc_cmdline_6.sh"
if OUT="$(SWARM_ENSURE_RC_CMDLINE_CMD="$FAKE_BIN/rc_cmdline_6.sh" run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^rc:coder: HEALTHY$" \
  || fail "RC-6: a launch script declaring no --remote-control flag was not reported HEALTHY; got: $OUT"
[[ -e "$RC6_PROBED" ]] \
  && fail "RC-6: the live process was probed despite the launch script declaring no --remote-control flag"
[[ "$RC" -eq 0 ]] || fail "RC-6: exit status was $RC, expected 0"
cleanup_daemon
pass "RC-6 (BL-514): a launch script declaring no --remote-control flag reports HEALTHY without ever probing the live process"

# ---------------------------------------------------------------------------
# RC-7 (BL-514): mono-router resident rotated onto a different role's launch
# script must not be misclassified as RC-degraded and forcibly respawned back
# to home - rc-launch-role must resolve against the ACTIVE role's launch
# script, mirroring ensure-mono-router-role!'s own launch-role resolution.
# Without this, every ensure while rotated to a non-home role would wrongly
# see a "flag mismatch" and stomp the resident back onto `coder`.
# ---------------------------------------------------------------------------
make_fixture
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$ROOT/.worktrees/coder" > "$ROOT/.swarmforge/roles.tsv"
printf 'specifier\tspecifier\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$ROOT/.worktrees/coder" >> "$ROOT/.swarmforge/roles.tsv"
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" >> "$ROOT/.swarmforge/roles.tsv"
printf 'rotation\trouter\n' > "$ROOT/.swarmforge/swarm-identity"
printf 'exec claude --remote-control SwarmForge-Coder\n' > "$ROOT/.swarmforge/launch/coder.sh"
printf 'exec claude --remote-control SwarmForge-Specifier\n' > "$ROOT/.swarmforge/launch/specifier.sh"
echo "specifier" > "$ROOT/.swarmforge/mono-router-active-role"
RC7_RESPAWNS="$ROOT/rc7-respawns"
: > "$RC7_RESPAWNS"
cat > "$FAKE_BIN/tmux" <<TMUXFAKE
#!/usr/bin/env bash
sock_cmd="\$3"
if [[ "\$sock_cmd" == "has-session" ]]; then
  target="\$5"
  case "\$target" in
    swarmforge-coder|swarmforge-coordinator) exit 0 ;;
    *) exit 1 ;;
  esac
fi
if [[ "\$sock_cmd" == "list-panes" ]]; then
  echo "0"
  exit 0
fi
if [[ "\$sock_cmd" == "respawn-pane" ]]; then
  echo "RESPAWN \$@" >> "$RC7_RESPAWNS"
  exit 0
fi
exit 0
TMUXFAKE
chmod +x "$FAKE_BIN/tmux"
cat > "$FAKE_BIN/rc7_cmdline.sh" <<'EOF'
#!/usr/bin/env bash
case "$2" in
  swarmforge-coder) echo "claude --remote-control SwarmForge-Specifier" ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$FAKE_BIN/rc7_cmdline.sh"
OUTPUT=$(PATH="$FAKE_BIN:$PATH" \
  SWARM_ENSURE_RC_CMDLINE_CMD="$FAKE_BIN/rc7_cmdline.sh" \
  SWARM_ENSURE_EXTENSION_CHECK_CMD="$FAKE_BIN/fake_ext_check.sh" \
  SWARM_ENSURE_EXTENSION_BOUNCE_CMD="$FAKE_BIN/fake_ext_bounce.sh" \
  SWARM_ENSURE_SUPERVISOR_CMD="$FAKE_BIN/fake_daemon_start.sh" \
  SWARMFORGE_SKIP_OPERATOR=1 SWARMFORGE_SKIP_FRONT_DESK=1 \
  bb "$ENSURE" "$ROOT" 2>&1) || true
echo "$OUTPUT" | grep -q "^rc:coder: HEALTHY$" \
  || fail "RC-7: rotated resident's RC was not read against its ACTIVE role's launch script; got: $OUTPUT"
[[ -s "$RC7_RESPAWNS" ]] \
  && fail "RC-7: rc check forcibly respawned a legitimately-rotated resident; respawns: $(cat "$RC7_RESPAWNS")"
cleanup_daemon
pass "RC-7 (BL-514): mono-router RC check follows a rotated resident's active launch script, never forces it back to home"

# ---------------------------------------------------------------------------
# BL-898: session-dead (flag present, cloud session dead) - detection is
# persistent (RC-10), repair is idle-safe (RC-8/RC-9), and the human is
# always told the outcome (RC-8's notify assertion).
# ---------------------------------------------------------------------------

# ── RC-8: a persistently /rc-failed session on an IDLE agent is respawned
#          idle-safely, reclassified healthy, reported FIXED with the new
#          session URL, and the human is notified ─────────────────────────
make_fixture
printf 'exec claude --remote-control SwarmForge-Coder\n' > "$ROOT/.swarmforge/launch/coder.sh"
mkdir -p "$ROOT/.swarmforge/rc-footer-streak"
echo "1" > "$ROOT/.swarmforge/rc-footer-streak/coder"
RC8_RESPAWNS="$ROOT/rc8-respawns"
RC8_RESTORED="$ROOT/rc8-restored"
RC8_NOTIFY="$ROOT/rc8-notify"
: > "$RC8_RESPAWNS"
echo "0" > "$RC8_RESTORED"
: > "$RC8_NOTIFY"
cat > "$FAKE_BIN/tmux" <<EOF
#!/usr/bin/env bash
if [[ "\$3" == "list-panes" ]]; then
  cat "$ROOT/pane_dead"
  exit 0
fi
if [[ "\$3" == "respawn-pane" ]]; then
  echo "RESPAWN" >> "$RC8_RESPAWNS"
  echo "1" > "$RC8_RESTORED"
  echo "0" > "$ROOT/pane_dead"
  exit 0
fi
if [[ "\$3" == "capture-pane" ]]; then
  if [[ "\$(cat "$RC8_RESTORED")" == "1" ]]; then
    printf 'bypass permissions on (shift+tab to cycle)  /rc\nhttps://claude.ai/code/session_rc8new\n'
  else
    printf 'bypass permissions on (shift+tab to cycle)  /rc failed\n'
  fi
  exit 0
fi
exit 0
EOF
chmod +x "$FAKE_BIN/tmux"
cat > "$FAKE_BIN/rc_cmdline_8.sh" <<'EOF'
#!/usr/bin/env bash
echo "claude --remote-control SwarmForge-Coder"
EOF
chmod +x "$FAKE_BIN/rc_cmdline_8.sh"
cat > "$FAKE_BIN/rc_notify_8.sh" <<EOF
#!/usr/bin/env bash
echo "\$1 \$2" >> "$RC8_NOTIFY"
EOF
chmod +x "$FAKE_BIN/rc_notify_8.sh"
if OUT="$(SWARM_ENSURE_RC_CMDLINE_CMD="$FAKE_BIN/rc_cmdline_8.sh" \
  SWARM_ENSURE_RC_NOTIFY_CMD="$FAKE_BIN/rc_notify_8.sh" \
  run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^rc:coder: FIXED (respawned pane to restore a dead remote-control session - new session: https://claude.ai/code/session_rc8new)$" \
  || fail "RC-8: a persistently session-dead role was not repaired and reported FIXED with the new session url; got: $OUT"
[[ -s "$RC8_RESPAWNS" ]] || fail "RC-8: session-dead repair never actually respawned the idle pane"
[[ -s "$RC8_NOTIFY" ]]   || fail "RC-8: session-dead repair never notified the human of the outcome"
grep -q "coder https://claude.ai/code/session_rc8new" "$RC8_NOTIFY" \
  || fail "RC-8: notify was not called with the role and the new session url; got: $(cat "$RC8_NOTIFY")"
[[ "$RC" -eq 0 ]] || fail "RC-8: exit status was $RC, expected 0"
cleanup_daemon
pass "RC-8 (BL-898): a persistently /rc-failed session (flag present) on an idle agent is repaired idle-safely, reported FIXED with the new session URL, and the human is notified"

# ── RC-9: a session-dead agent that stays BUSY past the wait budget is left
#          running and reported unrepaired - never respawned mid-turn ──────
make_fixture
printf 'exec claude --remote-control SwarmForge-Coder\n' > "$ROOT/.swarmforge/launch/coder.sh"
mkdir -p "$ROOT/.swarmforge/rc-footer-streak"
echo "1" > "$ROOT/.swarmforge/rc-footer-streak/coder"
RC9_RESPAWNS="$ROOT/rc9-respawns"
: > "$RC9_RESPAWNS"
cat > "$FAKE_BIN/tmux" <<EOF
#!/usr/bin/env bash
if [[ "\$3" == "list-panes" ]]; then
  cat "$ROOT/pane_dead"
  exit 0
fi
if [[ "\$3" == "respawn-pane" ]]; then
  echo "RESPAWN" >> "$RC9_RESPAWNS"
  exit 0
fi
if [[ "\$3" == "capture-pane" ]]; then
  printf 'esc to interrupt\nbypass permissions on (shift+tab to cycle)  /rc failed\n'
  exit 0
fi
exit 0
EOF
chmod +x "$FAKE_BIN/tmux"
cat > "$FAKE_BIN/rc_cmdline_9.sh" <<'EOF'
#!/usr/bin/env bash
echo "claude --remote-control SwarmForge-Coder"
EOF
chmod +x "$FAKE_BIN/rc_cmdline_9.sh"
if OUT="$(SWARM_ENSURE_RC_CMDLINE_CMD="$FAKE_BIN/rc_cmdline_9.sh" \
  SWARM_ENSURE_RC_SESSION_DEAD_WAIT_SECONDS=1 \
  run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^rc:coder: FAILED (agent still busy after 1s wait budget - respawn skipped, not killed (never mid-turn))$" \
  || fail "RC-9: a persistently-busy session-dead agent was not reported FAILED/unrepaired; got: $OUT"
[[ -s "$RC9_RESPAWNS" ]] && fail "RC-9: a busy agent must NEVER be respawned mid-turn (invariant 1)"
[[ "$RC" -ne 0 ]] || fail "RC-9: exit status was 0, expected non-zero after a FAILED session-dead repair"
cleanup_daemon
pass "RC-9 (BL-898): a session-dead agent that stays busy past the wait budget is left running and reported unrepaired, never killed mid-turn"

# ── RC-10: ONE failed-footer observation is persisted but never actionable
#           on its own - repair needs a SECOND consecutive sweep ──────────
make_fixture
printf 'exec claude --remote-control SwarmForge-Coder\n' > "$ROOT/.swarmforge/launch/coder.sh"
RC10_RESPAWNS="$ROOT/rc10-respawns"
: > "$RC10_RESPAWNS"
cat > "$FAKE_BIN/tmux" <<EOF
#!/usr/bin/env bash
if [[ "\$3" == "list-panes" ]]; then
  cat "$ROOT/pane_dead"
  exit 0
fi
if [[ "\$3" == "respawn-pane" ]]; then
  echo "RESPAWN" >> "$RC10_RESPAWNS"
  exit 0
fi
if [[ "\$3" == "capture-pane" ]]; then
  printf 'bypass permissions on (shift+tab to cycle)  /rc failed\n'
  exit 0
fi
exit 0
EOF
chmod +x "$FAKE_BIN/tmux"
cat > "$FAKE_BIN/rc_cmdline_10.sh" <<'EOF'
#!/usr/bin/env bash
echo "claude --remote-control SwarmForge-Coder"
EOF
chmod +x "$FAKE_BIN/rc_cmdline_10.sh"
if OUT="$(SWARM_ENSURE_RC_CMDLINE_CMD="$FAKE_BIN/rc_cmdline_10.sh" run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^rc:coder: HEALTHY$" \
  || fail "RC-10: a single failed-footer observation must not yet be treated as session-dead; got: $OUT"
[[ -s "$RC10_RESPAWNS" ]] && fail "RC-10: a single failed-footer observation must never trigger a respawn"
[[ "$RC" -eq 0 ]] || fail "RC-10: exit status was $RC, expected 0"
[[ "$(cat "$ROOT/.swarmforge/rc-footer-streak/coder")" == "1" ]] \
  || fail "RC-10: the footer-failure streak was not persisted to 1 for the next sweep to see"
cleanup_daemon
pass "RC-10 (BL-898): a single /rc-failed observation is persisted but never actionable alone - persistence requires a second consecutive sweep"

# ── RC-11: a working footer, even carrying a stale streak from just before a
#           repair, reports HEALTHY, never respawns, and resets the streak ──
make_fixture
printf 'exec claude --remote-control SwarmForge-Coder\n' > "$ROOT/.swarmforge/launch/coder.sh"
mkdir -p "$ROOT/.swarmforge/rc-footer-streak"
echo "2" > "$ROOT/.swarmforge/rc-footer-streak/coder"
RC11_RESPAWNS="$ROOT/rc11-respawns"
: > "$RC11_RESPAWNS"
cat > "$FAKE_BIN/tmux" <<EOF
#!/usr/bin/env bash
if [[ "\$3" == "list-panes" ]]; then
  cat "$ROOT/pane_dead"
  exit 0
fi
if [[ "\$3" == "respawn-pane" ]]; then
  echo "RESPAWN" >> "$RC11_RESPAWNS"
  exit 0
fi
if [[ "\$3" == "capture-pane" ]]; then
  printf 'bypass permissions on (shift+tab to cycle)  /rc\n'
  exit 0
fi
exit 0
EOF
chmod +x "$FAKE_BIN/tmux"
cat > "$FAKE_BIN/rc_cmdline_11.sh" <<'EOF'
#!/usr/bin/env bash
echo "claude --remote-control SwarmForge-Coder"
EOF
chmod +x "$FAKE_BIN/rc_cmdline_11.sh"
if OUT="$(SWARM_ENSURE_RC_CMDLINE_CMD="$FAKE_BIN/rc_cmdline_11.sh" run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^rc:coder: HEALTHY$" \
  || fail "RC-11: a working footer must report HEALTHY even with a stale streak from before a prior repair; got: $OUT"
[[ -s "$RC11_RESPAWNS" ]] && fail "RC-11: a working footer must never respawn, regardless of a stale streak"
[[ "$(cat "$ROOT/.swarmforge/rc-footer-streak/coder")" == "0" ]] \
  || fail "RC-11: a working footer must reset the persisted streak so it cannot re-trigger later"
[[ "$RC" -eq 0 ]] || fail "RC-11: exit status was $RC, expected 0"
cleanup_daemon
pass "RC-11 (BL-898): a working footer since a repair on the last sweep stays HEALTHY and resets any stale streak"

# ── RC-12: a session-dead repair that restores the flag but cannot read a
#           new session URL still tells the human, with an explicit
#           not-readable statement, never a fabricated URL ─────────────────
make_fixture
printf 'exec claude --remote-control SwarmForge-Coder\n' > "$ROOT/.swarmforge/launch/coder.sh"
mkdir -p "$ROOT/.swarmforge/rc-footer-streak"
echo "1" > "$ROOT/.swarmforge/rc-footer-streak/coder"
RC12_RESPAWNS="$ROOT/rc12-respawns"
RC12_NOTIFY="$ROOT/rc12-notify"
: > "$RC12_RESPAWNS"
: > "$RC12_NOTIFY"
cat > "$FAKE_BIN/tmux" <<EOF
#!/usr/bin/env bash
if [[ "\$3" == "list-panes" ]]; then
  cat "$ROOT/pane_dead"
  exit 0
fi
if [[ "\$3" == "respawn-pane" ]]; then
  echo "RESPAWN" >> "$RC12_RESPAWNS"
  echo "0" > "$ROOT/pane_dead"
  exit 0
fi
if [[ "\$3" == "capture-pane" ]]; then
  printf 'bypass permissions on (shift+tab to cycle)  /rc failed\n'
  exit 0
fi
exit 0
EOF
chmod +x "$FAKE_BIN/tmux"
cat > "$FAKE_BIN/rc_cmdline_12.sh" <<'EOF'
#!/usr/bin/env bash
echo "claude --remote-control SwarmForge-Coder"
EOF
chmod +x "$FAKE_BIN/rc_cmdline_12.sh"
cat > "$FAKE_BIN/rc_notify_12.sh" <<EOF
#!/usr/bin/env bash
printf '%s|%s|%s\n' "\$1" "\$2" "\$3" >> "$RC12_NOTIFY"
EOF
chmod +x "$FAKE_BIN/rc_notify_12.sh"
if OUT="$(SWARM_ENSURE_RC_CMDLINE_CMD="$FAKE_BIN/rc_cmdline_12.sh" \
  SWARM_ENSURE_RC_NOTIFY_CMD="$FAKE_BIN/rc_notify_12.sh" \
  run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^rc:coder: FIXED (respawned pane to restore a dead remote-control session (new session address not yet readable))$" \
  || fail "RC-12: a repair confirming the flag but with no readable URL was not reported FIXED with the not-yet-readable note; got: $OUT"
[[ -s "$RC12_RESPAWNS" ]] || fail "RC-12: repair never actually respawned the pane"
[[ -s "$RC12_NOTIFY" ]]   || fail "RC-12: the human was never notified of the repair outcome"
NOTIFY_LINE="$(cat "$RC12_NOTIFY")"
echo "$NOTIFY_LINE" | grep -q "^coder|" \
  || fail "RC-12: notify was not called with the correct role; got: $NOTIFY_LINE"
echo "$NOTIFY_LINE" | grep -q "https://" \
  && fail "RC-12: notify must never fabricate a session URL when none was readable; got: $NOTIFY_LINE"
echo "$NOTIFY_LINE" | grep -q "could not be read" \
  || fail "RC-12: notify text must explicitly state the address could not be read; got: $NOTIFY_LINE"
cleanup_daemon
pass "RC-12 (BL-898): a repair with no readable new session URL still notifies the human with an explicit not-readable statement, never a fabricated URL"

# ── RC-13: a session-dead respawn that does NOT restore the flag is reported
#           FAILED and must NEVER send an active notify claiming a repair
#           that did not actually happen ────────────────────────────────────
make_fixture
printf 'exec claude --remote-control SwarmForge-Coder\n' > "$ROOT/.swarmforge/launch/coder.sh"
mkdir -p "$ROOT/.swarmforge/rc-footer-streak"
echo "1" > "$ROOT/.swarmforge/rc-footer-streak/coder"
RC13_RESPAWNS="$ROOT/rc13-respawns"
RC13_NOTIFY="$ROOT/rc13-notify"
RC13_RESPAWNED="$ROOT/rc13-respawned"
: > "$RC13_RESPAWNS"
: > "$RC13_NOTIFY"
echo "0" > "$RC13_RESPAWNED"
cat > "$FAKE_BIN/tmux" <<EOF
#!/usr/bin/env bash
if [[ "\$3" == "list-panes" ]]; then
  cat "$ROOT/pane_dead"
  exit 0
fi
if [[ "\$3" == "respawn-pane" ]]; then
  echo "RESPAWN" >> "$RC13_RESPAWNS"
  echo "1" > "$RC13_RESPAWNED"
  exit 0
fi
if [[ "\$3" == "capture-pane" ]]; then
  printf 'bypass permissions on (shift+tab to cycle)  /rc failed\n'
  exit 0
fi
exit 0
EOF
chmod +x "$FAKE_BIN/tmux"
# Flag MATCHES before the respawn (so the sweep genuinely classifies
# :session-dead off the persisted footer streak, not :degraded) and goes
# WRONG only after it - the respawn attempt itself is what fails to
# restore the session, which is what RC-13 needs to exercise.
cat > "$FAKE_BIN/rc_cmdline_13.sh" <<EOF
#!/usr/bin/env bash
if [[ "\$(cat "$RC13_RESPAWNED" 2>/dev/null)" == "1" ]]; then
  echo "claude --remote-control SwarmForge-StillStale"
else
  echo "claude --remote-control SwarmForge-Coder"
fi
EOF
chmod +x "$FAKE_BIN/rc_cmdline_13.sh"
cat > "$FAKE_BIN/rc_notify_13.sh" <<EOF
#!/usr/bin/env bash
echo "CALLED" >> "$RC13_NOTIFY"
EOF
chmod +x "$FAKE_BIN/rc_notify_13.sh"
if OUT="$(SWARM_ENSURE_RC_CMDLINE_CMD="$FAKE_BIN/rc_cmdline_13.sh" \
  SWARM_ENSURE_RC_NOTIFY_CMD="$FAKE_BIN/rc_notify_13.sh" \
  run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^rc:coder: FAILED (respawned pane but the --remote-control flag was not restored)$" \
  || fail "RC-13: a session-dead respawn that never restores the flag was not reported FAILED; got: $OUT"
[[ -s "$RC13_RESPAWNS" ]] || fail "RC-13: the repair never actually attempted a respawn"
[[ -s "$RC13_NOTIFY" ]] \
  && fail "RC-13: notify must NEVER fire for a repair that did not actually restore the session"
[[ "$RC" -ne 0 ]] || fail "RC-13: exit status was 0, expected non-zero after a FAILED session-dead repair"
cleanup_daemon
pass "RC-13 (BL-898): a session-dead respawn that fails to restore the flag is reported FAILED and never sends a notify claiming a repair that did not happen"

echo "ALL PASS"
