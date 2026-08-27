#!/usr/bin/env bash
# BL-1155 hardener: surgical mutation over pipeline board header width contract.
# Soft Gherkin inapplicable (no Scenario Outline).
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BOARD=extension/src/concierge/pipelineBoard.ts
WIRING=(
  bash -c 'cd extension && npx vitest run test/pipelineBoard.test.js test/bl979PipelineBoardTicketRows.test.js'
  bash -c 'cd extension && npx vitest run --config vitest.properties.config.mjs test/pipelineBoard.property.test.js'
)
APS=(bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1155-pipeline-board-grid-header-one-line.feature)

BACKUP="$(mktemp)"
cp "$BOARD" "$BACKUP"
restore() { cp "$BACKUP" "$BOARD"; (cd extension && npm run compile >/dev/null 2>&1) || true; }
cleanup() { restore; rm -f "$BACKUP" /tmp/bl1155_from.txt /tmp/bl1155_to.txt; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! "${WIRING[@]}" >/dev/null 2>&1; then return 0; fi
  if ! "${APS[@]}" >/dev/null 2>&1; then return 0; fi
  return 1
}

mutate_file() {
  local label="$1"
  restore
  if ! python3 - "$BOARD" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
a = Path('/tmp/bl1155_from.txt').read_text()
b = Path('/tmp/bl1155_to.txt').read_text()
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
  printf '%s' "$1" > /tmp/bl1155_from.txt
  printf '%s' "$2" > /tmp/bl1155_to.txt
}

echo "mutation sweep over pipeline board header width (BL-1155)"

write_pair \
  'export const PIPELINE_BOARD_STAGE_CELL_WIDTH = 2;' \
  'export const PIPELINE_BOARD_STAGE_CELL_WIDTH = 3;'
mutate_file "widen stage cells to 3 (header exceeds phone budget)"

write_pair \
  'return idGutterWidth + stageCount * STAGE_CELL_WIDTH + (stageCount - 1);' \
  'return idGutterWidth + stageCount * STAGE_CELL_WIDTH;'
mutate_file "grid line width omits NBSP separators"

write_pair \
  'PIPELINE_BOARD_COLUMN_ORDER.map((column) => padStartNbsp(cell(column), STAGE_CELL_WIDTH)).join(NBSP);' \
  'PIPELINE_BOARD_COLUMN_ORDER.map((column) => padStartNbsp(cell(column), STAGE_CELL_WIDTH)).join(" ");'
mutate_file "stage header uses ASCII space between cells"

write_pair \
  'export const PIPELINE_BOARD_GRID_MAX_WIDTH = 30;' \
  'export const PIPELINE_BOARD_GRID_MAX_WIDTH = 20;'
mutate_file "shrink max width below composed header"

echo "summary: killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]] || exit 1
