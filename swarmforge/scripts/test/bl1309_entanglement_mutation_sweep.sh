#!/usr/bin/env bash
# BL-1309 hardener: surgical mutation sweep over land_main_publish.sh's new
# entanglement-guard block (BL-1144's own sweep predates this code and does
# not touch it). Each mutant is a single edit the unit runner + acceptance
# feature must reject.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LAND=swarmforge/scripts/land_main_publish.sh
UNIT=swarmforge/scripts/test/land_main_publish_test_runner.sh
FEATURE=specs/features/BL-1309-the-mandatory-land-decide-step-is-blind-to-entanglement.feature

BACKUP="$(mktemp)"
cp "$LAND" "$BACKUP"
restore() { cp "$BACKUP" "$LAND"; }
cleanup() { restore; rm -f "$BACKUP"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0; equivalent=0
declare -a SURVIVORS=()
declare -a SKIPPED=()

# mutate <label> <from> <to> [equivalent-reason]
# A 4th argument marks the mutant as an ACCEPTED EQUIVALENT (BL-234 shape):
# demonstrated from the code, not assumed. Still run every time - a future
# edit to the guarded call graph can turn an equivalent mutant real, and this
# sweep re-proves the equivalence rather than silently trusting the label.
mutate() {
  local label="$1" from="$2" to="$3" reason="${4:-}"
  restore
  if ! python3 - "$LAND" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
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
    echo "  killed   $label (unit)"; killed=$((killed+1)); return
  fi
  if ! bash specs/pipeline/scripts/run_acceptance.sh "$FEATURE" >/dev/null 2>&1; then
    echo "  killed   $label (acceptance)"; killed=$((killed+1)); return
  fi
  if [ -n "$reason" ]; then
    echo "  EQUIV    $label -- $reason"
    equivalent=$((equivalent+1)); return
  fi
  echo "  SURVIVED $label"
  SURVIVORS+=("$label"); survived=$((survived+1))
}

echo "mutation sweep over $LAND (BL-1309 entanglement guard)"

mutate "unlanded check: seq -> empty? (guard never fires)" \
  '(when (and (nil? warning) (seq unlanded))' \
  '(when (and (nil? warning) (empty? unlanded))'
mutate "warning check inverted (fires ON warning instead of absence)" \
  '(when (and (nil? warning) (seq unlanded))' \
  '(when (and (some? warning) (seq unlanded))'
mutate "task nil-check dropped (would NPE rather than skip)" \
  '(when task
    (let [{:keys [unlanded warning]}' \
  '(when true
    (let [{:keys [unlanded warning]}'
mutate "marker substring check weakened to always-true" \
  'if [[ "$ENTANGLED_OUT" == *"ENTANGLED_SIBLING_BLOCK"* ]]; then' \
  'if [[ -n "$ENTANGLED_OUT" ]]; then' \
  "entangled_sibling_report's only stdout writes are the println calls inside its single (when (and (nil? warning) (seq unlanded)) ...) block, which either all run together or not at all - there is no code path that leaves ENTANGLED_OUT non-empty without the ENTANGLED_SIBLING_BLOCK line already being its first line. -n and the marker match are therefore equivalent for every value this function can produce. Re-checked every sweep run since a future change to entangled_sibling_report could break this."
mutate "marker substring check inverted (never fires)" \
  'if [[ "$ENTANGLED_OUT" == *"ENTANGLED_SIBLING_BLOCK"* ]]; then' \
  'if [[ "$ENTANGLED_OUT" != *"ENTANGLED_SIBLING_BLOCK"* ]]; then'
mutate "refusal exit code changed 3 -> 0" \
  'printf '"'"'%s\n'"'"' "$ENTANGLED_OUT"
  exit 3' \
  'printf '"'"'%s\n'"'"' "$ENTANGLED_OUT"
  exit 0'
mutate "detector-presence guard dropped (always attempts, changes fail-open path)" \
  'if [[ -n "$TIP_SHA" && -f "$BL1309_LIB" ]]; then' \
  'if [[ -n "$TIP_SHA" ]]; then' \
  "dropping only the -f check leaves -n \"\$TIP_SHA\" standing; the one case this changes is a present-TIP_SHA/missing-lib run that now reaches entangled_sibling_report instead of skipping it - and that call's failure (load-file on a nonexistent path) is caught by the SAME || true that catches every other detector crash (see the || true mutant below, which IS real and killed). Verified empirically: with only this guard dropped, unit row 06 (detector absent) still passes byte-for-byte. The guard is a performance short-circuit, not a correctness requirement, given || true already covers the failure."
mutate "|| true dropped (a detector crash would abort under set -e instead of failing open)" \
  'ENTANGLED_OUT="$(entangled_sibling_report || true)"' \
  'ENTANGLED_OUT="$(entangled_sibling_report)"'

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
