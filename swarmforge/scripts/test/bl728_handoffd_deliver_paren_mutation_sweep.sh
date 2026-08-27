#!/usr/bin/env bash
# BL-728 hardener: surgical mutation over deliver! balance and one-shot log locks.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SRC=swarmforge/scripts/handoffd.bb
WIRING=(bash swarmforge/scripts/test/test_handoffd_one_shot_flags_parse.sh)
APS=(bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-728-handoffd-deliver-paren-verification.feature)

BACKUP="$(mktemp)"
cp "$SRC" "$BACKUP"
restore() { cp "$BACKUP" "$SRC"; }
cleanup() { restore; rm -f "$BACKUP"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! "${WIRING[@]}" >/dev/null 2>&1; then return 0; fi
  if ! "${APS[@]}" >/dev/null 2>&1; then return 0; fi
  return 1
}

mutate() {
  local label="$1"
  restore
  if ! python3 - "$SRC" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
a = Path('/tmp/bl728_from.txt').read_text()
b = Path('/tmp/bl728_to.txt').read_text()
s = p.read_text()
if a not in s:
    sys.exit(3)
p.write_text(s.replace(a, b, 1))
PY
  then echo "  skip     $label"; skipped=$((skipped + 1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed + 1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived + 1))
}

write_pair() {
  printf '%s' "$1" > /tmp/bl728_from.txt
  printf '%s' "$2" > /tmp/bl728_to.txt
}

echo "mutation sweep over handoffd deliver! / one-shot regression lock (BL-728)"

write_pair \
  '(log! "delivered" (str path)))))))))' \
  '(log! "delivered" (str path))))))))'
mutate "deliver! drops one close-paren (BL-611 regression shape)"

write_pair \
  '(log! "poll-once done"))' \
  '(log! "poll-once DONE"))'
mutate "poll-once done log line case flip"

echo "mutants: killed=$killed survived=$survived skipped=$skipped"
if [[ "$survived" -gt 0 ]]; then exit 1; fi
if [[ "$skipped" -gt 0 ]]; then exit 1; fi
echo "ALL MUTANTS KILLED"
exit 0
