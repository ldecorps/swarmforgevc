#!/usr/bin/env bash
# BL-1688: start_handoff_daemon.sh's own "mark healthy" status write must
# read-merge-write handoffd.status.json, never blindly overwrite it - a
# blind write erases :restart_history on every invocation, so BL-1492's
# restart-budget ledger could never accumulate past one entry (whichever
# caller started the daemon LAST wiped out what the other had just
# written; 2026-09-21: 334 restarts in 44 minutes, 166 of 325 failure
# reports read restart_history: nil, the rest never more than one entry).
#
# None of BL-1688's own acceptance feature scenarios exercise this path
# directly (they drive the marker-gate and the in-process supervisor
# ledger, which was already correct - see this ticket's coder evidence);
# this file is the real-shell-script proof, same posture as
# test_start_handoff_daemon.sh's own direct invocation.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
START_SCRIPT="$SCRIPT_DIR/../start_handoff_daemon.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
FAKE_BIN="$(mktemp -d)"
trap 'rm -rf "$ROOT" "$FAKE_BIN"' EXIT

mkdir -p "$ROOT/.swarmforge/daemon"
cat > "$FAKE_BIN/bb" <<EOF
#!/usr/bin/env bash
for arg in "\$@"; do
  if [[ "\$arg" == *fake-handoffd.bb ]]; then
    sleep 60 & echo \$! > "$ROOT/.swarmforge/daemon/handoffd.pid"
    exit 0
  fi
  if [[ "\$arg" == *fake-supervisor.bb ]]; then
    sleep 60 & echo \$! > "$ROOT/.swarmforge/daemon/handoffd-supervisor.pid"
    exit 0
  fi
done
exec true
EOF
chmod +x "$FAKE_BIN/bb"

run_start() {
  HANDOFFD_BB="$ROOT/bin/fake-handoffd.bb" \
  HANDOFFD_SUPERVISOR_BB="$ROOT/bin/fake-supervisor.bb" \
  PID_WAIT_ATTEMPTS=30 \
  PATH="$FAKE_BIN:$PATH" \
    bash "$START_SCRIPT" "$ROOT" >/dev/null
}

# ── 01: an existing restart_history survives the start owner's own write ──
printf '{"state":"dead","restart_history":[{"at":1,"result":"failed","reason":"dead"},{"at":2,"result":"failed","reason":"dead"}],"last_incident":{"reason":"dead"}}' \
  > "$ROOT/.swarmforge/daemon/handoffd.status.json"
run_start
COUNT="$(python3 -c 'import json; print(len(json.load(open("'"$ROOT"'/.swarmforge/daemon/handoffd.status.json"))["restart_history"]))')"
[[ "$COUNT" == "2" ]] || fail "01: expected 2 restart_history entries to survive, got $COUNT"
STATE="$(python3 -c 'import json; print(json.load(open("'"$ROOT"'/.swarmforge/daemon/handoffd.status.json"))["state"])')"
[[ "$STATE" == "healthy" ]] || fail "01: expected state=healthy, got $STATE"
INCIDENT="$(python3 -c 'import json; print(json.load(open("'"$ROOT"'/.swarmforge/daemon/handoffd.status.json"))["last_incident"]["reason"])')"
[[ "$INCIDENT" == "dead" ]] || fail "01: expected last_incident to also survive untouched, got $INCIDENT"
pass "01: an existing restart_history (and every other field) survives the start owner's own status write"

# ── 02: a status file with no restart_history at all still gets state=healthy ─
kill "$(< "$ROOT/.swarmforge/daemon/handoffd.pid")" 2>/dev/null || true
kill "$(< "$ROOT/.swarmforge/daemon/handoffd-supervisor.pid")" 2>/dev/null || true
printf '{"state":"halted"}' > "$ROOT/.swarmforge/daemon/handoffd.status.json"
run_start
STATE2="$(python3 -c 'import json; print(json.load(open("'"$ROOT"'/.swarmforge/daemon/handoffd.status.json"))["state"])')"
[[ "$STATE2" == "healthy" ]] || fail "02: expected state=healthy with no restart_history present, got $STATE2"
pass "02: a status file carrying no restart_history at all still ends up healthy (no regression)"

# ── 03: no status file at all - the start owner creates none (unchanged) ──
kill "$(< "$ROOT/.swarmforge/daemon/handoffd.pid")" 2>/dev/null || true
kill "$(< "$ROOT/.swarmforge/daemon/handoffd-supervisor.pid")" 2>/dev/null || true
rm -f "$ROOT/.swarmforge/daemon/handoffd.status.json"
run_start
[[ ! -f "$ROOT/.swarmforge/daemon/handoffd.status.json" ]] \
  || fail "03: expected no status file to be created by the start owner"
pass "03: no pre-existing status file - the start owner still creates none (unchanged behavior)"

echo "ALL PASS: BL-1688 status-ledger-survives-start"
