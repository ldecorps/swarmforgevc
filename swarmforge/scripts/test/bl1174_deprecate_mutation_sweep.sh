#!/usr/bin/env bash
# BL-1174 hardener: surgical mutation over /deprecate policy/scan/retire.
# Soft Gherkin inapplicable (no Scenario Outline) — BL-638 hand-authored sweep.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

BACKUP_ROOT="$(mktemp -d)"
FILES=(
  extension/src/tools/deprecate/policy.ts
  extension/src/tools/deprecate/scan.ts
  extension/src/tools/deprecate/retire.ts
  extension/src/tools/deprecate/run.ts
)
for f in "${FILES[@]}"; do
  mkdir -p "$BACKUP_ROOT/$(dirname "$f")"
  cp "$f" "$BACKUP_ROOT/$f"
done

restore() {
  for f in "${FILES[@]}"; do cp "$BACKUP_ROOT/$f" "$f"; done
  (cd extension && npm run compile >/dev/null 2>&1) || true
}
cleanup() { restore; rm -rf "$BACKUP_ROOT" /tmp/bl1174_from.txt /tmp/bl1174_to.txt /tmp/bl1174_target.txt; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! (cd extension && npm run compile >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && npx vitest run test/deprecate.test.js >/dev/null 2>&1); then return 0; fi
  if ! (cd extension && npx vitest run --config vitest.properties.config.mjs test/deprecate.property.test.js >/dev/null 2>&1); then return 0; fi
  if ! (bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1174-deprecate-operator-verbs-scan-docs.feature >/dev/null 2>&1); then return 0; fi
  return 1
}

mutate_file() {
  local label="$1" target="$2"
  restore
  printf '%s' "$target" > /tmp/bl1174_target.txt
  if ! python3 - <<'PY'
from pathlib import Path
target = Path('/tmp/bl1174_target.txt').read_text().strip()
a = Path('/tmp/bl1174_from.txt').read_text()
b = Path('/tmp/bl1174_to.txt').read_text()
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
  python3 -c 'import pathlib,sys; pathlib.Path("/tmp/bl1174_from.txt").write_text(sys.argv[1]); pathlib.Path("/tmp/bl1174_to.txt").write_text(sys.argv[2])' "$1" "$2"
}

echo "mutation sweep over /deprecate (BL-1174)"

write_pair "return tier === 'hard';" 'return true;'
mutate_file "seatAllowsDeprecate accepts any tier" extension/src/tools/deprecate/policy.ts

write_pair 'if (b.recurrence !== a.recurrence) return b.recurrence - a.recurrence;' 'if (false) return b.recurrence - a.recurrence;'
mutate_file "rank ignores recurrence" extension/src/tools/deprecate/policy.ts

write_pair 'if (hits > 1) continue;' 'if (false) continue;'
mutate_file "orphan scan includes live flags" extension/src/tools/deprecate/scan.ts

write_pair 'if (blown.length > 0) {' 'if (false) {'
mutate_file "envelope refuse never fires" extension/src/tools/deprecate/policy.ts

write_pair "if (item.adjudication === 'human-ask') {" 'if (false) {'
mutate_file "human-ask adjudication ignored" extension/src/tools/deprecate/policy.ts

write_pair "return { action: 'retire', closesTicket: false };" "return { action: 'retire', closesTicket: true };"
mutate_file "adjudicate retire claims closesTicket true" extension/src/tools/deprecate/policy.ts

write_pair \
  'opts.writeFile(confPath, removeConfFlag(conf, opts.subject));' \
  'opts.writeFile(confPath, conf);'
mutate_file "retire leaves conf flag in place" extension/src/tools/deprecate/retire.ts

write_pair \
  'opts.writeFile(indexPath, ensureDeprecatedIndexLink(index, stubPath));' \
  'opts.writeFile(indexPath, index);'
mutate_file "retire skips docs index link" extension/src/tools/deprecate/retire.ts

echo "summary: killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]] || exit 1
[[ "$skipped" -eq 0 ]] || exit 1
