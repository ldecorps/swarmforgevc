#!/usr/bin/env bash
# BL-1162 hardener: surgical mutation over root-scoped cron registry + lifecycle wiring.
# Soft Gherkin inapplicable (no Scenario Outline).
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CRON_LIB=swarmforge/scripts/swarmforge_cron_lib.sh
LEGACY_BB=swarmforge/scripts/legacy_operator_schedule_lib.bb
UNINSTALL=swarmforge/scripts/uninstall_swarmforge_crons.sh
STOP_SWARM=stop-swarm.sh
WIRING=(
  bash swarmforge/scripts/test/bl1162_swarmforge_cron_property_runner.sh
  bash swarmforge/scripts/test/test_bl1162_start_stop_swarm_cron_lifecycle.sh
)
APS=(bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1162-start-stop-swarm-cron-lifecycle-symmetry.feature)

BACKUP_CRON="$(mktemp)"
BACKUP_LEGACY="$(mktemp)"
BACKUP_UNINSTALL="$(mktemp)"
BACKUP_STOP="$(mktemp)"
cp "$CRON_LIB" "$BACKUP_CRON"
cp "$LEGACY_BB" "$BACKUP_LEGACY"
cp "$UNINSTALL" "$BACKUP_UNINSTALL"
cp "$STOP_SWARM" "$BACKUP_STOP"
restore() {
  cp "$BACKUP_CRON" "$CRON_LIB"
  cp "$BACKUP_LEGACY" "$LEGACY_BB"
  cp "$BACKUP_UNINSTALL" "$UNINSTALL"
  cp "$BACKUP_STOP" "$STOP_SWARM"
}
cleanup() { restore; rm -f "$BACKUP_CRON" "$BACKUP_LEGACY" "$BACKUP_UNINSTALL" "$BACKUP_STOP" /tmp/bl1162_from.txt /tmp/bl1162_to.txt; }
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
a = Path('/tmp/bl1162_from.txt').read_text()
b = Path('/tmp/bl1162_to.txt').read_text()
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
  printf '%s' "$1" > /tmp/bl1162_from.txt
  printf '%s' "$2" > /tmp/bl1162_to.txt
}

echo "mutation sweep over swarmforge cron lifecycle (BL-1162)"

# BL-1382 (human ruling, marker-only ownership): the operator-path clause
# this mutant targeted - `[[ "$line" == *"$root/.swarmforge/operator/"* ]]` -
# was DELETED from swarmforge_cron_line_belongs_to_root, not moved or
# renamed. Path-based ownership of an unmarked line is the exact defect
# class BL-1382 exists to end (it erased a hand-installed schedule
# overnight), so there is no equivalent behavior left to re-anchor this
# mutant to. Retired here (hardener, BL-1382 pass) rather than left
# silently "skip"ped - BL-1382's own dedicated suites
# (test_bl1382_unmarked_cron_lines_survive.sh,
# test_bl1382_cron_ownership_agreement.sh, and the property test) now cover
# marker-only ownership directly and far more thoroughly than this sweep
# ever did.

write_pair \
  '  [[ "$line" == *"$freshness_marker"* ]] && return 0' \
  '  : # freshness marker check removed'
mutate_file "$CRON_LIB" "cron lib drops freshness marker ownership"

write_pair \
  '    if swarmforge_cron_line_belongs_to_root "$line" "$root"; then
      continue
    fi' \
  '    if swarmforge_cron_line_belongs_to_root "$line" "$root"; then
      printf "%s\n" "$line"
      continue
    fi'
mutate_file "$CRON_LIB" "filter_out_root keeps root lines instead of dropping"

write_pair \
  '       :stop-script (str operator "/day-shift-bedtime.sh")}' \
  '       :stop-script (str operator "/day-shift-start.sh")}'
mutate_file "$LEGACY_BB" "legacy day-only maps stop to start script"

write_pair \
  '       (resolve-legacy-schedule root))))' \
  '       false))))'
mutate_file "$LEGACY_BB" "scheduling-enabled ignores legacy operator conf"

write_pair \
  'filtered="$(printf '"'"'%s\n'"'"' "$existing" | swarmforge_cron_filter_out_root "$ROOT")"' \
  'filtered="$existing"'
mutate_file "$UNINSTALL" "uninstall skips root filter"

write_pair \
  'if ! bash "$UNINSTALL_CRON" "$TARGET"; then' \
  'if false; then'
mutate_file "$STOP_SWARM" "stop-swarm skips cron uninstall"

echo "mutants: killed=$killed survived=$survived skipped=$skipped"
if [[ "$survived" -gt 0 ]]; then exit 1; fi
if [[ "$skipped" -gt 0 ]]; then exit 1; fi
echo "ALL MUTANTS KILLED"
exit 0
