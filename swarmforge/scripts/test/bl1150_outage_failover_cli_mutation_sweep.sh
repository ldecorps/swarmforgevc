#!/usr/bin/env bash
# BL-1150 hardener: surgical mutation over outage_failover_cli.bb entrypoint guard.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB=swarmforge/scripts/outage_failover_cli.bb
HARNESS=(bb swarmforge/scripts/test/test_outage_failover_cli_load_file_safe.bb)
UNIT=(node --test extension/test/bl1150OutageFailoverCliLoadFileSafe.test.js)
PROP=(node --test extension/test/bl1150OutageFailoverCliLoadFileSafe.property.test.js)

BACKUP="$(mktemp)"
cp "$LIB" "$BACKUP"
restore() { cp "$BACKUP" "$LIB"; }
cleanup() { restore; rm -f "$BACKUP"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! "${HARNESS[@]}" >/dev/null 2>&1; then return 0; fi
  if ! "${UNIT[@]}" >/dev/null 2>&1; then return 0; fi
  if ! "${PROP[@]}" >/dev/null 2>&1; then return 0; fi
  return 1
}

mutate() {
  local label="$1" from="$2" to="$3"
  restore
  if ! python3 - "$LIB" "$from" "$to" <<'PY'
import sys
p,a,b=sys.argv[1],sys.argv[2],sys.argv[3]
s=open(p).read()
if a not in s: sys.exit(3)
open(p,'w').write(s.replace(a,b,1))
PY
  then echo "  skip     $label"; skipped=$((skipped+1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed+1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived+1))
}

echo "mutation sweep over $LIB (BL-1150)"
mutate "drop babashka.file guard (bare -main)" \
  '(when (= *file* (System/getProperty "babashka.file"))
  (-main))' \
  '(-main)'
mutate "guard equality flipped" \
  '(when (= *file* (System/getProperty "babashka.file"))' \
  '(when (not= *file* (System/getProperty "babashka.file"))'
mutate "property name typo'd so guard never matches" \
  '"babashka.file"' \
  '"babashka.fil"'
echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]]
