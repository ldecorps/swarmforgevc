#!/usr/bin/env bash
# BL-1159 hardener: surgical mutation over stop defer + recover routing guards.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
STOP_SRC=swarmforge/scripts/stop_bridge_headless.sh
RECOVER_SRC=swarmforge/scripts/recover_miniapp_bridge.sh
WIRING=(
  bash swarmforge/scripts/test/test_recover_miniapp_bridge.sh
  bash swarmforge/scripts/test/test_start_stop_bridge_headless.sh
  bash swarmforge/scripts/test/test_bl1159_bridge_child_survives_without_crash_giveup_loop.sh
)
APS=(bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1159-bridge-child-survives-without-crash-giveup-loop.feature)

BACKUP_STOP="$(mktemp)"
BACKUP_RECOVER="$(mktemp)"
cp "$STOP_SRC" "$BACKUP_STOP"
cp "$RECOVER_SRC" "$BACKUP_RECOVER"
restore() { cp "$BACKUP_STOP" "$STOP_SRC"; cp "$BACKUP_RECOVER" "$RECOVER_SRC"; }
cleanup() { restore; rm -f "$BACKUP_STOP" "$BACKUP_RECOVER" /tmp/bl1159_from.txt /tmp/bl1159_to.txt; }
trap cleanup EXIT

killed=0; survived=0; skipped=0

suite_fails() {
  if ! "${WIRING[@]}" >/dev/null 2>&1; then return 0; fi
  if ! "${APS[@]}" >/dev/null 2>&1; then return 0; fi
  return 1
}

mutate_file() {
  local file="$1" label="$2"
  restore
  if ! python3 - "$file" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
a = Path('/tmp/bl1159_from.txt').read_text()
b = Path('/tmp/bl1159_to.txt').read_text()
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
  printf '%s' "$1" > /tmp/bl1159_from.txt
  printf '%s' "$2" > /tmp/bl1159_to.txt
}

echo "mutation sweep over stop defer + recover routing (BL-1159)"

write_pair \
  '    exit 0
  fi
fi

stopped=0' \
  '  fi
fi

stopped=0'
mutate_file "$STOP_SRC" "stop_bridge_headless drops early exit when front desk live"

write_pair \
  '    exec bash "$SCRIPT_DIR/rearm_front_desk_bridge.sh" "$ROOT" "$PORT"' \
  '    exec bash "$SCRIPT_DIR/bounce_bridge_headless.sh" "$ROOT" "$PORT"'
mutate_file "$RECOVER_SRC" "recover_miniapp_bridge routes live front desk to bounce"

write_pair \
  'exec bash "$SCRIPT_DIR/bounce_bridge_headless.sh" "$ROOT" "$PORT"' \
  'exec bash "$SCRIPT_DIR/rearm_front_desk_bridge.sh" "$ROOT" "$PORT"'
mutate_file "$RECOVER_SRC" "recover_miniapp_bridge routes dead stack to rearm"

write_pair \
  '  if [[ "$fd_pid" =~ ^[0-9]+$ ]] && kill -0 "$fd_pid" 2>/dev/null; then' \
  '  if [[ "$fd_pid" =~ ^[0-9]+$ ]] && false; then'
mutate_file "$STOP_SRC" "stop_bridge_headless ignores live front-desk pid"

echo "mutants: killed=$killed survived=$survived skipped=$skipped"
if [[ "$survived" -gt 0 ]]; then exit 1; fi
if [[ "$skipped" -gt 0 ]]; then exit 1; fi
echo "ALL MUTANTS KILLED"
exit 0
