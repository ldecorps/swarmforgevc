#!/usr/bin/env bash
# BL-1185 hardener: surgical mutation over ready_for_next_task Work-note attribution.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

TARGET=swarmforge/scripts/ready_for_next_task.bb
BACKUP="$(mktemp)"
cp "$TARGET" "$BACKUP"
restore() { cp "$BACKUP" "$TARGET"; }
cleanup() { restore; rm -f "$BACKUP" /tmp/bl1185_from.txt /tmp/bl1185_to.txt; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd extension && npx vitest run --config vitest.properties.config.mjs test/bl1185WorkNoteMissingTaskHeader.property.test.js >/dev/null 2>&1); then return 0; fi
  if ! (bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1185-work-note-missing-task-header-defers-hard-seat.feature >/dev/null 2>&1); then return 0; fi
  return 1
}

mutate_file() {
  local label="$1"
  restore
  if ! python3 - <<'PY'
from pathlib import Path
a = Path('/tmp/bl1185_from.txt').read_text()
b = Path('/tmp/bl1185_to.txt').read_text()
s = Path('swarmforge/scripts/ready_for_next_task.bb').read_text()
if a not in s:
    raise SystemExit(3)
Path('swarmforge/scripts/ready_for_next_task.bb').write_text(s.replace(a, b, 1))
PY
  then echo "  skip     $label"; skipped=$((skipped + 1)); return; fi
  if suite_fails; then echo "  killed   $label"; killed=$((killed + 1)); return; fi
  echo "  SURVIVED $label"; survived=$((survived + 1))
}

write_pair() {
  python3 -c 'import pathlib,sys; pathlib.Path("/tmp/bl1185_from.txt").write_text(sys.argv[1]); pathlib.Path("/tmp/bl1185_to.txt").write_text(sys.argv[2])' "$1" "$2"
}

echo "mutation sweep over Work-note difficulty attribution (BL-1185)"

write_pair 'cost (mutation-cost-for-task (task-name-for-difficulty handoff-file))' \
  'cost (mutation-cost-for-task (handoff-lib/header-field handoff-file "task"))'
mutate_file "Work notes without task: lose mutation_cost attribution"

write_pair '(or (not-empty (handoff-lib/header-field handoff-file "task"))
      (try
        (supersede-lib/task-name-from-content (slurp (str handoff-file)))
        (catch Exception _ nil)))' \
  '(not-empty (handoff-lib/header-field handoff-file "task"))'
mutate_file "task-name-for-difficulty drops Work BL message parse"

write_pair '(load-file (str (fs/path (fs/parent *file*) "supersede_lib.bb")))' \
  ';; (load-file supersede_lib.bb) surgically removed'
mutate_file "supersede_lib load removed (Work BL parse unavailable)"

write_pair 'cost (mutation-cost-for-task (task-name-for-difficulty handoff-file))' \
  'cost 0'
mutate_file "mutation_cost always zero (hard seat never needed)"

write_pair '(filter (fn [[f _]] (difficulty-allows-claim? f tiers)))' \
  '(filter (fn [[f _]] (not (difficulty-allows-claim? f tiers))))'
mutate_file "difficulty gate polarity inverted"

echo "summary: killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]] || exit 1
[[ "$skipped" -eq 0 ]] || exit 1
[[ "$killed" -eq 5 ]] || exit 1
