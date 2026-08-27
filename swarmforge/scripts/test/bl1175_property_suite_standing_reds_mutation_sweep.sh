#!/usr/bin/env bash
# BL-1175 hardener: surgical mutation over standing-red allowlist + drift guard.
# Soft Gherkin inapplicable (no Scenario Outline) — BL-638 hand-authored sweep.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

FILES=(
  swarmforge/scripts/property_suite_standing_allowlist_lib.sh
  swarmforge/scripts/check_property_suite_drift.sh
)
BACKUP_ROOT="$(mktemp -d)"
for f in "${FILES[@]}"; do
  mkdir -p "$BACKUP_ROOT/$(dirname "$f")"
  cp "$f" "$BACKUP_ROOT/$f"
done

restore() {
  for f in "${FILES[@]}"; do cp "$BACKUP_ROOT/$f" "$f"; done
}
cleanup() { restore; rm -rf "$BACKUP_ROOT" /tmp/bl1175_from.txt /tmp/bl1175_to.txt; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

# Unit shell must not inherit recovery SKIP (would vacuate every mutant).
suite_fails() {
  if ! env -u SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD \
      bash swarmforge/scripts/test/test_property_suite_drift_guard.sh >/dev/null 2>&1; then
    return 0
  fi
  if ! (cd extension && npx vitest run --config vitest.properties.config.mjs \
      test/bl1175PropertySuiteStandingRedsInvariants.property.test.js >/dev/null 2>&1); then
    return 0
  fi
  if ! bash specs/pipeline/scripts/run_acceptance.sh \
      specs/features/BL-1175-property-suite-standing-reds-block-unrelated-commits.feature \
      >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

mutate_file() {
  local file="$1" label="$2"
  restore
  if ! python3 - "$file" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
a = Path('/tmp/bl1175_from.txt').read_text()
b = Path('/tmp/bl1175_to.txt').read_text()
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
  python3 -c 'import pathlib,sys; pathlib.Path("/tmp/bl1175_from.txt").write_text(sys.argv[1]); pathlib.Path("/tmp/bl1175_to.txt").write_text(sys.argv[2])' "$1" "$2"
}

LIB=swarmforge/scripts/property_suite_standing_allowlist_lib.sh
GUARD=swarmforge/scripts/check_property_suite_drift.sh

echo "mutation sweep over BL-1175 standing-red allowlist"

write_pair \
  'file="${file#extension/}"
  file="${file#./}"' \
  'file="${file#./}"'
mutate_file "$LIB" "normalize drops extension/ strip"

write_pair \
  '$1 == target && $2 == "allowlist" { found = 1 }' \
  '$1 == target && $2 == "fix" { found = 1 }'
mutate_file "$LIB" "allowlist disposition never matches"

write_pair \
  "if (( \${#files[@]} == 0 )); then
    return 1
  fi" \
  "if (( \${#files[@]} == 0 )); then
    return 0
  fi"
mutate_file "$LIB" "empty failure list treated as all-allowlisted"

write_pair \
  "grep -E '^ FAIL  (test/|extension/test/)' \\" \
  "grep -E '^ FAIL  (never/)' \\"
mutate_file "$LIB" "extract never parses vitest FAIL lines"

write_pair \
  'if (( ALLOWLIST_OK == 0 )); then
    echo "property-suite-guard: allowlisted-standing-reds; unrelated green commits not refused (BL-1175)" >&2
    exit 0
  fi' \
  'if (( ALLOWLIST_OK != 0 )); then
    echo "property-suite-guard: allowlisted-standing-reds; unrelated green commits not refused (BL-1175)" >&2
    exit 0
  fi'
mutate_file "$GUARD" "allowlist success branch inverted"

write_pair \
  'if [[ -n "$ALLOWLIST_TSV" && -f "$ALLOWLIST_TSV" ]]; then
    UNLISTED="$(ps_suite_failures_all_allowlisted "$ALLOWLIST_TSV" "$OUT")"
    ALLOWLIST_OK=$?
  fi' \
  'if [[ -n "$ALLOWLIST_TSV" && -f "$ALLOWLIST_TSV" ]]; then
    UNLISTED=""
    ALLOWLIST_OK=1
  fi'
mutate_file "$GUARD" "allowlist check always fails closed without consulting TSV"

write_pair \
  'if [[ -f "$SCRIPT_DIR/property_suite_standing_allowlist_lib.sh" ]]; then
  # shellcheck source=property_suite_standing_allowlist_lib.sh
  source "$SCRIPT_DIR/property_suite_standing_allowlist_lib.sh"
  ALLOWLIST_TSV="$(ps_allowlist_tsv_path "$SCRIPT_DIR")"
fi' \
  'if false; then
  # shellcheck source=property_suite_standing_allowlist_lib.sh
  source "$SCRIPT_DIR/property_suite_standing_allowlist_lib.sh"
  ALLOWLIST_TSV="$(ps_allowlist_tsv_path "$SCRIPT_DIR")"
fi'
mutate_file "$GUARD" "standing allowlist lib never sourced"

echo "summary: killed=$killed survived=$survived skipped=$skipped"
[[ "$survived" -eq 0 ]] || exit 1
[[ "$skipped" -eq 0 ]] || exit 1
