#!/usr/bin/env bash
# BL-669 hardener: surgical mutation over outage_failover_lib.bb needles.
#
# Soft Gherkin is BL-638 inapplicable (plain Scenarios). Each mutant must be
# rejected by outage_failover_test_runner.bb and/or the property test.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB=swarmforge/scripts/outage_failover_lib.bb
PROP=(node --test extension/test/bl669OutageFailoverSteward.property.test.js)

BACKUP="$(mktemp)"
cp "$LIB" "$BACKUP"
restore() { cp "$BACKUP" "$LIB"; }
cleanup() { restore; rm -f "$BACKUP"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0
declare -a SURVIVORS=()

suite_fails() {
  if ! bb swarmforge/scripts/test/outage_failover_test_runner.bb >/dev/null 2>&1; then return 0; fi
  if ! (cd extension && npm run compile >/dev/null 2>&1 && "${PROP[@]}" >/dev/null 2>&1); then return 0; fi
  return 1
}

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
  if suite_fails; then
    echo "  killed   $label"
    killed=$((killed + 1)); return
  fi
  echo "  SURVIVED $label"
  SURVIVORS+=("$label")
  survived=$((survived + 1))
}

echo "mutation sweep over $LIB (BL-669)"

mutate "uncertified override gate removed" \
  ':override-uncertified? false}' \
  ':override-uncertified? true}'

mutate "mid-turn applies instead of defer" \
  '(not seat-idle?) {:action :defer-apply :outage sustained :substitute substitute}' \
  '(not seat-idle?) {:action :apply :outage sustained :substitute substitute}'

mutate "closed outage never triggers revert" \
  '(and swap (swap-outage-id swap) (closed-outage? records (swap-outage-id swap)))' \
  '(and swap (swap-outage-id swap) false)'

mutate "below-threshold still consults" \
  '(nil? sustained) {:action :none :reason :below-threshold-or-closed}' \
  '(false) {:action :none :reason :below-threshold-or-closed}'

mutate "swap-already-active guard dropped" \
  'swap {:action :none :reason :swap-already-active}' \
  'false {:action :none :reason :swap-already-active}'

mutate "attended hours auto-apply instead of propose" \
  'attended? {:action :propose :outage sustained :substitute substitute}' \
  'attended? {:action :apply :outage sustained :substitute substitute}'

mutate "fallback-tagged ranking ignored" \
  '(or (first tagged) (first same-provider) (first survivors))' \
  '(or (first survivors) (first tagged) (first same-provider))'

echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
printf 'survivors: %s\n' "${SURVIVORS[*]:-none}"
