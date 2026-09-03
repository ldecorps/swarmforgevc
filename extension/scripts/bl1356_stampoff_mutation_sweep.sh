#!/usr/bin/env bash
# BL-1356 hardener: surgical mutation sweep over extension/test/helpers/stampOff.js.
# No mutation tool covers this file: Stryker's --mutate scopes out/**/*.js
# (compiled extension/src only), and this is a test HELPER under
# extension/test/helpers/. Each mutant is a single edit the helper's own
# unit test (extension/test/bl1356StampOffHelper.test.js) and the property
# test (full state x write cross product) must reject.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER=test/helpers/stampOff.js
UNIT=test/bl1356StampOffHelper.test.js
PROP_CONFIG=vitest.properties.config.mjs
PROP_NAME=bl1356StampOffInvariants

BACKUP="$(mktemp)"
cp "$HELPER" "$BACKUP"
restore() { cp "$BACKUP" "$HELPER"; }
cleanup() { restore; rm -f "$BACKUP"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0
declare -a SURVIVORS=()
declare -a SKIPPED=()

mutate() {
  local label="$1" from="$2" to="$3"
  restore
  if ! python3 - "$HELPER" "$from" "$to" <<'PY'
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
  if ! npx vitest run "$UNIT" >/dev/null 2>&1; then
    echo "  killed   $label (unit)"; killed=$((killed+1)); return
  fi
  if ! npx vitest run --config "$PROP_CONFIG" "$PROP_NAME" >/dev/null 2>&1; then
    echo "  killed   $label (property)"; killed=$((killed+1)); return
  fi
  echo "  SURVIVED $label"
  SURVIVORS+=("$label"); survived=$((survived+1))
}

echo "mutation sweep over $HELPER"

mutate "hotfixRow: missing-row check dropped" \
  "assert.notEqual(start, -1, \`no hotfix-ledger row for \${hotfix}\`);" \
  "// removed"
mutate "hotfixRow: end-of-row ternary inverted" \
  "return end === -1 ? rest : rest.slice(0, end);" \
  "return end === -1 ? rest.slice(0, end) : rest;"
mutate "DECISION_MARKERS.state: certified|waived narrowed to certified only" \
  "state: /state:\s*(certified|waived)\b/," \
  "state: /state:\s*(certified)\b/,"
mutate "DECISION_MARKERS.human_decision: negative lookahead dropped (null now counts as decided)" \
  "human_decision: /human_decision:\s*(?!null\b)\S+/," \
  "human_decision: /human_decision:\s*\S+/,"
mutate "DECISION_MARKERS.decided_at: negative lookahead dropped" \
  "decided_at: /decided_at:\s*(?!null\b)\S+/," \
  "decided_at: /decided_at:\s*\S+/,"
mutate "assertRunWritesNoDecision: per-field introduced-decision check inverted" \
  "!(after[field] && !before[field])" \
  "!(before[field] && !after[field])"
mutate "assertRunWritesNoDecision: per-field check weakened to always-true" \
  "!(after[field] && !before[field])" \
  "true"
mutate "assertRunWritesNoDecision: row-equality assertion dropped" \
  "assert.equal(
    afterRow,
    beforeRow,
    \`the run changed \${hotfix}'s hotfix-ledger row:\n--- before\n\${beforeRow}\n--- after\n\${afterRow}\`
  );" \
  "// removed"
mutate "assertRunWritesNoDecision: whole-file-equality assertion dropped" \
  "assert.equal(afterLedger, beforeLedger, \`the run changed \${path.basename(ledgerPath)}\`);" \
  "// removed"
mutate "assertParcelDoesNotEditReviewedSources: --first-parent dropped (merge second-parent content misattributed)" \
  "['show', '--first-parent', '--name-only', '--format=', sha]" \
  "['show', '--name-only', '--format=', sha]"
mutate "assertParcelDoesNotEditReviewedSources: includes() inverted" \
  "!changed.includes(reviewed)" \
  "changed.includes(reviewed)"
mutate "findTicketYaml: prefix match dropped (any file starting anywhere could match)" \
  "entry.name.startsWith(\`\${ticketId}-\`) && entry.name.endsWith('.yaml')" \
  "entry.name.endsWith('.yaml')"

echo "----"
echo "mutants: killed=$killed survived=$survived skipped=$skipped"
if [ "$survived" -gt 0 ]; then
  echo "SURVIVORS:"; printf '  %s\n' "${SURVIVORS[@]}"
  exit 1
fi
if [ "$skipped" -gt 0 ]; then
  echo "SKIPPED (stale anchors, unrun):"; printf '  %s\n' "${SKIPPED[@]}"
fi
echo "ALL MUTANTS KILLED"
