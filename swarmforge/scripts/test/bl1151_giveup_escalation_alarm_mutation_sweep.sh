#!/usr/bin/env bash
# BL-1151 hardener: surgical mutation over give-up-escalation-alarm-when-not-gave-up.
# Soft Gherkin inapplicable (no Scenario Outline).
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC=swarmforge/scripts/operator_lib.bb
PROP=(bb swarmforge/scripts/test/bl1151_giveup_escalation_alarm_property_runner.bb)
UNIT=(bb swarmforge/scripts/test/operator_lib_test_runner.bb)
INT=(bash swarmforge/scripts/test/test_front_desk_giveup_one_email_per_episode.sh)

BACKUP="$(mktemp)"
cp "$SRC" "$BACKUP"
restore() { cp "$BACKUP" "$SRC"; }
cleanup() { restore; rm -f "$BACKUP"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! "${PROP[@]}" >/dev/null 2>&1; then return 0; fi
  if ! "${UNIT[@]}" 2>&1 | rg -q 'ALL TESTS PASSED'; then return 0; fi
  if ! "${INT[@]}" >/dev/null 2>&1; then return 0; fi
  return 1
}

mutate() {
  local label="$1"
  restore
  if ! python3 - "$SRC" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
s = p.read_text()
a = Path('/tmp/bl1151_from.txt').read_text()
b = Path('/tmp/bl1151_to.txt').read_text()
if a not in s:
    sys.exit(3)
p.write_text(s.replace(a, b, 1))
PY
  then echo "  skip     $label"; skipped=$((skipped + 1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed + 1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived + 1))
}

write_pair() {
  python3 -c "open('/tmp/bl1151_from.txt','w').write($1); open('/tmp/bl1151_to.txt','w').write($2)"
}

echo "mutation sweep over give-up-escalation-alarm-when-not-gave-up (BL-1151)"

write_pair \
  "r'(if (and (:armed? prev-alarm) (not healthy-reset?))'" \
  "r'(if (and (:armed? prev-alarm) healthy-reset?))'"
mutate "healthy-reset polarity inverted"

write_pair \
  "r'(if (and (:armed? prev-alarm) (not healthy-reset?))'" \
  "r'(if (or (:armed? prev-alarm) (not healthy-reset?))'"
mutate "armed AND not-grace -> OR"

write_pair \
  "r'(select-keys prev-alarm [:armed? :delivery-attempts :last-attempt-at-ms])'" \
  "r'({:armed? false :delivery-attempts 0 :last-attempt-at-ms nil})'"
mutate "keep-armed branch returns disarmed reset"

python3 - <<'PY'
from pathlib import Path
a = """  (if (and (:armed? prev-alarm) (not healthy-reset?))
    (select-keys prev-alarm [:armed? :delivery-attempts :last-attempt-at-ms])
    {:armed? false :delivery-attempts 0 :last-attempt-at-ms nil}))"""
b = """  (if (and (:armed? prev-alarm) (not healthy-reset?))
    (select-keys prev-alarm [:armed? :delivery-attempts :last-attempt-at-ms])
    {:armed? true :delivery-attempts 0 :last-attempt-at-ms nil}))"""
open('/tmp/bl1151_from.txt','w').write(a)
open('/tmp/bl1151_to.txt','w').write(b)
PY
mutate "else branch arms instead of disarm"

write_pair \
  "r'[:armed? :delivery-attempts :last-attempt-at-ms]'" \
  "r'[:delivery-attempts :last-attempt-at-ms]'"
mutate "select-keys drops :armed?"

echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]]
