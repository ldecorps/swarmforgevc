#!/usr/bin/env bash
# BL-1098 hardener: hand-authored mutation sweep over push_sweep_lib.bb
# silent-revert predicates (Babashka — no Stryker).
#
# Gherkin soft mutation covers the Scenario Outline Examples cells; this sweep
# covers the .bb decision surface the Outline cannot see.

set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB=swarmforge/scripts/push_sweep_lib.bb
UNIT=swarmforge/scripts/test/push_sweep_lib_test_runner.bb
PROP=swarmforge/scripts/test/push_sweep_lib_property_runner.bb

BACKUP="$(mktemp)"
cp "$LIB" "$BACKUP"
restore() { cp "$BACKUP" "$LIB"; }
cleanup() { restore; rm -f "$BACKUP"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0
declare -a SURVIVORS=()

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
    skipped=$((skipped + 1)); return
  fi
  if bb "$UNIT" >/dev/null 2>&1; then
    echo "  SURVIVED $label"
    SURVIVORS+=("$label")
    survived=$((survived + 1))
  else
    echo "  killed   $label (unit)"
    killed=$((killed + 1))
  fi
}

echo "mutation sweep over $LIB (silent-revert)"

mutate "silent-revert-path?: drop not-matches-newest gate" \
  '(boolean (and (not tip-matches-newest-authoring?)
                (or tip-is-superseded-resurrection?
                    tip-absent-without-delete?)))' \
  '(boolean (or tip-is-superseded-resurrection?
                    tip-absent-without-delete?))'

mutate "silent-revert-path?: drop superseded arm of or" \
  '(or tip-is-superseded-resurrection?
                    tip-absent-without-delete?)' \
  'tip-absent-without-delete?'

mutate "silent-revert-path?: drop absent arm of or" \
  '(or tip-is-superseded-resurrection?
                    tip-absent-without-delete?)' \
  'tip-is-superseded-resurrection?'

mutate "silent-revert-path?: invert matches-newest (cry wolf on clean tips)" \
  '(not tip-matches-newest-authoring?)' \
  'tip-matches-newest-authoring?'

mutate "silent-revert-decision: reason keyword flipped to noop-landing-merge" \
  '(filterv silent-revert-path? candidate-paths)
   :silent-revert
   (fn [h] {:path (:path h)' \
  '(filterv silent-revert-path? candidate-paths)
   :noop-landing-merge
   (fn [h] {:path (:path h)'

mutate "silent-revert-decision: drop facts-complete? fail-closed" \
  '(gate-hits-decision
   facts-complete?
   (filterv silent-revert-path? candidate-paths)' \
  '(gate-hits-decision
   true
   (filterv silent-revert-path? candidate-paths)'

mutate "silent-revert-decision: offending omits path" \
  '{:path (:path h)
            :newest-authoring-sha (:newest-authoring-sha h)
            :divergence-merge-sha (:divergence-merge-sha h)}' \
  '{:newest-authoring-sha (:newest-authoring-sha h)
            :divergence-merge-sha (:divergence-merge-sha h)}'

mutate "silent-revert-candidate-paths: invent a full-tree sentinel path" \
  '(vec (sort (into #{} (mapcat (fn [ps] (or (:paths ps) [])) merge-path-sets))))' \
  '(vec (sort (into #{"__full_tree__"} (mapcat (fn [ps] (or (:paths ps) [])) merge-path-sets))))'

mutate "silent-revert-candidate-paths: drop set-dedup (duplicates survive)" \
  '(vec (sort (into #{} (mapcat (fn [ps] (or (:paths ps) [])) merge-path-sets))))' \
  '(vec (sort (mapcat (fn [ps] (or (:paths ps) [])) merge-path-sets)))'

echo
echo "killed=$killed survived=$survived skipped=$skipped"
if (( survived > 0 )); then
  echo "SURVIVORS:"
  printf '  %s\n' "${SURVIVORS[@]}"
  # Non-vacuity: property runner should still hold on a clean lib
  restore
  bb "$PROP" >/dev/null
  exit 1
fi
restore
bb "$PROP" >/dev/null
exit 0
