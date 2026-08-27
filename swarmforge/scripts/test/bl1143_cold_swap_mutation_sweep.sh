#!/usr/bin/env bash
# BL-1143 hardender: surgical mutation over cold_swap_day_shift_to_ollama_qwen.sh.
#
# Soft Gherkin is BL-638 inapplicable (plain Scenarios). Each mutant is a
# single edit the unit runner + APS suite must reject.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB=swarmforge/scripts/cold_swap_day_shift_to_ollama_qwen.sh
UNIT=(bash swarmforge/scripts/test/cold_swap_day_shift_to_ollama_qwen_test_runner.sh)
FEATURE=specs/features/BL-1143-cold-swap-day-shift-ollama-qwen.feature
ACCEPT=(bash specs/pipeline/scripts/run_acceptance.sh "$FEATURE")

BACKUP="$(mktemp)"
cp "$LIB" "$BACKUP"
restore() { cp "$BACKUP" "$LIB"; }
cleanup() { restore; rm -f "$BACKUP"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0
declare -a SURVIVORS=()

suite_fails() {
  if ! "${UNIT[@]}" >/dev/null 2>&1; then return 0; fi
  if ! "${ACCEPT[@]}" >/dev/null 2>&1; then return 0; fi
  return 1
}

mutate() {
  local label="$1" from="$2" to="$3"
  restore
  if ! python3 - "$LIB" "$from" "$to" <<'PY'
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

echo "mutation sweep over $LIB"

mutate "TARGET_PACK becomes qwen-forge" \
  'TARGET_PACK=ollama-qwen3-mono-router' \
  'TARGET_PACK=qwen-forge'

mutate "forbidden check inverted (always refuse mono)" \
  'if bl1142_is_forbidden_substitute_pack "$TARGET_PACK"; then' \
  'if ! bl1142_is_forbidden_substitute_pack "$TARGET_PACK"; then'

mutate "align allow-list drops no-winner-yet" \
  "OUTCOME=(aligned|no-winner-yet)" \
  "OUTCOME=(aligned)"

mutate "verify mode still runs execute kill" \
  'if [[ "$MODE" == "--verify" ]]; then
  echo "BL-1143: VERIFY OK (no live cut-over)"
  exit 0
fi' \
  'if [[ "$MODE" == "--never-verify" ]]; then
  echo "BL-1143: VERIFY OK (no live cut-over)"
  exit 0
fi'

mutate "day_shift_pack writes cursor-forge" \
  'printf '\''%s\n'\'' "$TARGET_PACK" > "$DAY_SHIFT_FILE"' \
  'printf '\''%s\n'\'' "cursor-forge" > "$DAY_SHIFT_FILE"'

mutate "evidence claims qwen_forge launched" \
  'echo "- qwen_forge: not launched"' \
  'echo "- qwen_forge: launched"'

echo
echo "killed=$killed survived=$survived skipped=$skipped"
if (( survived > 0 )); then
  echo "SURVIVORS:"
  printf '  - %s\n' "${SURVIVORS[@]}"
  exit 1
fi
exit 0
