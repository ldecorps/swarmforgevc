#!/usr/bin/env bash
# BL-976 leg 1: start_handoff_daemon.sh re-sources the operator's env file
# (.swarmforge/operator/daemon.env) into the launch environment when it
# exists, so a daemon generation relaunched from a keyless shell inherits
# RESEND_API_KEY - and degrades to ambient-env-only when the file is absent.
# Drives the REAL launch script against a scratch WORKING_DIR through the
# existing HANDOFFD_BB/HANDOFFD_SUPERVISOR_BB seams: the handoffd stub
# records whether the key is PRESENT (never its value) and the verdict of
# the REAL daemon_alarm_lib.bb configured-email-send-reason decision. Also
# pins the ticket's invariant 2 at the launch surface: the key's VALUE
# never reaches any file the launch produces (only the operator env file
# itself carries it).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPTS="$(cd "$SCRIPT_DIR/.." && pwd)"
LAUNCHER="$SCRIPTS/start_handoff_daemon.sh"
ALARM_LIB="$SCRIPTS/daemon_alarm_lib.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

STUB_PIDS=""
cleanup() {
  for p in $STUB_PIDS; do kill "$p" 2>/dev/null || true; done
  rm -rf "$ROOT" "$STUB_DIR"
}
ROOT="$(cd "$(mktemp -d)" && pwd -P)"
STUB_DIR="$(cd "$(mktemp -d)" && pwd -P)"
trap cleanup EXIT

# ── stub daemons (claim pid files fast, then probe, then linger briefly) ────
cat > "$STUB_DIR/handoffd_stub.bb" <<'EOF'
(require '[babashka.fs :as fs] '[clojure.string :as str])
;; claim the pid file FIRST so the launcher's wait never races lib loading
(let [root (first *command-line-args*)
      daemon-dir (fs/path root ".swarmforge" "daemon")]
  (fs/create-dirs daemon-dir)
  (spit (str (fs/path daemon-dir "handoffd.pid"))
        (str (.pid (java.lang.ProcessHandle/current)))))
;; top-level load-file, its own form, so the ns resolves for the form below
(load-file (System/getenv "BL976_ALARM_LIB"))
(let [key-present (not (str/blank? (System/getenv "RESEND_API_KEY")))
      verdict (daemon-alarm-lib/configured-email-send-reason
               (System/getenv "BL976_CONF_FILE"))]
  ;; presence + verdict only - NEVER the value
  (spit (System/getenv "BL976_PROBE_FILE")
        (str "key_present=" (if key-present 1 0) "\n"
             "verdict=" (pr-str verdict) "\n")))
(Thread/sleep 5000)
EOF
cat > "$STUB_DIR/supervisor_stub.bb" <<'EOF'
(require '[babashka.fs :as fs])
(let [root (first *command-line-args*)
      daemon-dir (fs/path root ".swarmforge" "daemon")]
  (fs/create-dirs daemon-dir)
  (spit (str (fs/path daemon-dir "handoffd-supervisor.pid"))
        (str (.pid (java.lang.ProcessHandle/current))))
  (Thread/sleep 5000))
EOF

CONF="$ROOT/swarmforge.conf"
printf 'config notify_email_to operator@example.com\n' > "$CONF"

launch() {
  local probe="$1"
  env -u SWARMFORGE_CONFIG -u RESEND_API_KEY \
    HANDOFFD_BB="$STUB_DIR/handoffd_stub.bb" \
    HANDOFFD_SUPERVISOR_BB="$STUB_DIR/supervisor_stub.bb" \
    BL976_ALARM_LIB="$ALARM_LIB" \
    BL976_CONF_FILE="$CONF" \
    BL976_PROBE_FILE="$probe" \
    bash "$LAUNCHER" "$ROOT" >/dev/null
}

collect_stub_pids() {
  for f in "$ROOT/.swarmforge/daemon/handoffd.pid" "$ROOT/.swarmforge/daemon/handoffd-supervisor.pid"; do
    [[ -f "$f" ]] && STUB_PIDS="$STUB_PIDS $(cat "$f")"
  done
}

wait_for_probe() {
  local probe="$1" i=0
  while [[ ! -s "$probe" && $i -lt 50 ]]; do sleep 0.1; i=$((i + 1)); done
  [[ -s "$probe" ]] || fail "probe file never written: $probe"
}

# ── 01: no env file -> launch OK, generation is keyless (ambient only) ──────
PROBE1="$ROOT/probe1"
launch "$PROBE1" || fail "01: launch must exit 0 with no env file"
wait_for_probe "$PROBE1"
collect_stub_pids
grep -q "^key_present=0$" "$PROBE1" || fail "01: expected keyless generation, probe: $(cat "$PROBE1")"
grep -q "^verdict=:missing-api-key$" "$PROBE1" || fail "01: real decision must be :missing-api-key, probe: $(cat "$PROBE1")"
grep -q "no operator env file at $ROOT/.swarmforge/operator/daemon.env" \
  "$ROOT/.swarmforge/daemon/daemon-start-audit.log" \
  || fail "01: audit must record the env file path it looked for"
pass "01: absent env file degrades to ambient env, loudly audited"

# ── 02: env file present -> generation sees the key ─────────────────────────
DUMMY_KEY="bl976-dummy-value-a1b2c3d4e5"
mkdir -p "$ROOT/.swarmforge/operator"
printf 'RESEND_API_KEY=%s\n' "$DUMMY_KEY" > "$ROOT/.swarmforge/operator/daemon.env"
PROBE2="$ROOT/probe2"
launch "$PROBE2" || fail "02: launch must exit 0 with env file present"
wait_for_probe "$PROBE2"
collect_stub_pids
grep -q "^key_present=1$" "$PROBE2" || fail "02: generation must see the key, probe: $(cat "$PROBE2")"
grep -q "^verdict=nil$" "$PROBE2" || fail "02: real decision must be sendable (nil), probe: $(cat "$PROBE2")"
grep -q "sourcing operator env file $ROOT/.swarmforge/operator/daemon.env" \
  "$ROOT/.swarmforge/daemon/daemon-start-audit.log" \
  || fail "02: audit must record the sourcing (path only)"
pass "02: present env file is re-sourced into the daemon generation"

# ── 03: the key's VALUE reaches no file the launch produced ─────────────────
LEAKS="$(grep -rl "$DUMMY_KEY" "$ROOT" 2>/dev/null | grep -v "/.swarmforge/operator/daemon.env$" || true)"
[[ -z "$LEAKS" ]] || fail "03: key value leaked into: $LEAKS"
pass "03: key value appears nowhere but the operator env file itself"

echo "ALL PASS"
