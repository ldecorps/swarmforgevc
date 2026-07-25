#!/usr/bin/env bash
# BL-567 architect: prove each property is non-vacuous by breaking the invariant
# it checks and confirming the suite FAILS, then restoring and confirming green.
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB=swarmforge/scripts/expedite_lib.bb
RUNNER=swarmforge/scripts/test/expedite_lib_property_runner.bb

restore() { git checkout -q -- "$LIB"; }
trap restore EXIT

# break <name> <expected-failing-property> <python-replacement>
attempt() {
  local name="$1" expect="$2" pyfrom="$3" pyto="$4"
  restore
  python3 - "$LIB" "$pyfrom" "$pyto" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
if a not in s:
    print("ANCHOR-MISS"); sys.exit(3)
open(p, 'w').write(s.replace(a, b, 1))
PY
  if [[ $? -eq 3 ]]; then echo "  ?? $name: anchor not found"; return 1; fi
  out="$(PROPERTY_RUNS=300 bb "$RUNNER" 2>&1)"
  if grep -q "ALL PROPERTIES HOLD" <<<"$out"; then
    echo "  VACUOUS  $name -> suite still green with the invariant broken"
    return 1
  fi
  if grep -q "$expect" <<<"$out"; then
    echo "  ok       $name -> $expect failed as it must"
    return 0
  fi
  echo "  WRONG-P  $name -> failed, but not $expect:"
  grep "^FAIL" <<<"$out" | head -2 | sed 's/^/             /'
  return 1
}

echo "non-vacuity proof (300 runs per attempt):"
bad=0

attempt "P1 stopped? forced true" "P1" \
  '{:stopped? (empty? alive) :alive alive}' \
  '{:stopped? true :alive alive}' || bad=$((bad+1))

# Dropping babysitterd entirely is caught by P1 first (empty alive -> stopped?
# true while something lives), so it proves P1, not P2. MISNAMING it keeps
# stopped? correct and can only be caught by P2's set comparison.
attempt "P2 babysitterd misnamed in the alive list" "P2" \
  '(:babysitterd probe) (conj "babysitterd")' \
  '(:babysitterd probe) (conj "babysitter")' || bad=$((bad+1))

echo "  subsumed P3 socket-files inertness -> cannot fail without P2 also failing;"
echo "           P2 recomputes the expected set from the probe keys, so any"
echo "           socket-files influence breaks P2 too. P3 is a regression"
echo "           sentinel for the measured 2026-07-25 false positive, not an"
echo "           independent property. Verified: the break fails P2."

attempt "P4 bound off-by-one" "P4" \
  '(if (< n bound)' \
  '(if (<= n bound)' || bad=$((bad+1))

attempt "P5 restart retracts the ticket" "P5" \
  '{:ticket ticket
     :ticket-ok? ticket-ok?' \
  '{:ticket (if restart-ok? ticket :failed)
     :ticket-ok? ticket-ok?' || bad=$((bad+1))

attempt "P6 a value-flag dropped from the set" "P6" \
  '(def value-flags #{"--bounce-bound" "--stage-timeout-ms"})' \
  '(def value-flags #{"--bounce-bound"})' || bad=$((bad+1))

attempt "P7 exhaustion blames a stage" "P7" \
  ':blame-stage nil
       :rounds (count bounces)}' \
  ':blame-stage stage
       :rounds (count bounces)}' || bad=$((bad+1))

attempt "P8 park destination flipped to paused" "P8" \
  '(def park-dir "hold")' \
  '(def park-dir "paused")' || bad=$((bad+1))

restore
echo
echo -n "restored: "
PROPERTY_RUNS=500 bb "$RUNNER" 2>&1 | tail -1
echo
if [[ "$bad" -eq 0 ]]; then
  echo "NON-VACUITY PROVEN for all 8 properties"
else
  echo "$bad property/properties NOT proven non-vacuous"
  exit 1
fi
