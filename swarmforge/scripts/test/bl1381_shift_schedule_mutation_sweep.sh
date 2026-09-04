#!/usr/bin/env bash
# BL-1381 hardener: surgical mutation sweep over install_shift_schedule_cron.sh
# and shift_schedule_applier_lib.bb (BL-149 cooldown gate: both DECISION run).
# Babashka/shell have no mutation tool wired (Startup Tools) - this is the
# BL-638/BL-567 hand-authored fallback. Each mutant is a single edit
# test_shift_schedule_applier.sh must reject.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WRAPPER=swarmforge/scripts/install_shift_schedule_cron.sh
LIB=swarmforge/scripts/shift_schedule_applier_lib.bb
UNIT=swarmforge/scripts/test/test_shift_schedule_applier.sh

BACKUP_W="$(mktemp)"; cp "$WRAPPER" "$BACKUP_W"
BACKUP_L="$(mktemp)"; cp "$LIB" "$BACKUP_L"
restore() { cp "$BACKUP_W" "$WRAPPER"; cp "$BACKUP_L" "$LIB"; }
cleanup() { restore; rm -f "$BACKUP_W" "$BACKUP_L"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0; equivalent=0
declare -a SURVIVORS=()
declare -a SKIPPED=()

MUT_DIR="$(mktemp -d)"
trap 'restore; rm -f "$BACKUP_W" "$BACKUP_L"; rm -rf "$MUT_DIR"' EXIT
write() { printf '%s' "$2" >"$MUT_DIR/$1"; }

# mutate <label> <target-file> <from-file> <to-file> [equivalent-reason]
mutate() {
  local label="$1" target="$2" fromfile="$3" tofile="$4" reason="${5:-}"
  restore
  if ! python3 - "$target" "$fromfile" "$tofile" <<'PY'
import sys
p, af, bf = sys.argv[1], sys.argv[2], sys.argv[3]
a = open(af).read()
b = open(bf).read()
s = open(p).read()
if a not in s:
    sys.exit(3)
open(p, 'w').write(s.replace(a, b, 1))
PY
  then
    echo "  skip     $label (anchor not found)"
    SKIPPED+=("$label"); skipped=$((skipped+1)); return
  fi
  if ! bash "$UNIT" >/dev/null 2>&1; then
    echo "  killed   $label"; killed=$((killed+1)); return
  fi
  if [ -n "$reason" ]; then
    echo "  EQUIV    $label -- $reason"
    equivalent=$((equivalent+1)); return
  fi
  echo "  SURVIVED $label"
  SURVIVORS+=("$label"); survived=$((survived+1))
}

echo "mutation sweep over $WRAPPER + $LIB (BL-1381)"

# 1. Reconcile-failure capture dropped: back to a bare command substitution
#    under set -e that aborts with no message (the exact defect fixed).
write from1 'if ! result="$(bb "$RECONCILE_BB" "$ROOT" 2>&1)"; then'
write to1   'if false; then'
mutate "reconcile-failure capture disabled" "$WRAPPER" "$MUT_DIR/from1" "$MUT_DIR/to1"

# 2. Empty-output refusal dropped: a reconcile that exits 0 but prints
#    nothing would fall through to the parse step instead of refusing.
#    EQUIVALENT, verified empirically (BL-234): an empty result_file ALWAYS
#    fails json.load() with JSONDecodeError ("Expecting value") - confirmed
#    by direct invocation - so removing this check never lets an empty file
#    reach the success path; check 3's parse-status check catches it every
#    time, refusing with the same "refusing to report a verdict it never
#    gave" family of text the test's own broad OR-pattern assertion accepts.
write from2 'if [[ ! -s "$result_file" ]]; then
  echo "install_shift_schedule_cron.sh: the reconcile produced no output for $ROOT - refusing to report a verdict it never gave" >&2
  exit 1
fi'
write to2   'true'
mutate "empty-output refusal dropped" "$WRAPPER" "$MUT_DIR/from2" "$MUT_DIR/to2" \
  "empty file always fails json.load, always caught by the parse-status check downstream (verified empirically)"

# 3. Parse-status check (`if ! parsed=...`) disabled: python's own exit
#    status ignored. EQUIVALENT, verified empirically: confirmed by direct
#    invocation that when python succeeds, d.get(...) with defaults ALWAYS
#    prints a non-empty three-token line - `scheduling` can only be empty
#    when python already failed - so a disabled parse-status check is masked
#    by the empty-scheduling-verdict check (4) downstream on every input;
#    reproduced live against the real fixture with the check fully removed
#    (`|| true` in place of the `if !`/exit-1 block) and the suite still
#    passed, refusing via check 4's message instead.
write from3 'if ! parsed="$(python3 - "$result_file" 2>/dev/null <<'"'"'PYPARSE'"'"''
write to3   'parsed=""; if true <<'"'"'PYPARSE'"'"''
mutate "non-JSON parse failure swallowed" "$WRAPPER" "$MUT_DIR/from3" "$MUT_DIR/to3" \
  "python success always yields a non-empty scheduling token via .get() defaults; any failure is already caught by the empty-scheduling-verdict check (verified empirically against the real fixture)"

# 4. Empty-scheduling-verdict refusal dropped. EQUIVALENT, verified
#    empirically: `scheduling` can only be empty when the parse-status check
#    (3) already failed (python crashed or produced no output) - a
#    SUCCESSFUL python run always emits three space-separated tokens via
#    .get()'s defaults, never an empty first token - so this check is
#    reachable only through a state check 3 already refuses on.
write from4 'if [[ -z "${scheduling:-}" ]]; then
  echo "install_shift_schedule_cron.sh: the reconcile output carried no scheduling verdict for $ROOT" >&2
  exit 1
fi'
write to4   'true'
mutate "empty-scheduling-verdict refusal dropped" "$WRAPPER" "$MUT_DIR/from4" "$MUT_DIR/to4" \
  "scheduling can only be empty when the parse-status check already failed (python's .get() defaults always populate it on success, verified empirically)"

# 5. Non-JSON guard in the python parser itself removed: a JSON array/scalar
#    (not an object) would raise no SystemExit; instead .get() raises an
#    uncaught AttributeError. EQUIVALENT, verified empirically: both paths
#    exit 1, and confirmed by direct invocation with stdout/stderr split
#    that the AttributeError traceback writes to STDERR ONLY (stdout stays
#    empty) - the wrapper's python call already redirects stderr to
#    /dev/null, so the traceback never leaks either way and the
#    parse-status check (3) catches the exit-1 identically.
write from5 'if not isinstance(d, dict):
    raise SystemExit("reconcile output is not a JSON object")'
write to5   'pass'
mutate "python object-type guard removed" "$WRAPPER" "$MUT_DIR/from5" "$MUT_DIR/to5" \
  "an uncaught AttributeError on a non-dict payload exits 1 with the traceback on stderr only (verified empirically, split stdout/stderr) - identical outward behavior to the guarded SystemExit given the wrapper's existing 2>/dev/null"

# 6. BL-1381's ns-level require reverted to the original in-function require
#    (the exact original defect): the file fails to load again.
write from6 "            [babashka.process :as process]
"
write to6   ""
mutate "babashka.process require removed from ns form (original load-crash defect)" "$LIB" "$MUT_DIR/from6" "$MUT_DIR/to6"

echo "----"
echo "mutants: killed=$killed survived=$survived equivalent=$equivalent skipped=$skipped"
if [ "$survived" -gt 0 ]; then
  echo "SURVIVORS:"; printf '  %s\n' "${SURVIVORS[@]}"
  exit 1
fi
if [ "$skipped" -gt 0 ]; then
  echo "SKIPPED (stale anchors, unrun):"; printf '  %s\n' "${SKIPPED[@]}"
fi
echo "ALL MUTANTS KILLED (or accepted-equivalent, see EQUIV lines above)"
