#!/usr/bin/env bash
# BL-145: `./swarm ensure` brings the swarm (extension host, every configured
# agent pane, the daemon) to a known-good state in one idempotent command.
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
  ROOT="$(cd "$(mktemp -d)" && pwd -P)"
  mkdir -p "$ROOT/.swarmforge/daemon" "$ROOT/.swarmforge/launch" "$ROOT/.worktrees/coder"
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
}

run_ensure() {
  SWARM_ENSURE_EXTENSION_CHECK_CMD="$FAKE_BIN/fake_ext_check.sh" \
  SWARM_ENSURE_EXTENSION_BOUNCE_CMD="$FAKE_BIN/fake_ext_bounce.sh" \
  SWARM_ENSURE_SUPERVISOR_CMD="bb $FAKE_BIN/fake_supervisor.bb" \
  PATH="$FAKE_BIN:$PATH" bb "$ENSURE" "$ROOT"
}

cleanup_daemon() {
  local pid
  pid="$(cat "$ROOT/.swarmforge/daemon/handoffd.pid" 2>/dev/null || true)"
  # The "already healthy" fixture records this test script's OWN pid as a
  # stand-in tracked daemon (it just needs to be alive, not a real daemon) -
  # never kill it.
  if [[ -n "$pid" && "$pid" != "$$" ]]; then
    kill -9 "$pid" 2>/dev/null || true
  fi
}

trap 'cleanup_daemon; rm -rf "${ROOT:-}"' EXIT

# ── 01: healthy swarm is a fast no-op, all HEALTHY, exit 0 ──────────────────
make_fixture
if OUT="$(run_ensure)"; then RC=0; else RC=$?; fi
echo "$OUT" | grep -q "^extension: HEALTHY$" || fail "01: extension not reported HEALTHY"
echo "$OUT" | grep -q "^agent:coder: HEALTHY$" || fail "01: agent pane not reported HEALTHY"
echo "$OUT" | grep -q "^daemon: HEALTHY$" || fail "01: daemon not reported HEALTHY"
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

echo "ALL PASS"
