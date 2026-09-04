#!/usr/bin/env bash
# BL-660: shift schedule applier + swarm_shift_lib wiring smoke test.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
mkdir -p "$ROOT/swarmforge" "$ROOT/.swarmforge/operator"
printf 'config swarm_shift night\n' > "$ROOT/swarmforge/swarmforge.conf"

OUT="$(bb "$SRC/apply_shift_schedule.bb" "$ROOT" 2>&1)"
check "applier renders night shift" '[[ "$OUT" == *"\"start\":\"01:00\""* ]]'
check "applier stop 09:00" '[[ "$OUT" == *"\"stop\":\"09:00\""* ]]'

OUT2="$(bb "$SRC/apply_shift_schedule.bb" "$ROOT" 2>&1)"
check "second apply idempotent" '[[ "$OUT2" == *"\"changed\":false"* ]]'

bb "$SRC/test/swarm_shift_lib_test_runner.bb" >/dev/null
check "bb unit tests pass" 'true'

# ── BL-1381: the install wrapper fails LOUD, and touches nothing when it does
#
# Invariant 1: after any install run that exits non-zero, the crontab it was
# pointed at is byte-identical to before the run.
# Invariant 2: exit zero only on the three named outcomes.
#
# A FIXTURE crontab only - a shim on PATH backed by a file. Nothing here reads
# or writes the live user crontab, which the ticket requires explicitly.
BL1381_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bl1381-XXXXXX")"
BL1381_CRON="$BL1381_DIR/crontab.txt"
printf '# pre-existing human line\n0 12 * * * /usr/bin/true\n' >"$BL1381_CRON"
BL1381_BEFORE="$(cat "$BL1381_CRON")"

mkdir -p "$BL1381_DIR/bin"
cat >"$BL1381_DIR/bin/crontab" <<'SHIM'
#!/usr/bin/env bash
# Fixture crontab: reads and writes a file, never the user's real crontab.
case "${1:-}" in
  -l) cat "$BL1381_CRON" ;;
  -r) : >"$BL1381_CRON" ;;
  -)  cat >"$BL1381_CRON" ;;
  *)  exit 2 ;;
esac
SHIM
chmod +x "$BL1381_DIR/bin/crontab"

# A reconcile that exits ZERO and prints NOTHING - the shape that used to be
# announced as "No shift schedule configured" and exit 0. Injected through the
# wrapper's own reconcile-path seam.
BL1381_FAKE_ROOT="$BL1381_DIR/root"
mkdir -p "$BL1381_FAKE_ROOT"
cat >"$BL1381_DIR/empty_reconcile.bb" <<'EMPTY'
#!/usr/bin/env bb
(System/exit 0)
EMPTY

set +e
BL1381_OUT="$(BL1381_CRON="$BL1381_CRON" PATH="$BL1381_DIR/bin:$PATH" \
  SHIFT_SCHEDULE_RECONCILE_BB="$BL1381_DIR/empty_reconcile.bb" \
  bash "$SCRIPT_DIR/../install_shift_schedule_cron.sh" "$BL1381_FAKE_ROOT" 2>&1)"
BL1381_CODE=$?
set -e

if [[ "$BL1381_CODE" -ne 0 ]]; then
  check "BL-1381: a verdict-less reconcile exits non-zero" 'true'
else
  check "BL-1381: a verdict-less reconcile exits non-zero" 'false'
  echo "    got exit 0 with: $BL1381_OUT"
fi

case "$BL1381_OUT" in
  *"No shift schedule configured"*)
    check "BL-1381: a failure is never reported as 'no schedule configured'" 'false' ;;
  *) check "BL-1381: a failure is never reported as 'no schedule configured'" 'true' ;;
esac

# THE DISCRIMINATING ASSERTION. Invariant 2 requires every non-zero path to
# NAME ITS CAUSE, and that is the half the old wrapper failed: it exited 1 by
# `set -e` aborting on a failed `read`, emitting a raw Python traceback and no
# statement of what went wrong. The exit code alone cannot tell the two apart -
# asserting only on it made this row pass against the pre-fix wrapper, which is
# how a vacuous test looks from the inside.
case "$BL1381_OUT" in
  *"refusing to report a verdict it never gave"*|*"carried no scheduling verdict"*)
    check "BL-1381: the failure NAMES its cause, not a raw traceback" 'true' ;;
  *)
    check "BL-1381: the failure NAMES its cause, not a raw traceback" 'false'
    echo "    got: $BL1381_OUT" ;;
esac

case "$BL1381_OUT" in
  *"Traceback"*)
    check "BL-1381: no interpreter traceback leaks to the operator" 'false' ;;
  *) check "BL-1381: no interpreter traceback leaks to the operator" 'true' ;;
esac

if [[ "$(cat "$BL1381_CRON")" == "$BL1381_BEFORE" ]]; then
  check "BL-1381: a failed run leaves the crontab byte-identical" 'true'
else
  check "BL-1381: a failed run leaves the crontab byte-identical" 'false'
fi

rm -rf "$BL1381_DIR"

if [[ "$fail" -eq 0 ]]; then
  echo "BL-660 shift schedule smoke: ALL CHECKS PASSED"
else
  echo "BL-660 shift schedule smoke: FAILURES"
  exit 1
fi
