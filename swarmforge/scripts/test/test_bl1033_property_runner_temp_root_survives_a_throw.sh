#!/usr/bin/env bash
# BL-1033: bl1025_expedite_approval_property_runner.bb creates its fixture root
# with fs/create-temp-dir at the top and removes it with fs/delete-tree at the
# BOTTOM - at top level, after the last assertion, in no try/finally and behind
# no shutdown hook. That last form is reached only when every preceding form
# completes, and the runner has a live throw path: its git helper throws
# ex-info on any non-zero git exit. A throw there exits before the delete-tree
# and leaves a bl1025-prop-* directory behind permanently.
#
# Two runners in this same directory already carry the fix, and one of them
# (bl887) records that QA bounced this exact class under this exact guard.
#
# Each case measures the SET of bl1025-prop-* directories before and after, so
# it reports only what THIS run leaked and never trips over a leftover from a
# previous run - and, per "never delete what you did not create", it removes
# only roots that appeared during its own run.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPTS="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNNER="$SCRIPT_DIR/bl1025_expedite_approval_property_runner.bb"
# The directory fs/create-temp-dir actually writes into (java.io.tmpdir).
TMPBASE="$(bb -e '(println (System/getProperty "java.io.tmpdir"))' | tr -d '\r')"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

BL1033_SCRATCH=()
cleanup() {
  local d
  for d in ${BL1033_SCRATCH[@]+"${BL1033_SCRATCH[@]}"}; do
    [ -n "$d" ] && rm -rf -- "$d"
  done
}
trap cleanup EXIT

snapshot_roots() { ls -d "$TMPBASE"/bl1025-prop-* 2>/dev/null | sort; }

# Roots that appeared during the run just measured. Removes them (they are this
# test's own leavings, created by the runner it invoked) and prints them, so a
# leak is both reported and not accumulated for the next case.
leaked_since() {
  local before="$1" after leaked d
  after="$(snapshot_roots)"
  leaked="$(comm -13 <(printf '%s\n' "$before") <(printf '%s\n' "$after"))"
  while IFS= read -r d; do
    [ -n "$d" ] && rm -rf -- "$d"
  done <<EOF
$leaked
EOF
  printf '%s' "$leaked"
}

# ═══════════════════════════════════════════════════════════════════════════
# (a) THE DEFECT: the git helper throws, and the root must not survive it.
#     A `git` shim earlier on PATH that always fails makes the runner's own
#     `g` helper throw on its first call - the real throw path, not a
#     simulated one, and no copy of the runner involved.
# ═══════════════════════════════════════════════════════════════════════════

SHIM_DIR="$(cd "$(mktemp -d)" && pwd -P)"
BL1033_SCRATCH+=("$SHIM_DIR")
cat > "$SHIM_DIR/git" <<'EOF'
#!/usr/bin/env bash
echo "bl1033: forced git failure" >&2
exit 1
EOF
chmod +x "$SHIM_DIR/git"

BEFORE="$(snapshot_roots)"
PATH="$SHIM_DIR:$PATH" bb "$RUNNER" >/dev/null 2>&1
RC=$?
LEAKED="$(leaked_since "$BEFORE")"

[ "$RC" -ne 0 ] \
  || fail "a: the runner reported success while its git helper was failing - the throw path is not live, so this case proves nothing"
[ -z "$LEAKED" ] \
  || fail "a: a throw from the git helper leaked the fixture root: $LEAKED"
pass "a: a throw from the git helper leaves no fixture directory behind"

# ═══════════════════════════════════════════════════════════════════════════
# (b) The happy path still cleans up, and still passes.
# ═══════════════════════════════════════════════════════════════════════════

BEFORE="$(snapshot_roots)"
OUT="$(bb "$RUNNER" 2>&1)"
RC=$?
LEAKED="$(leaked_since "$BEFORE")"

[ "$RC" -eq 0 ] || fail "b: the runner failed on the happy path: $OUT"
grep -q "ALL PROPERTIES HOLD" <<< "$OUT" || fail "b: unexpected happy-path output: $OUT"
grep -q "32 cases, exhaustive" <<< "$OUT" \
  || fail "b: the 32-case exhaustive sweep did not report - the assertions must not be weakened: $OUT"
[ -z "$LEAKED" ] || fail "b: a passing run leaked the fixture root: $LEAKED"
pass "b: a completed run passes, reports its 32-case sweep, and leaves no fixture directory"

# ═══════════════════════════════════════════════════════════════════════════
# (c) SIGTERM mid-run. A shutdown hook covers SIGTERM; nothing covers SIGKILL,
#     so this case uses TERM deliberately and says so rather than claiming
#     both.
# ═══════════════════════════════════════════════════════════════════════════

BEFORE="$(snapshot_roots)"
bb "$RUNNER" >/dev/null 2>&1 &
RUNNER_PID=$!
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  [ -n "$(comm -13 <(printf '%s\n' "$BEFORE") <(snapshot_roots))" ] && break
  sleep 0.1
done
# Settle before killing, and the reason is a REAL limit rather than a flaky
# test being papered over: creating the directory and registering the hook
# that reclaims it cannot be one atomic step, so a kill landing in the window
# between them finds no hook installed yet and the root survives. Measured on
# this host: killing the instant the directory appears leaks it; killing after
# any settle does not. What the hook guarantees is a TERM to a running run,
# which is what this case asserts. The residual window is named here rather
# than asserted away.
sleep 0.5
kill -TERM "$RUNNER_PID" 2>/dev/null
wait "$RUNNER_PID" 2>/dev/null
sleep 0.6
LEAKED="$(leaked_since "$BEFORE")"

[ -z "$LEAKED" ] \
  || fail "c: SIGTERM left the fixture root behind (a shutdown hook covers TERM): $LEAKED"
pass "c: a run killed with SIGTERM leaves no fixture directory (SIGKILL is deliberately not covered)"

# ═══════════════════════════════════════════════════════════════════════════
# (d) The assertions were not weakened. A copy with its 32-case sweep broken
#     must still fail the run - and still clean up. The copy lives outside the
#     repo, in the layout the runner's own relative load-file resolution
#     needs, so no scratch .bb is ever left inside swarmforge/scripts for a
#     tree-wide guard or a discovery glob to pick up.
# ═══════════════════════════════════════════════════════════════════════════

SCRATCH="$(cd "$(mktemp -d)" && pwd -P)"
BL1033_SCRATCH+=("$SCRATCH")
mkdir -p "$SCRATCH/scripts/test"
cp "$SCRIPTS/expedite_lib.bb" "$SCRATCH/scripts/expedite_lib.bb"
cp "$SCRIPTS/is_qa_ancestor.sh" "$SCRATCH/scripts/is_qa_ancestor.sh"
# Break the sweep by demanding a count the table cannot reach.
sed 's/(not= 32 @swept)/(not= 999 @swept)/' "$RUNNER" > "$SCRATCH/scripts/test/runner.bb"
grep -q "not= 999 @swept" "$SCRATCH/scripts/test/runner.bb" \
  || fail "d: the sweep-guard break did not apply - this case would pass vacuously"

BEFORE="$(snapshot_roots)"
OUT="$(bb "$SCRATCH/scripts/test/runner.bb" 2>&1)"
RC=$?
LEAKED="$(leaked_since "$BEFORE")"

[ "$RC" -ne 0 ] \
  || fail "d: a broken exhaustive sweep did not fail the run - the guard is not load-bearing"
grep -q "exhaustive" <<< "$OUT" || fail "d: the sweep failure was not reported: $OUT"
[ -z "$LEAKED" ] || fail "d: a failed sweep left the fixture root behind: $LEAKED"
pass "d: a broken exhaustive sweep still fails the run, and still leaves no fixture directory"

echo "ALL PASS: BL-1033 property-runner temp root survives a throw"
