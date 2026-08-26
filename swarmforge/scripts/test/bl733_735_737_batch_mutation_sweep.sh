#!/usr/bin/env bash
# BL-733/735/737 hardener: surgical mutation over pure gate modules (BL-638 fallback).
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

killed=0; survived=0; skipped=0

mutate() {
  local file="$1" label="$2" from="$3" to="$4"
  local backup
  backup="$(mktemp)"
  cp "$file" "$backup"
  if ! python3 - "$file" "$from" "$to" <<'PY'
import sys
p,a,b=sys.argv[1],sys.argv[2],sys.argv[3]
s=open(p).read()
if a not in s: sys.exit(3)
open(p,'w').write(s.replace(a,b,1))
PY
  then
    echo "  skip     $label"; skipped=$((skipped+1)); cp "$backup" "$file"; return
  fi
  if (cd extension && npm run compile >/dev/null 2>&1) && node --test \
    extension/test/bl733ProducerCrosscheck.property.test.js \
    extension/test/bl735PilotAcceptanceExecution.property.test.js \
    extension/test/crossFileDuplicationCheck.property.test.js \
    extension/test/crossFileDuplicationCheck.test.js \
    >/dev/null 2>&1; then
    echo "  SURVIVED $label"; survived=$((survived+1))
  else
    echo "  killed   $label"; killed=$((killed+1))
  fi
  cp "$backup" "$file"
  rm -f "$backup"
}

echo "BL-733 producerCrosscheckAcceptance.ts"
mutate extension/src/tools/producerCrosscheckAcceptance.ts \
  'exhaustive gate drops valuesChecked' \
  'metadata.valuesChecked >= metadata.outputSpaceSize' \
  'metadata.valuesChecked > metadata.outputSpaceSize'
mutate extension/src/tools/producerCrosscheckAcceptance.ts \
  'exhaustive conjunction to disjunction' \
  'metadata.exhaustive &&
    metadata.outputSpaceSize > 0 &&
    metadata.valuesChecked >= metadata.outputSpaceSize' \
  'metadata.exhaustive ||
    metadata.outputSpaceSize > 0 ||
    metadata.valuesChecked >= metadata.outputSpaceSize'

echo "BL-735 pilotAcceptanceExecution.ts"
mutate extension/src/tools/pilotAcceptanceExecution.ts \
  'reland notes AND to OR' \
  'return { satisfied: explainsRevert && explainsReland };' \
  'return { satisfied: explainsRevert || explainsReland };'
mutate extension/src/tools/pilotAcceptanceExecution.ts \
  'execution equality flipped' \
  'return executedFeature !== undefined && executedFeature === featureFilePath;' \
  'return executedFeature !== undefined && executedFeature !== featureFilePath;'

echo "BL-737 crossFileDuplicationCheck.ts"
mutate extension/src/tools/crossFileDuplicationCheck.ts \
  'threshold >2 relaxed to >1' \
  'if (holders.size > 2)' \
  'if (holders.size > 1)'
mutate extension/src/tools/crossFileDuplicationCheck.ts \
  'min block lines raised' \
  'export const MIN_DUPLICATION_BLOCK_LINES = 12;' \
  'export const MIN_DUPLICATION_BLOCK_LINES = 13;'

echo "---"
echo "batch surgical killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]]
