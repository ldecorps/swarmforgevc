#!/usr/bin/env bash
# BL-839: master-checkout-drift sweep wiring smoke test. The DECISION logic
# itself (classify-drift/aggregate-verdict/the two declared invariants) is
# exhaustively covered by master_checkout_drift_lib_test_runner.bb and
# bl839_master_checkout_drift_property_runner.bb; this test only proves the
# REAL handoffd.bb daemon actually fires the sweep on its own cadence and
# produces the real, observable side effects. Follows the established
# test_handoffd_flow_watchdog_wiring.sh (BL-577) pattern.
#
# BL-1543 (2026-09-12): BL-1139 made durable drift with no commit in flight
# SELF-REPAIR (restore from main, emit one RESTORED note, defer a bounce of
# start_handoff_daemon.sh) instead of only WARNing. This re-tenses the test
# to the live contract: case 01-03 prove the restored branch against a
# fixture with no commit in flight; case 04 proves BL-839's original
# detect-only WARN contract still holds where it is still true - a commit
# in flight (`.git/index.lock` present).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# The daemon's deferred repair bounce (BL-1139) re-invokes
# start_handoff_daemon.sh with this test's own environment. handoffd.bb
# itself never reads SWARMFORGE_SKIP_DAEMON, so the test's own daemon
# processes are unaffected; the bounce's re-invocation sees it and exits
# without starting a second, fixture-rooted daemon (BL-1543: the launcher's
# skip branch writes no audit line, so that bounce is otherwise
# unobservable here - proving it reached the launcher is BL-1548's).
export SWARMFORGE_SKIP_DAEMON=1
export SWARMFORGE_ALLOW_TMP_DAEMON=1

DAEMON_PIDS=()
ROOTS=()
cleanup() {
  # BL-801: an EMPTY array under `set -u` reads as unset to `${arr[@]:-}`,
  # which then spuriously iterates once with an empty element - use the
  # `${arr[@]+"${arr[@]}"}` idiom instead, and keep every loop body's exit
  # protected with `|| true` so a single false test can't abort the trap
  # under `set -e`.
  for pid in ${DAEMON_PIDS[@]+"${DAEMON_PIDS[@]}"}; do
    [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
  done
  for root in ${ROOTS[@]+"${ROOTS[@]}"}; do
    [[ -n "$root" ]] && rm -rf "$root" || true
  done
}
trap cleanup EXIT

# build_fixture: creates a disposable repo at a fresh mktemp root with a
# real `main` branch and a deliberate drift edit to handoffd_supervisor.bb
# and wires the fixture's roles.tsv/conf, then echoes its path. Runs inside
# the caller's `$(...)` command substitution subshell, so it must not
# mutate the parent's ROOTS array itself - the caller registers the
# returned path for cleanup.
build_fixture() {
  local root
  root="$(cd "$(mktemp -d)" && pwd -P)"
  local sock="$root/fake.sock"
  touch "$sock"
  mkdir -p "$root/.swarmforge" "$root/.swarmforge/handoffs/inbox/new" "$root/swarmforge/scripts"
  echo "$sock" > "$root/.swarmforge/tmux-socket"
  printf 'cleaner\tcleaner\t%s\tswarmforge-cleaner\tCleaner\tclaude\tbatch\n' "$root" > "$root/.swarmforge/roles.tsv"
  # No flow-watchdog parcels in this fixture - a tiny escalate threshold on
  # an empty inbox keeps that SIBLING sweep from ever alarming, so the only
  # outbox line this test can observe is the drift sweep's own.
  printf 'config flow_watchdog_warn_ms 999999999\nconfig flow_watchdog_escalate_ms 999999999\n' > "$root/swarmforge/swarmforge.conf"

  # ── a real git repo, `main` forced regardless of init.defaultBranch ──
  git -C "$root" init -q
  git -C "$root" symbolic-ref HEAD refs/heads/main
  git -C "$root" config user.email "bl839@example.com"
  git -C "$root" config user.name "BL-839"
  printf '(defn foo [] :main-version)\n' > "$root/swarmforge/scripts/handoffd_supervisor.bb"
  # A trivial stand-in for the entrypoint itself, with no (load-file ...)
  # calls of its own - the fixture ROOT's own copy of handoffd.bb is what
  # the drift check compares against ITS OWN main, entirely separate from
  # $HANDOFFD (the real swarmforge-vc handoffd.bb this test actually runs).
  printf '(defn foo [] :main-version)\n' > "$root/swarmforge/scripts/handoffd.bb"
  git -C "$root" add .
  git -C "$root" commit -q -m "initial"

  # ── deliberate drift: the on-disk supervisor now differs from main ──
  printf '(defn foo [] :REVERTED-ON-DISK)\n' > "$root/swarmforge/scripts/handoffd_supervisor.bb"

  echo "$root"
}

wait_for_drift_line() {
  local outbox="$1"
  for _ in $(seq 1 60); do
    [[ -f "$outbox" ]] && grep -q "MASTER CHECKOUT DRIFT" "$outbox" 2>/dev/null && return 0
    sleep 0.25
  done
  return 1
}

stop_daemon() {
  local root="$1" pid="$2"
  mkdir -p "$root/.swarmforge/daemon"
  touch "$root/.swarmforge/daemon/stop"
  wait "$pid" 2>/dev/null || true
}

# ═══════════════════════════════════════════════════════════════════════
# Fixture 1: durable drift, no commit in flight - the daemon self-repairs.
# ═══════════════════════════════════════════════════════════════════════
ROOT="$(build_fixture)"
ROOTS+=("$ROOT")
OUTBOX1="$ROOT/.swarmforge/operator/telegram-reply-outbox.jsonl"

PATH="$PATH" bb "$HANDOFFD" "$ROOT" &
PID1=$!
DAEMON_PIDS+=("$PID1")

wait_for_drift_line "$OUTBOX1" || fail "01: telegram-reply-outbox.jsonl never carried a MASTER CHECKOUT DRIFT line - the daemon's drift sweep did not run"

# Give the deferred repair bounce (2 s sleep, then a SKIP_DAEMON=1 no-op
# re-invocation of start_handoff_daemon.sh) time to finish INSIDE the
# daemon's own process lifetime, before this test asks it to stop - so the
# leak check (scenario 02) observes a settled state, not a thread still
# sleeping past `rm -rf $ROOT`.
sleep 3

stop_daemon "$ROOT" "$PID1"

[[ -f "$OUTBOX1" ]] || fail "01: telegram-reply-outbox.jsonl was never written - the daemon's drift sweep did not run"

# ── 01: the real daemon's own sweep repaired the drift and reported it ─────
python3 - "$OUTBOX1" <<'PY'
import json, sys
lines = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
drift_lines = [l["text"] for l in lines if l.get("threadId") == "OPERATOR" and "MASTER CHECKOUT DRIFT" in l.get("text", "")]
restored = [t for t in drift_lines if t.startswith("MASTER CHECKOUT DRIFT RESTORED:")]
assert len(restored) == 1, f"expected exactly one RESTORED line, got: {restored!r} (all drift lines: {drift_lines!r})"
assert "swarmforge/scripts/handoffd_supervisor.bb" in restored[0], f"RESTORED line missing the drifted path: {restored[0]!r}"
PY
pass "01: OPERATOR outbox carries one \"MASTER CHECKOUT DRIFT RESTORED: swarmforge/scripts/handoffd_supervisor.bb\" line"

# ── 02: the drifted file was actually restored to main's content ───────────
STATUS_AFTER="$(git -C "$ROOT" status --porcelain=v1 -uall)"
if echo "$STATUS_AFTER" | grep -q "handoffd_supervisor.bb"; then
  fail "02: the drifted file still shows as modified after the daemon's repair"
fi
DISK_CONTENT="$(cat "$ROOT/swarmforge/scripts/handoffd_supervisor.bb")"
MAIN_CONTENT="$(git -C "$ROOT" show main:swarmforge/scripts/handoffd_supervisor.bb)"
[[ "$DISK_CONTENT" == "$MAIN_CONTENT" ]] || fail "02: the restored file's content does not match main"
pass "02: swarmforge/scripts/handoffd_supervisor.bb matches main after the sweep"

# ── 03: the RESTORED line was the only MASTER CHECKOUT DRIFT line ──────────
# Two distinct checks: no WARN-shaped ("MASTER CHECKOUT DRIFT:") line was
# written for the episode, AND the RESTORED line found in case 01 is the
# ONLY line naming "MASTER CHECKOUT DRIFT" at all (a sibling sweep - the
# tip-floor integrity check - does share this outbox but never this
# substring, confirmed against a real run).
python3 - "$OUTBOX1" <<'PY'
import json, sys
lines = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
drift_lines = [l["text"] for l in lines if l.get("threadId") == "OPERATOR" and "MASTER CHECKOUT DRIFT" in l.get("text", "")]
warn_lines = [t for t in drift_lines if "MASTER CHECKOUT DRIFT:" in t]
assert warn_lines == [], f"a MASTER CHECKOUT DRIFT: warning line was written for a restored episode: {warn_lines!r}"
assert len(drift_lines) == 1, f"expected the RESTORED line to be the only MASTER CHECKOUT DRIFT line, got: {drift_lines!r}"
PY
pass "03: no \"MASTER CHECKOUT DRIFT:\" warning line was written for the restored episode"

echo "fixture root: $ROOT"

# ═══════════════════════════════════════════════════════════════════════
# Fixture 2: same drift, but a commit is in flight - BL-839's original
# detect-only, no-repair contract survives here.
# ═══════════════════════════════════════════════════════════════════════
ROOT2="$(build_fixture)"
ROOTS+=("$ROOT2")
touch "$ROOT2/.git/index.lock"
OUTBOX2="$ROOT2/.swarmforge/operator/telegram-reply-outbox.jsonl"

PATH="$PATH" bb "$HANDOFFD" "$ROOT2" &
PID2=$!
DAEMON_PIDS+=("$PID2")

wait_for_drift_line "$OUTBOX2" || fail "04: telegram-reply-outbox.jsonl never carried a MASTER CHECKOUT DRIFT line for the in-flight fixture"

stop_daemon "$ROOT2" "$PID2"

[[ -f "$OUTBOX2" ]] || fail "04: telegram-reply-outbox.jsonl was never written for the in-flight fixture"

# ── 04: commit in flight - WARN, not repair; the file stays modified ───────
python3 - "$OUTBOX2" <<'PY'
import json, sys
lines = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
alarms = [l for l in lines if l.get("threadId") == "OPERATOR" and "MASTER CHECKOUT DRIFT" in l.get("text", "")]
assert alarms, f"no master-checkout-drift alarm line while a commit was in flight: {lines!r}"
text = alarms[0]["text"]
assert "swarmforge/scripts/handoffd_supervisor.bb" in text, f"alarm text missing the drifted path: {text!r}"
assert "not the code" in text, f"alarm text missing the stakes statement: {text!r}"
PY
STATUS2="$(git -C "$ROOT2" status --porcelain=v1 -uall)"
echo "$STATUS2" | grep -q "handoffd_supervisor.bb" || fail "04: the drifted file no longer shows as modified - the in-flight commit-guard did not hold"
pass "04: with \".git/index.lock\" present, the daemon warned the running code is not the landed code and left swarmforge/scripts/handoffd_supervisor.bb modified"

echo "fixture root: $ROOT2"

echo "test_handoffd_master_checkout_drift_wiring.sh: ALL TESTS PASSED"
