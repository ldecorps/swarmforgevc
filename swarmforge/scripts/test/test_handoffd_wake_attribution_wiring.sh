#!/usr/bin/env bash
# BL-870: wiring smoke test proving the REAL handoffd.bb chase sweep
# actually calls record-wake-attribution! at its own wake sites
# (chase-poke-and-notify!, wired from both the inbox-item and
# stuck-in-process sweeps) - required_wiring in the ticket YAML. The
# DECISION logic itself (chased/nudge/skip ladder) is unchanged and already
# covered by test_chase_sweep.sh and test_handoffd_chase_sweep_wiring.sh;
# this test only proves every wake this daemon injects OR withholds now
# leaves a durable attribution record naming the role, the sweep, and the
# motivating handoff (present or explicitly absent).
#
# Three independent single-role, single-populated-mailbox runs, one queue
# at a time - NOT one run with both queues populated. A single-role
# roles.tsv fixture is always the mono-router resident (mono-router-
# resident-session picks "first non-coordinator role in roles.tsv" - real
# production logic, unrelated to this ticket), so inbox-item and
# stuck-in-process items for that SAME role would otherwise compete for one
# shared per-sweep-tick wake budget and the loser would record a genuine
# ("dedup") skip rather than the scenario each run means to exercise.
#
# claim-idle-probe (the third named sweep) shares the exact same
# motivating-handoff/build-attribution code path this test already proves
# for stuck-in-process (both read :in_process) - see
# wake_attribution_lib_test_runner.bb and
# bl870_wake_attribution_property_runner.bb for that pure-logic coverage.
# Its own :send-claim-idle-probe! wiring is not separately live-tested here:
# reaching it requires a claim aged past claim-idle-timeout-ms (20 real
# minutes, not env-overridable in the live daemon - BL-528 has no live-
# daemon wiring test of its own for the same reason, only the offline
# chase_sweep_test_runner.bb harness with a fake now-ms). Confirmed by
# reading the wiring directly instead (same "wiring is real, not inert"
# check the architect pass already does elsewhere in this project).
#
# Covers acceptance scenarios BL-870 wake-attribution-01, 03 (inbox-item and
# stuck-in-process rows), 04.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

MONTH="$(date -u +%Y-%m)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1  # intentional throwaway test roots

mk_fixture() {
  # $1 = root
  local root="$1"
  mkdir -p "$root/.swarmforge" "$root/.swarmforge/handoffs/inbox/new" \
           "$root/.swarmforge/handoffs/inbox/in_process" "$root/.swarmforge/daemon"
  local sock="$root/fake.sock"
  touch "$sock"
  echo "$sock" > "$root/.swarmforge/tmux-socket"
  printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$root" > "$root/.swarmforge/roles.tsv"
}

mk_fake_tmux() {
  # $1 = fake-bin dir, $2 = calls-log path, $3 = "idle" | "busy"
  mkdir -p "$1"
  if [[ "$3" == "busy" ]]; then
    cat > "$1/tmux" <<TMUX
#!/usr/bin/env bash
echo "\$*" >> "$2"
if [[ "\$1 \$2 \$3" == "-S "*"has-session" ]]; then
  exit 0
fi
if [[ "\$1 \$2 \$3" == "-S "*"capture-pane" ]]; then
  echo "  ⏵⏵ working… (esc to interrupt)"
  exit 0
fi
exit 0
TMUX
  else
    cat > "$1/tmux" <<TMUX
#!/usr/bin/env bash
echo "\$*" >> "$2"
if [[ "\$1 \$2 \$3" == "-S "*"has-session" ]]; then
  exit 0
fi
exit 0
TMUX
  fi
  chmod +x "$1/tmux"
}

# ═══════════════════════════════════════════════════════════════════════════
# Run 1 (idle pane, inbox/new populated only): inbox-item wake lands.
# BL-870 wake-attribution-01/03.
# ═══════════════════════════════════════════════════════════════════════════

ROOT1="$(cd "$(mktemp -d)" && pwd -P)"
DAEMON1=""
cleanup1() { [[ -n "$DAEMON1" ]] && kill "$DAEMON1" 2>/dev/null || true; rm -rf "$ROOT1"; }
trap cleanup1 EXIT

mk_fixture "$ROOT1"
NEW_FILE1="$ROOT1/.swarmforge/handoffs/inbox/new/00_20260701T000000Z_000001_from_specifier_to_coder.handoff"
printf 'id: t1\nfrom: specifier\nto: coder\npriority: 00\ntype: note\nmessage: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n' > "$NEW_FILE1"
python3 -c "import os,time; os.utime('$NEW_FILE1', (time.time()-45, time.time()-45))"

FAKE_BIN1="$ROOT1/bin"
TMUX_LOG1="$ROOT1/tmux-calls.log"
mk_fake_tmux "$FAKE_BIN1" "$TMUX_LOG1" "idle"

# Backgrounded DIRECTLY in this shell (never inside a `$(...)` command
# substitution): the daemon inherits this shell's stdout/stderr, and a
# substitution's pipe would never see EOF while the still-running daemon
# holds its write end open - exactly the deadlock a first version of this
# test hit (`DAEMON="$(run_daemon ...)"`, hung forever on the capture pipe).
PATH="$FAKE_BIN1:$PATH" bb "$HANDOFFD" "$ROOT1" &
DAEMON1=$!

ATTR_FILE1="$ROOT1/.swarmforge/telemetry/wake-attribution-$MONTH.jsonl"
for _ in $(seq 1 60); do
  [[ -f "$ATTR_FILE1" ]] && grep -q '"sweep":"inbox-item"' "$ATTR_FILE1" 2>/dev/null && break
  sleep 0.25
done
mkdir -p "$ROOT1/.swarmforge/daemon"
touch "$ROOT1/.swarmforge/daemon/stop"
wait "$DAEMON1" 2>/dev/null || true

[[ -f "$ATTR_FILE1" ]] || fail "01: wake-attribution jsonl was never written"

python3 - "$ATTR_FILE1" "$(basename "$NEW_FILE1")" <<'PY'
import json, sys
path, name = sys.argv[1], sys.argv[2]
lines = [json.loads(l) for l in open(path) if l.strip()]
inbox_item = [l for l in lines if l.get("sweep") == "inbox-item" and l.get("role") == "coder"]
assert inbox_item, f"no inbox-item attribution recorded: {lines!r}"
e = inbox_item[0]
assert e.get("outcome") == "landed", f"01: inbox-item outcome not landed: {e!r}"
assert e.get("handoffId") == name, f"01: inbox-item attribution names the wrong handoff: {e!r}"
assert e.get("handoffPresent?") is True, f"01: inbox-item handoffPresent? not true: {e!r}"
assert e.get("at"), f"01: inbox-item attribution missing timestamp: {e!r}"
PY
pass "01: the real daemon's inbox-item sweep records a landed attribution naming the motivating handoff"

grep -q "send-keys" "$TMUX_LOG1" || fail "05: no send-keys was ever sent - attribution wiring changed the wake outcome"
[[ -f "$NEW_FILE1.chase.json" ]] || fail "05: chase sidecar was never written - attribution wiring changed the sweep's own bookkeeping"
pass "05: recording an attribution did not change the sweep's own wake outcome or bookkeeping"

cleanup1
trap - EXIT

# ═══════════════════════════════════════════════════════════════════════════
# Run 2 (idle pane, in_process populated only): stuck-in-process wake lands.
# BL-870 wake-attribution-03.
# ═══════════════════════════════════════════════════════════════════════════

ROOT2="$(cd "$(mktemp -d)" && pwd -P)"
DAEMON2=""
cleanup2() { [[ -n "$DAEMON2" ]] && kill "$DAEMON2" 2>/dev/null || true; rm -rf "$ROOT2"; }
trap cleanup2 EXIT

mk_fixture "$ROOT2"
IN_PROCESS_FILE2="$ROOT2/.swarmforge/handoffs/inbox/in_process/00_20260701T000000Z_000002_from_coordinator_to_coder.handoff"
printf 'id: t2\nfrom: coordinator\nto: coder\npriority: 10\ntype: git_handoff\ntask: BL-000-fixture\ncommit: aaaaaaaaaa\ncreated_at: 2026-07-01T00:00:00Z\n\nwork\n' > "$IN_PROCESS_FILE2"

FAKE_BIN2="$ROOT2/bin"
TMUX_LOG2="$ROOT2/tmux-calls.log"
mk_fake_tmux "$FAKE_BIN2" "$TMUX_LOG2" "idle"

PATH="$FAKE_BIN2:$PATH" bb "$HANDOFFD" "$ROOT2" &
DAEMON2=$!

ATTR_FILE2="$ROOT2/.swarmforge/telemetry/wake-attribution-$MONTH.jsonl"
for _ in $(seq 1 60); do
  [[ -f "$ATTR_FILE2" ]] && grep -q '"sweep":"stuck-in-process"' "$ATTR_FILE2" 2>/dev/null && break
  sleep 0.25
done
mkdir -p "$ROOT2/.swarmforge/daemon"
touch "$ROOT2/.swarmforge/daemon/stop"
wait "$DAEMON2" 2>/dev/null || true

[[ -f "$ATTR_FILE2" ]] || fail "03: wake-attribution jsonl was never written for the in-process run"

python3 - "$ATTR_FILE2" "$(basename "$IN_PROCESS_FILE2")" <<'PY'
import json, sys
path, name = sys.argv[1], sys.argv[2]
lines = [json.loads(l) for l in open(path) if l.strip()]
stuck = [l for l in lines if l.get("sweep") == "stuck-in-process" and l.get("role") == "coder"]
assert stuck, f"03: no stuck-in-process attribution recorded: {lines!r}"
e = stuck[0]
assert e.get("outcome") == "landed", f"03: stuck-in-process outcome not landed: {e!r}"
assert e.get("handoffId") == name, f"03: stuck-in-process attribution names the wrong handoff: {e!r}"
assert e.get("handoffPresent?") is True, f"03: stuck-in-process handoffPresent? not true: {e!r}"
PY
pass "03: the real daemon's stuck-in-process sweep records a landed attribution naming the motivating handoff (a distinct sweep name from inbox-item)"

cleanup2
trap - EXIT

# ═══════════════════════════════════════════════════════════════════════════
# Run 3 (busy pane, inbox/new populated only): inbox-item wake is withheld,
# and the withheld wake is attributed exactly like a landed one - same
# handoff named, but outcome skipped. BL-870 wake-attribution-04.
# ═══════════════════════════════════════════════════════════════════════════

ROOT3="$(cd "$(mktemp -d)" && pwd -P)"
DAEMON3=""
cleanup3() { [[ -n "$DAEMON3" ]] && kill "$DAEMON3" 2>/dev/null || true; rm -rf "$ROOT3"; }
trap cleanup3 EXIT

mk_fixture "$ROOT3"
NEW_FILE3="$ROOT3/.swarmforge/handoffs/inbox/new/00_20260701T000000Z_000003_from_specifier_to_coder.handoff"
printf 'id: t3\nfrom: specifier\nto: coder\npriority: 00\ntype: note\nmessage: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n' > "$NEW_FILE3"
python3 -c "import os,time; os.utime('$NEW_FILE3', (time.time()-45, time.time()-45))"

FAKE_BIN3="$ROOT3/bin"
TMUX_LOG3="$ROOT3/tmux-calls.log"
mk_fake_tmux "$FAKE_BIN3" "$TMUX_LOG3" "busy"

PATH="$FAKE_BIN3:$PATH" bb "$HANDOFFD" "$ROOT3" &
DAEMON3=$!

ATTR_FILE3="$ROOT3/.swarmforge/telemetry/wake-attribution-$MONTH.jsonl"
for _ in $(seq 1 60); do
  [[ -f "$ATTR_FILE3" ]] && grep -q '"sweep":"inbox-item"' "$ATTR_FILE3" 2>/dev/null && break
  sleep 0.25
done
mkdir -p "$ROOT3/.swarmforge/daemon"
touch "$ROOT3/.swarmforge/daemon/stop"
wait "$DAEMON3" 2>/dev/null || true

[[ -f "$ATTR_FILE3" ]] || fail "04: wake-attribution jsonl was never written for the busy-pane run"
grep -q "send-keys" "$TMUX_LOG3" && fail "04: send-keys was sent despite the pane reading busy - fixture is not exercising the skip path"

python3 - "$ATTR_FILE3" "$(basename "$NEW_FILE3")" <<'PY'
import json, sys
path, name = sys.argv[1], sys.argv[2]
lines = [json.loads(l) for l in open(path) if l.strip()]
skipped = [l for l in lines if l.get("sweep") == "inbox-item" and l.get("role") == "coder" and l.get("outcome") == "skipped"]
assert skipped, f"04: no skipped inbox-item attribution recorded: {lines!r}"
e = skipped[0]
assert e.get("handoffId") == name, f"04: skipped attribution does not name the same handoff a landed wake would: {e!r}"
assert e.get("handoffPresent?") is True, f"04: skipped attribution handoffPresent? not true: {e!r}"
assert e.get("skipReason") == "busy", f"04: skipped attribution missing/wrong skipReason: {e!r}"
PY
pass "04: a withheld (busy-pane) wake is recorded with the same motivating handoff a landed wake would carry, outcome skipped"

cleanup3
trap - EXIT

echo "ALL PASS"
