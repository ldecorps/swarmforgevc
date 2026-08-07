#!/usr/bin/env bash
# BL-839: master-checkout-drift sweep wiring smoke test. The DECISION logic
# itself (classify-drift/aggregate-verdict/the two declared invariants) is
# exhaustively covered by master_checkout_drift_lib_test_runner.bb and
# bl839_master_checkout_drift_property_runner.bb; this test only proves the
# REAL handoffd.bb daemon actually fires the sweep on its own cadence and
# produces the real, observable side effect - a Telegram OPERATOR-topic
# alarm line - naming a genuinely drifted daemon-executed script. Follows
# the established test_handoffd_flow_watchdog_wiring.sh (BL-577) pattern.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1
DAEMON_PID=""
cleanup() {
  [[ -n "$DAEMON_PID" ]] && kill "$DAEMON_PID" 2>/dev/null || true
  rm -rf "$ROOT"
}
trap cleanup EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge" "$ROOT/.swarmforge/handoffs/inbox/new" "$ROOT/swarmforge/scripts"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$ROOT" > "$ROOT/.swarmforge/roles.tsv"
# No flow-watchdog parcels in this fixture - a tiny escalate threshold on an
# empty inbox keeps that SIBLING sweep from ever alarming, so the only
# outbox line this test can observe is the drift sweep's own.
printf 'config flow_watchdog_warn_ms 999999999\nconfig flow_watchdog_escalate_ms 999999999\n' > "$ROOT/swarmforge/swarmforge.conf"

# ── a real git repo, `main` forced regardless of the host's init.defaultBranch ──
git -C "$ROOT" init -q
git -C "$ROOT" symbolic-ref HEAD refs/heads/main
git -C "$ROOT" config user.email "bl839@example.com"
git -C "$ROOT" config user.name "BL-839"
printf '(defn foo [] :main-version)\n' > "$ROOT/swarmforge/scripts/handoffd_supervisor.bb"
# A trivial stand-in for the entrypoint itself, with no (load-file ...) calls
# of its own - the fixture ROOT's own copy of handoffd.bb is what the drift
# check compares against ITS OWN main, entirely separate from $HANDOFFD (the
# real swarmforge-vc handoffd.bb this test actually runs, resolved by
# absolute path below - the daemon process is real, the checkout it audits
# is this synthetic fixture).
printf '(defn foo [] :main-version)\n' > "$ROOT/swarmforge/scripts/handoffd.bb"
git -C "$ROOT" add .
git -C "$ROOT" commit -q -m "initial"

# ── deliberate drift: the on-disk supervisor now differs from what's on main ──
printf '(defn foo [] :REVERTED-ON-DISK)\n' > "$ROOT/swarmforge/scripts/handoffd_supervisor.bb"

OUTBOX_FILE="$ROOT/.swarmforge/operator/telegram-reply-outbox.jsonl"

PATH="$PATH" bb "$HANDOFFD" "$ROOT" &
DAEMON_PID=$!

for _ in $(seq 1 60); do
  [[ -f "$OUTBOX_FILE" ]] && grep -q "MASTER CHECKOUT DRIFT" "$OUTBOX_FILE" 2>/dev/null && break
  sleep 0.25
done
mkdir -p "$ROOT/.swarmforge/daemon"
touch "$ROOT/.swarmforge/daemon/stop"
wait "$DAEMON_PID" 2>/dev/null || true

# ── 01: the real daemon's own sweep produced the durable alarm ─────────────
[[ -f "$OUTBOX_FILE" ]] || fail "01: telegram-reply-outbox.jsonl was never written - the daemon's drift sweep did not run"
python3 - "$OUTBOX_FILE" <<'PY'
import json, sys
lines = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
alarms = [l for l in lines if l.get("threadId") == "OPERATOR" and "MASTER CHECKOUT DRIFT" in l.get("text", "")]
assert alarms, f"no master-checkout-drift alarm line: {lines!r}"
text = alarms[0]["text"]
assert "swarmforge/scripts/handoffd_supervisor.bb" in text, f"alarm text missing the drifted path: {text!r}"
assert "not the code" in text, f"alarm text missing the stakes statement: {text!r}"
PY
pass "01: the real daemon's master-checkout-drift sweep emitted a Telegram OPERATOR-topic alarm naming the drifted script"

# ── 02: the working tree was left exactly as it was - the check never repairs ──
STATUS_AFTER="$(git -C "$ROOT" status --porcelain=v1 -uall)"
echo "$STATUS_AFTER" | grep -q "handoffd_supervisor.bb" || fail "02: the drifted file no longer shows as modified - something reverted or staged it"
pass "02: the drifted file is still present and unrepaired after the daemon's sweep ran"

echo "test_handoffd_master_checkout_drift_wiring.sh: ALL TESTS PASSED"
