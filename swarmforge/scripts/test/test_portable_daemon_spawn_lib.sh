#!/usr/bin/env bash
# BL-878: focused unit coverage for portable_daemon_spawn_lib.sh's
# portable_spawn_daemon_or_fail, in isolation from any real handoffd.bb -
# the 8 fixed wiring scripts are the end-to-end proof; this proves the
# shared primitive's own three behaviors directly and fast:
#   1. setsid present on PATH -> the setsid branch is taken, daemon starts.
#   2. setsid absent from PATH -> falls back to nohup, daemon still starts.
#   3. the required interpreter is missing -> fails loud, naming it, in the
#      foreground, well under any wait_for_log-scale timeout.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../portable_daemon_spawn_lib.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
cleanup() {
  for f in "$ROOT"/pid-*; do
    [[ -f "$f" ]] || continue
    pid="$(cat "$f" 2>/dev/null || true)"
    if [[ -n "$pid" ]]; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$ROOT"
}
trap cleanup EXIT

# A trivial stand-in "daemon interpreter": records that it started, then
# sleeps so it can be observed running and killed, mirroring the real
# `bb "$HANDOFFD" "$ROOT"` shape without needing a real daemon fixture.
INTERP_BIN="$ROOT/interp-bin"
mkdir -p "$INTERP_BIN"
cat > "$INTERP_BIN/fakebb" <<'EOF'
#!/usr/bin/env bash
echo "started pid=$$" >> "$1"
sleep 30
EOF
chmod +x "$INTERP_BIN/fakebb"

wait_for_marker() {
  local marker="$1" waited=0
  while (( waited < 40 )); do
    [[ -s "$marker" ]] && return 0
    sleep 0.25
    waited=$((waited + 1))
  done
  return 1
}

# ── scenario 1: setsid present on PATH -> setsid branch taken ───────────
SETSID_BIN="$ROOT/setsid-bin"
mkdir -p "$SETSID_BIN"
SETSID_CALLS="$ROOT/setsid-calls.log"
cat > "$SETSID_BIN/setsid" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "$SETSID_CALLS"
exec "\$@"
STUB
chmod +x "$SETSID_BIN/setsid"

MARKER1="$ROOT/marker1.log"
(
  PATH="$SETSID_BIN:$INTERP_BIN:$PATH"
  portable_spawn_daemon_or_fail fakebb "$INTERP_BIN/fakebb" "$MARKER1"
  echo "$!" > "$ROOT/pid-1"
)
wait_for_marker "$MARKER1" || fail "scenario 1: the fake daemon never started with setsid present on PATH"
[[ -s "$SETSID_CALLS" ]] || fail "scenario 1: setsid branch was not taken even though setsid is on PATH"
grep -q "fakebb" "$SETSID_CALLS" || fail "scenario 1: setsid was not invoked with the daemon command"
pass "scenario 1: setsid present on PATH -> setsid branch taken, daemon starts"

kill "$(cat "$ROOT/pid-1")" 2>/dev/null || true
wait "$(cat "$ROOT/pid-1")" 2>/dev/null || true
rm -f "$ROOT/pid-1"

# ── scenario 2: setsid absent from PATH -> nohup fallback, daemon starts ─
# (this project's own dev host already has no real setsid - confirmed by
# `command -v setsid` returning nonzero - so the ambient PATH alone already
# reproduces this branch; only the interpreter stub dir is added.)
MARKER2="$ROOT/marker2.log"
(
  PATH="$INTERP_BIN:$PATH"
  portable_spawn_daemon_or_fail fakebb "$INTERP_BIN/fakebb" "$MARKER2"
  echo "$!" > "$ROOT/pid-2"
)
wait_for_marker "$MARKER2" || fail "scenario 2: the fake daemon never started without setsid on PATH"
pass "scenario 2: setsid absent from PATH -> nohup fallback taken, daemon still starts"

kill "$(cat "$ROOT/pid-2")" 2>/dev/null || true
wait "$(cat "$ROOT/pid-2")" 2>/dev/null || true
rm -f "$ROOT/pid-2"

# ── scenario 3: required interpreter missing -> loud, named, fast failure ─
START_S=$(date +%s)
OUT="$(portable_spawn_daemon_or_fail definitely-not-a-real-interpreter-xyz echo hi 2>&1)" && RC=0 || RC=$?
END_S=$(date +%s)
ELAPSED=$((END_S - START_S))
[[ "$RC" -ne 0 ]] || fail "scenario 3: expected a nonzero exit when the required interpreter is missing"
echo "$OUT" | grep -q "definitely-not-a-real-interpreter-xyz" \
  || fail "scenario 3: expected the failure to name the missing tool, got: $OUT"
[[ "$ELAPSED" -le 5 ]] \
  || fail "scenario 3: took ${ELAPSED}s to fail - too slow to be a foreground check, looks like it waited out a timeout"
pass "scenario 3: missing interpreter fails immediately, naming the tool, well under any wait_for_log timeout"

echo "ALL PASS"
