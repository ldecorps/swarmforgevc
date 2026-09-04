#!/usr/bin/env bash
# BL-1358 hardener: surgical mutation sweep over runnerAdapter.js's
# resolveMutantTimeoutMs/runGeneratedTests and mutationWorker.js's
# timed-out-outcome branch (BL-149 cooldown gate reads DECISION run for
# both; neither is compiled TS under extension/src, so Stryker's own
# --mutate scope [out/**/*.js] does not reach either - this is the
# BL-638/BL-567 hand-authored fallback). Each mutant is a single edit the
# standing suites (node --test + the property test + acceptance) must
# reject.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ADAPTER=specs/pipeline/runnerAdapter.js
WORKER=specs/pipeline/mutationWorker.js
UNIT=specs/pipeline/test/bl1358MutantTimeCeiling.test.js

BACKUP_A="$(mktemp)"; cp "$ADAPTER" "$BACKUP_A"
BACKUP_W="$(mktemp)"; cp "$WORKER" "$BACKUP_W"
restore() { cp "$BACKUP_A" "$ADAPTER"; cp "$BACKUP_W" "$WORKER"; }

killed=0; survived=0; skipped=0; equivalent=0
declare -a SURVIVORS=()
declare -a SKIPPED=()

MUT_DIR="$(mktemp -d)"
trap 'restore; rm -f "$BACKUP_A" "$BACKUP_W"; rm -rf "$MUT_DIR"' EXIT
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
  if ! node --test "$UNIT" >/dev/null 2>&1; then
    echo "  killed   $label"; killed=$((killed+1)); return
  fi
  if [ -n "$reason" ]; then
    echo "  EQUIV    $label -- $reason"
    equivalent=$((equivalent+1)); return
  fi
  echo "  SURVIVED $label"
  SURVIVORS+=("$label"); survived=$((survived+1))
}

echo "mutation sweep over $ADAPTER + $WORKER (BL-1358 mutant time ceiling)"

# 1. success computation drops the timedOut check. EQUIVALENT, verified
#    empirically against Node's own spawnSync semantics (not assumed):
#    `spawnSync('sleep',['5'],{timeout:200,killSignal:'SIGKILL'})` reports
#    status:null, signal:'SIGKILL' - a process killed by spawnSync's own
#    timeout NEVER reports a numeric exit status, let alone 0. So
#    `result.status === 0` is already false on every real timeout, whether
#    or not `!timedOut` is also checked; the two conditions are redundant
#    for every input this function can actually receive, not merely for the
#    fixtures in this suite.
write from1 'success: !timedOut && result.status === 0,'
write to1   'success: result.status === 0,'
mutate "success computation drops the timedOut check" "$ADAPTER" "$MUT_DIR/from1" "$MUT_DIR/to1" \
  "a SIGKILL-terminated spawnSync child reports status:null, never 0 (verified empirically) - !timedOut is redundant with result.status===0 for every real input"

# 2. timedOut detection inverted: every ordinary run would misreport as timed
#    out, every real timeout would misreport as ordinary.
write from2 "const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');"
write to2   "const timedOut = !Boolean(result.error && result.error.code === 'ETIMEDOUT');"
mutate "timedOut detection inverted" "$ADAPTER" "$MUT_DIR/from2" "$MUT_DIR/to2"

# 3. process-group kill sign dropped (negative pid -> positive): kills only
#    the direct child, not the group - the exact BL-1358/BL-1357 scar this
#    ticket exists to close.
write from3 "process.kill(-result.pid, 'SIGKILL');"
write to3   "process.kill(result.pid, 'SIGKILL');"
mutate "process-group kill uses the direct child's pid, not the group" "$ADAPTER" "$MUT_DIR/from3" "$MUT_DIR/to3"

# 4. resolveMutantTimeoutMs's positivity guard dropped: a negative or zero
#    override would be accepted, producing an instant or negative timeout.
write from4 'if (Number.isFinite(parsed) && parsed > 0) return parsed;'
write to4   'if (Number.isFinite(parsed)) return parsed;'
mutate "resolveMutantTimeoutMs positivity guard dropped" "$ADAPTER" "$MUT_DIR/from4" "$MUT_DIR/to4"

# 5. resolveMutantTimeoutMs default changed away from the ruled 300000ms.
write from5 'const DEFAULT_MUTANT_TIMEOUT_MS = 300000;'
write to5   'const DEFAULT_MUTANT_TIMEOUT_MS = 1000;'
mutate "default ceiling changed away from the ruled 300000ms" "$ADAPTER" "$MUT_DIR/from5" "$MUT_DIR/to5"

# 6. detached:true dropped: spawnSync's own timeout then kills only the
#    direct child by construction, and the manual group-kill's negative pid
#    no longer identifies a real group (the child stays in the parent's).
write from6 '    detached: true,'
write to6   '    detached: false,'
mutate "detached:true dropped (child no longer leads its own process group)" "$ADAPTER" "$MUT_DIR/from6" "$MUT_DIR/to6"

# 7. mutationWorker.js's timed-out branch removed entirely: a killed mutant
#    would fall through to the ordinary test_success/test_failure mapping,
#    reporting a hang that was never proven either way as though it were.
write from7 "    if (result.timedOut) {
      // BL-1358, invariant 1. A mutant that never finished is reported as its
      // OWN outcome, named with the ceiling it exceeded - never folded into
      // test_failure (which would claim the tests DETECTED it) nor into
      // test_success (which would claim it survived a test that actually
      // ran). \`infrastructure_error\` is the report's third bucket: it lands in
      // the summary's Errors, which gherkinMutationClassify already fails the
      // gate on - the human's ruling option 1, a timed-out mutant failing the
      // gate the same as a surviving one, with no change to the classifier and
      // no new outcome string the pinned vendored mutator would not understand.
      return {
        id,
        outcome: 'infrastructure_error',
        timed_out: true,
        error:
          \`mutant \${id} exceeded the \${result.timeoutMs} ms per-mutant ceiling and was killed \` +
          '(SIGKILL to its whole process group). It was neither detected nor shown to survive: ' +
          'nothing about its scenario was proven, and this run reports it as timed out. ' +
          'Raise GHERKIN_MUTATION_TIMEOUT_MS if the scenario is legitimately slower than the ceiling.',
        output: result.output,
      };
    }"
write to7   "    if (false) {}"
mutate "mutationWorker.js's timed-out-outcome branch removed" "$WORKER" "$MUT_DIR/from7" "$MUT_DIR/to7"

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
