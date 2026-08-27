#!/usr/bin/env bash
# BL-731 hardener: surgical mutation sweep over multiworktreeAcceptanceFixture.js
# Gherkin mutator inapplicable (no Scenario Outline). Stryker vitest runner does not
# execute node:test suites for these files.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/extension"
TARGET=out/tools/multiworktreeAcceptanceFixture.js
UNIT="node --test test/multiworktreeAcceptanceFixture.test.js test/pilotAcceptanceGate.test.js test/pilotAcceptanceGate.property.test.js"

BACKUP="$(mktemp)"
cp "$TARGET" "$BACKUP"
restore() { cp "$BACKUP" "$TARGET"; }
cleanup() { restore; rm -f "$BACKUP"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0
declare -a SURVIVORS=()
declare -a SKIPPED=()

mutate() {
  local label="$1" from="$2" to="$3"
  restore
  if ! python3 - "$TARGET" "$from" "$to" <<'PY'
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
  if ! $UNIT >/dev/null 2>&1; then
    echo "  killed   $label"; killed=$((killed + 1)); return
  fi
  echo "  SURVIVED $label"
  SURVIVORS+=("$label")
  survived=$((survived + 1))
}

echo "mutation sweep over $TARGET"

mutate "worktreeCount >= 2 -> >= 3" \
  'distinctWorktrees.length >= 2 && siblingHandoffdRoots.length >= 1' \
  'distinctWorktrees.length >= 3 && siblingHandoffdRoots.length >= 1'
mutate "siblingHandoffdRoots >= 1 -> >= 2" \
  'distinctWorktrees.length >= 2 && siblingHandoffdRoots.length >= 1' \
  'distinctWorktrees.length >= 2 && siblingHandoffdRoots.length >= 2'
mutate "filter pilot root from siblings dropped" \
  '(root) => root !== normalizedPilot' '(root) => true'
mutate "lifecycle regex: lifecycle -> lifecyclex" \
  'lifecycle|teardown' \
  'lifecyclex|teardown'
mutate "handoffd regex matches supervisor path" \
  'handoffd\.bb\s+' \
  'handoffd[^ ]+\.bb\s+'
mutate "MULTIWORKTREE_REQUIRED_REFUSAL emptied" \
  'single-worktree-only acceptance is insufficient for lifecycle/teardown tickets' \
  'acceptance ok'
mutate "required_wiring script regex dropped" \
  'LIFECYCLE_TEARDOWN_RE.test(entry) && LIFECYCLE_SCRIPT_WIRING_RE.test(entry)' \
  'LIFECYCLE_TEARDOWN_RE.test(entry)'

echo ""
echo "mutants: killed=$killed survived=$survived skipped=$skipped"
if [[ "${#SURVIVORS[@]}" -gt 0 ]]; then
  printf '  survivors: %s\n' "${SURVIVORS[@]}"
  exit 1
fi
if [[ "$skipped" -gt 0 ]]; then
  printf '  skipped: %s\n' "${SKIPPED[@]}"
  exit 1
fi
echo "ALL MUTANTS KILLED"
exit 0
