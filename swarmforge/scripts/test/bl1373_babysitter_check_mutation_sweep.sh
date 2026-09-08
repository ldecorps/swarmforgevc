#!/usr/bin/env bash
# BL-1373 hardener: mutation sweep over babysitter_check.bb's cache key fix.
#
# WHY THIS EXISTS. The fix adds qa-paths to the cache key in
# gather-pipeline-code-on-main-cached (babysitter_check.bb:665-693). There is no
# mutation tool wired for Babashka code (engineering.prompt Startup Tools), so
# the gate is built here rather than declared satisfied. Each mutation is a
# single surgical edit that a correct suite MUST reject. A SURVIVOR is a real
# test gap, not a curiosity.
#
# The property tests (bl1373PathSetCacheInvariants.property.test.js) encode both
# declared invariants and should reject every mutant that reverts the fix.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB=swarmforge/scripts/babysitter_check.bb
PROP=extension/test/bl1373PathSetCacheInvariants.property.test.js

# Back up the WORKING COPY, not HEAD.
BACKUP="$(mktemp)"
cp "$LIB" "$BACKUP"
restore() { cp "$BACKUP" "$LIB"; }
cleanup() { restore; rm -f "$BACKUP"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0
declare -a SURVIVORS=()
declare -a SKIPPED=()

# mutate <label> <from> <to>
mutate() {
  local label="$1" from="$2" to="$3"
  restore
  if ! python3 - "$LIB" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
if a not in s:
    sys.exit(3)
open(p, 'w').write(s.replace(a, b, 1))
PY
  then
    echo "  skip     $label (anchor not found)"
    SKIPPED+=("$label")
    skipped=$((skipped + 1)); return
  fi

  echo "  mutant   $label"
  # Run the property tests - they should reject the mutant
  if (cd extension && npm run test:properties -- test/bl1373PathSetCacheInvariants.property.test.js >/dev/null 2>&1); then
    echo "  SURVIVED $label"
    SURVIVORS+=("$label")
    survived=$((survived + 1))
  else
    echo "  killed   $label"
    killed=$((killed + 1))
  fi
}

echo "BL-1373 mutation sweep: babysitter_check.bb cache key fix"
echo "============================================================"

# Mutant 1: Remove the qa-paths binding entirely
mutate "remove-qa-paths-binding" \
  "qa-paths (qa-exclusive-paths)" \
  ""

# Mutant 2: Remove the qa-paths check from the cache hit condition
mutate "remove-qa-paths-from-cache-hit" \
  "(and cached (= tips (:tips cached)) (= qa-paths (:qa-paths cached)) (some? (:result cached)))" \
  "(and cached (= tips (:tips cached)) (some? (:result cached)))"

# Mutant 3: Remove qa-paths from the cache write
mutate "remove-qa-paths-from-cache-write" \
  "{:tips tips :qa-paths qa-paths :result result}" \
  "{:tips tips :result result}"

# Mutant 4: Change the equality check to not-equal (inverted logic)
mutate "invert-qa-paths-equality" \
  "(= qa-paths (:qa-paths cached))" \
  "(not= qa-paths (:qa-paths cached))"

# Mutant 5: Check the wrong field name in the cache
mutate "wrong-cache-field-name" \
  "(:qa-paths cached)" \
  "(:qa-path cached)"

restore

echo ""
echo "mutants: killed=$killed survived=$survived skipped=$skipped"

if [[ "${#SURVIVORS[@]}" -gt 0 ]]; then
  echo ""
  echo "SURVIVORS:"
  for s in "${SURVIVORS[@]}"; do
    echo "  - $s"
  done
  exit 1
fi

if [[ $skipped -gt 0 ]]; then
  echo ""
  echo "SKIPPED (anchor not found - code may have changed):"
  for s in "${SKIPPED[@]}"; do
    echo "  - $s"
  done
  echo ""
  echo "WARNING: skipped mutants mean the sweep is stale. Re-anchor to current code."
  exit 1
fi

echo ""
echo "ALL MUTANTS KILLED"
exit 0
