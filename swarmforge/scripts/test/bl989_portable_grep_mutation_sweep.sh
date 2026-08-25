#!/usr/bin/env bash
# BL-989 hardender: surgical mutation over portable tab-anchor helpers.
#
# Soft Gherkin on BL-343 is separate; this locks the three named shell sites
# so GNU `grep -P` cannot return unnoticed (BL-638 hand surgical).
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

FILES=(
  swarmforge/scripts/test/test_role_lifecycle_cli.sh
  swarmforge/scripts/test/test_backlog_depth_pack_override.sh
  swarmforge/scripts/test/test_coordinator_provider_configurable.sh
)
PROP=(node --test specs/pipeline/test/bl989PortableGrepTabAnchor.property.test.js)
LIFE=(bash swarmforge/scripts/test/test_role_lifecycle_cli.sh)

killed=0; survived=0; skipped=0
declare -a SURVIVORS=()
declare -a BACKUPS=()

for f in "${FILES[@]}"; do
  b="$(mktemp)"
  cp "$f" "$b"
  BACKUPS+=("$b")
done

restore_all() {
  local i=0
  for f in "${FILES[@]}"; do
    cp "${BACKUPS[$i]}" "$f"
    i=$((i + 1))
  done
}
cleanup() { restore_all; rm -f "${BACKUPS[@]}"; }
trap cleanup EXIT

suite_fails() {
  if ! "${PROP[@]}" >/dev/null 2>&1; then return 0; fi
  if ! "${LIFE[@]}" >/dev/null 2>&1; then return 0; fi
  return 1
}

mutate_file() {
  local file="$1" label="$2" from="$3" to="$4"
  restore_all
  if ! python3 - "$file" "$from" "$to" <<'PY'
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

echo "mutation sweep over BL-989 portable grep sites"

mutate_file "${FILES[0]}" "lifecycle has: restore GNU -qP" \
  'roles_tsv_has() { grep -q "$(printf '\''^%s\t'\'' "$2")" "$1/.swarmforge/roles.tsv"; }' \
  'roles_tsv_has() { grep -qP "^$2\t" "$1/.swarmforge/roles.tsv"; }'

mutate_file "${FILES[0]}" "lifecycle lacks: restore GNU -qP" \
  'roles_tsv_lacks() { ! grep -q "$(printf '\''^%s\t'\'' "$2")" "$1/.swarmforge/roles.tsv"; }' \
  'roles_tsv_lacks() { ! grep -qP "^$2\t" "$1/.swarmforge/roles.tsv"; }'

mutate_file "${FILES[1]}" "backlog_depth: restore GNU -P" \
  'grep "$(printf '\''^%s\t'\'' "$key")" "$file" | head -1 | cut -f2-' \
  'grep -P "^${key}\t" "$file" | head -1 | cut -f2-'

mutate_file "${FILES[2]}" "coordinator: restore GNU -P" \
  'COORDINATOR_ROW="$(grep "$(printf '\''^coordinator\t'\'')" "$ROLES_TSV" || true)"' \
  'COORDINATOR_ROW="$(grep -P '\''^coordinator\t'\'' "$ROLES_TSV" || true)"'

mutate_file "${FILES[0]}" "lifecycle has: drop tab from printf" \
  'roles_tsv_has() { grep -q "$(printf '\''^%s\t'\'' "$2")" "$1/.swarmforge/roles.tsv"; }' \
  'roles_tsv_has() { grep -q "$(printf '\''^%s'\'' "$2")" "$1/.swarmforge/roles.tsv"; }'

mutate_file "${FILES[0]}" "lifecycle lacks: drop tab from printf" \
  'roles_tsv_lacks() { ! grep -q "$(printf '\''^%s\t'\'' "$2")" "$1/.swarmforge/roles.tsv"; }' \
  'roles_tsv_lacks() { ! grep -q "$(printf '\''^%s'\'' "$2")" "$1/.swarmforge/roles.tsv"; }'

mutate_file "${FILES[1]}" "backlog_depth: drop tab from printf" \
  'grep "$(printf '\''^%s\t'\'' "$key")" "$file" | head -1 | cut -f2-' \
  'grep "$(printf '\''^%s'\'' "$key")" "$file" | head -1 | cut -f2-'

echo
echo "killed=$killed survived=$survived skipped=$skipped"
if (( survived > 0 )); then
  echo "SURVIVORS:"
  printf '  - %s\n' "${SURVIVORS[@]}"
  exit 1
fi
exit 0
