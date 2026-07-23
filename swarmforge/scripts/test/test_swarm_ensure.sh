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
  unset TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID TELEGRAM_PRINCIPAL_USER_ID || true

  ROOT="$(cd "$(mktemp -d)" && pwd -P)"
  mkdir -p "$ROOT/.swarmforge/daemon" "$ROOT/.swarmforge/operator" \
           "$ROOT/.swarmforge/launch" "$ROOT/.worktrees/coder"
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
  # A daemon repair must actually leave a live process behind: redirect its
  # stdio to real files, not :inherit/pipes - a piped/inherited stream here
  # gets torn down along with the invoking process (discovered empirically:
  # an :inherit-stdio child does not survive its spawning bb script's own
  # exit, whereas one redirected to real out/err files does).
  cat > "$FAKE_BIN/fake_supervisor.bb" <<EOF
#!/usr/bin/env bb
(require '[babashka.process :as process]
         '[babashka.fs :as fs])
(def p (process/process ["sleep" "100"]
                         {:out :append :out-file (fs/file "$ROOT/fake-daemon.log")
                          :err :append :err-file (fs/file "$ROOT/fake-daemon.log")}))
(spit "$ROOT/.swarmforge/daemon/handoffd.pid" (str (.pid (:proc p))))
EOF
  chmod +x "$FAKE_BIN/fake_supervisor.bb"

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
}

run_ensure() {
  SWARM_ENSURE_EXTENSION_CHECK_CMD="$FAKE_BIN/fake_ext_check.sh" \
  SWARM_ENSURE_EXTENSION_BOUNCE_CMD="$FAKE_BIN/fake_ext_bounce.sh" \
  SWARM_ENSURE_SUPERVISOR_CMD="bb $FAKE_BIN/fake_supervisor.bb" \
  SWARM_ENSURE_OPERATOR_CMD="$FAKE_BIN/fake_operator_start.sh" \
  SWARM_ENSURE_FRONT_DESK_CMD="$FAKE_BIN/fake_front_desk_start.sh" \
  PATH="$FAKE_BIN:$PATH" bb "$ENSURE" "$ROOT"
}

cleanup_daemon() {
  local pid
  # The "already healthy" fixture records this test script's OWN pid as a
  # stand-in tracked process (it just needs to be alive, not a real daemon) -
  # never kill it.
  for pid_file in \
      "$ROOT/.swarmforge/daemon/handoffd.pid" \
      "$ROOT/.swarmforge/operator/runtime.pid" \
      "$ROOT/.swarmforge/operator/front-desk-supervisor.pid"; do
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

echo "ALL PASS"
