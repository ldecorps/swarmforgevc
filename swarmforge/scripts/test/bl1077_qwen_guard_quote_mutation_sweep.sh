#!/usr/bin/env bash
# BL-1077 hardener: hand-mutation sweep over the qwen_guard quote shape in
# swarmforge.sh (QA bounce 20260823).
#
# Shell has no Stryker lane. The invariant test is the gate; each mutant below
# is a single edit a correct suite MUST reject. A SURVIVOR is a real gap.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TARGET=swarmforge/scripts/swarmforge.sh
UNIT=swarmforge/scripts/test/test_qwen_credential_name_invariant.sh

BACKUP="$(mktemp)"
cp "$TARGET" "$BACKUP"
restore() { cp "$BACKUP" "$TARGET"; }
cleanup() { restore; rm -f "$BACKUP"; }
trap cleanup EXIT

killed=0
survived=0
declare -a SURVIVORS=()

run_unit() {
  bash "$UNIT" >/dev/null 2>&1
}

record() {
  local label="$1" status="$2"
  if [[ "$status" == killed ]]; then
    echo "  killed   $label"
    killed=$((killed + 1))
  else
    echo "  SURVIVED $label"
    SURVIVORS+=("$label")
    survived=$((survived + 1))
  fi
}

echo "mutation sweep over $TARGET (qwen_guard quote / shared prefix)"

# M1: pre-fix broken ANSI-C nesting, no shared prefix
restore
python3 - "$TARGET" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text().replace(
    '  local qwen_guard=""\n  local qwen_lib_source=""\n',
    '  local qwen_guard=""\n',
    1,
)
start = s.find('  # Qwen Token Plan (SEA)')
end = s.find('  if [[ "$agent" == "claude" ]]; then', start)
broken = r'''  # Qwen Token Plan (SEA) — same zshenv-override posture as Cerebras.
  if [[ "$extra_cli" == *token-plan.ap-southeast-1.maas.aliyuncs.com* || "$extra_cli" == *dashscope.aliyuncs.com* ]]; then
    qwen_guard=$'source \''"$SCRIPT_DIR"'/qwen_launch_guard_lib.sh\'\nqwen_guard_require_token_plan_endpoint || exit 1\n'
  else
    qwen_guard=$'source \''"$SCRIPT_DIR"'/qwen_launch_guard_lib.sh\'\nqwen_guard_map_if_flagged\n'
  fi
'''
p.write_text(s[:start] + broken + s[end:])
PY
if run_unit; then record "M1-broken-ansi-c-nesting" survived; else record "M1-broken-ansi-c-nesting" killed; fi

# M2: broken nesting inside the shared assignment only
restore
python3 - "$TARGET" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
good = 'qwen_lib_source="source \'${SCRIPT_DIR}/qwen_launch_guard_lib.sh\'"'
bad = 'qwen_lib_source=$\'source \\\'\'"$SCRIPT_DIR"\'/qwen_launch_guard_lib.sh\\\''
if good not in s:
    raise SystemExit('M2 anchor missing')
p.write_text(s.replace(good, bad, 1))
PY
if run_unit; then record "M2-broken-assignment" survived; else record "M2-broken-assignment" killed; fi

# M3: keep shared assignment but both branches ignore it (dead prefix)
restore
python3 - "$TARGET" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
s = s.replace(
    'qwen_guard="${qwen_lib_source}"$\'\\nqwen_guard_require_token_plan_endpoint || exit 1\\n\'',
    'qwen_guard="source \'${SCRIPT_DIR}/qwen_launch_guard_lib.sh\'"$\'\\nqwen_guard_require_token_plan_endpoint || exit 1\\n\'',
    1,
)
s = s.replace(
    'qwen_guard="${qwen_lib_source}"$\'\\nqwen_guard_map_if_flagged\\n\'',
    'qwen_guard="source \'${SCRIPT_DIR}/qwen_launch_guard_lib.sh\'"$\'\\nqwen_guard_map_if_flagged\\n\'',
    1,
)
p.write_text(s)
PY
if run_unit; then record "M3-dead-shared-prefix" survived; else record "M3-dead-shared-prefix" killed; fi

# M4: safe dual-inline without shared variable (cleaner-intent regression)
restore
python3 - "$TARGET" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text().replace(
    '  local qwen_guard=""\n  local qwen_lib_source=""\n',
    '  local qwen_guard=""\n',
    1,
)
start = s.find('  # Qwen Token Plan (SEA)')
end = s.find('  if [[ "$agent" == "claude" ]]; then', start)
safe_dual = r'''  # Qwen Token Plan (SEA) — same zshenv-override posture as Cerebras.
  if [[ "$extra_cli" == *token-plan.ap-southeast-1.maas.aliyuncs.com* || "$extra_cli" == *dashscope.aliyuncs.com* ]]; then
    qwen_guard="source '${SCRIPT_DIR}/qwen_launch_guard_lib.sh'"$'\nqwen_guard_require_token_plan_endpoint || exit 1\n'
  else
    qwen_guard="source '${SCRIPT_DIR}/qwen_launch_guard_lib.sh'"$'\nqwen_guard_map_if_flagged\n'
  fi
'''
p.write_text(s[:start] + safe_dual + s[end:])
PY
if run_unit; then record "M4-safe-dual-no-shared-var" survived; else record "M4-safe-dual-no-shared-var" killed; fi

# M5: dummy prefix name + broken nesting (prefix grep alone is not enough)
restore
python3 - "$TARGET" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
start = s.find('  # Qwen Token Plan (SEA)')
end = s.find('  if [[ "$agent" == "claude" ]]; then', start)
broken = r'''  # Qwen Token Plan (SEA) — same zshenv-override posture as Cerebras.
  qwen_lib_source="unused"
  if [[ "$extra_cli" == *token-plan.ap-southeast-1.maas.aliyuncs.com* || "$extra_cli" == *dashscope.aliyuncs.com* ]]; then
    qwen_guard=$'source \''"$SCRIPT_DIR"'/qwen_launch_guard_lib.sh\'\nqwen_guard_require_token_plan_endpoint || exit 1\n'
  else
    qwen_guard=$'source \''"$SCRIPT_DIR"'/qwen_launch_guard_lib.sh\'\nqwen_guard_map_if_flagged\n'
  fi
'''
p.write_text(s[:start] + broken + s[end:])
PY
if run_unit; then record "M5-dummy-prefix-broken-nesting" survived; else record "M5-dummy-prefix-broken-nesting" killed; fi

restore
echo "summary killed=$killed survived=$survived"
if (( survived > 0 )); then
  printf 'SURVIVORS:\n'
  printf '  %s\n' "${SURVIVORS[@]}"
  exit 1
fi
exit 0
