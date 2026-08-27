#!/usr/bin/env bash
# BL-738 hardener: surgical mutation over chunkingPropertyProbe.
# Soft Gherkin inapplicable (no Scenario Outline) — BL-638 hand-authored sweep.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

BACKUP_ROOT="$(mktemp -d)"
FILES=(
  extension/test/helpers/chunkingPropertyProbe.js
)
for f in "${FILES[@]}"; do
  mkdir -p "$BACKUP_ROOT/$(dirname "$f")"
  cp "$f" "$BACKUP_ROOT/$f"
done

restore() {
  for f in "${FILES[@]}"; do cp "$BACKUP_ROOT/$f" "$f"; done
}
cleanup() { restore; rm -rf "$BACKUP_ROOT" /tmp/bl738_from.txt /tmp/bl738_to.txt /tmp/bl738_target.txt; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd extension && npx vitest run --config vitest.properties.config.mjs test/cursorBridgeLive.property.test.js -t 'splitTelegramChunks' >/dev/null 2>&1); then return 0; fi
  if ! (bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-738-chunking-property-reaches-the-split-boundary.feature >/dev/null 2>&1); then return 0; fi
  return 1
}

mutate_file() {
  local label="$1" target="$2"
  restore
  printf '%s' "$target" > /tmp/bl738_target.txt
  if ! python3 - <<'PY'
from pathlib import Path
target = Path('/tmp/bl738_target.txt').read_text().strip()
a = Path('/tmp/bl738_from.txt').read_text()
b = Path('/tmp/bl738_to.txt').read_text()
s = Path(target).read_text()
if a not in s:
    raise SystemExit(3)
Path(target).write_text(s.replace(a, b, 1))
PY
  then echo "  skip     $label"; skipped=$((skipped + 1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed + 1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived + 1))
}

write_pair() {
  python3 -c 'import pathlib,sys; pathlib.Path("/tmp/bl738_from.txt").write_text(sys.argv[1]); pathlib.Path("/tmp/bl738_to.txt").write_text(sys.argv[2])' "$1" "$2"
}

echo "mutation sweep over chunking property probe (BL-738)"

write_pair 'const CHUNKING_PROPERTY_MAX_LEN = 50;' 'const CHUNKING_PROPERTY_MAX_LEN = 500;'
mutate_file "maxLen above generator never splits" extension/test/helpers/chunkingPropertyProbe.js

write_pair 'fc.string({ minLength: 51, maxLength: 200 })' 'fc.string({ minLength: 1, maxLength: 40 })'
mutate_file "generator stays under maxLen (vacuous)" extension/test/helpers/chunkingPropertyProbe.js

write_pair 'sawMultiChunk = true;' 'sawMultiChunk = false;'
mutate_file "sawMultiChunk never records" extension/test/helpers/chunkingPropertyProbe.js

write_pair "assert.equal(chunks.join(''), text);" 'assert.equal(true, true);'
mutate_file "lossless reassembly assert dropped" extension/test/helpers/chunkingPropertyProbe.js

write_pair 'return chunks.map((chunk, index) => (index === 0 ? chunk : chunk.slice(1)));' 'return chunks;'
mutate_file "broken split no longer drops continuation" extension/test/helpers/chunkingPropertyProbe.js

echo "summary: killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]] || exit 1
[[ "$skipped" -eq 0 ]] || exit 1
