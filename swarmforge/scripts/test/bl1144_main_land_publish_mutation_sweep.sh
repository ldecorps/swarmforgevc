#!/usr/bin/env bash
# BL-1144 hardener: surgical mutation over master_main_reconcile_lib.bb
# and land_main_publish.sh.
#
# Soft Gherkin is BL-638 inapplicable (plain Scenarios). Each mutant is a
# single edit the unit runner + APS suite must reject.
set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB=swarmforge/scripts/master_main_reconcile_lib.bb
LAND=swarmforge/scripts/land_main_publish.sh
UNIT=swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb
LAND_UNIT=swarmforge/scripts/test/land_main_publish_test_runner.sh
FEATURE=specs/features/BL-1144-frequent-qa-push-races-on-main-land.feature
ACCEPT=(bash specs/pipeline/scripts/run_acceptance.sh "$FEATURE")

BACKUP_LIB="$(mktemp)"
BACKUP_LAND="$(mktemp)"
cp "$LIB" "$BACKUP_LIB"
cp "$LAND" "$BACKUP_LAND"

restore_lib() { cp "$BACKUP_LIB" "$LIB"; }
restore_land() { cp "$BACKUP_LAND" "$LAND"; }
cleanup() { restore_lib; restore_land; rm -f "$BACKUP_LIB" "$BACKUP_LAND"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0
declare -a SURVIVORS=()

unit_fails() {
  if ! bb "$UNIT" >/dev/null 2>&1; then return 0; fi
  if ! bash "$LAND_UNIT" >/dev/null 2>&1; then return 0; fi
  return 1
}
accept_fails() { ! "${ACCEPT[@]}" >/dev/null 2>&1; }

mutate_lib() {
  local label="$1" from="$2" to="$3"
  restore_lib
  if ! python3 - "$LIB" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
if a not in s:
    sys.exit(3)
open(p, 'w').write(s.replace(a, b, 1))
PY
  then
    echo "  skip     $label (lib anchor not found)"
    skipped=$((skipped + 1)); return
  fi
  if unit_fails || accept_fails; then
    echo "  killed   $label"
    killed=$((killed + 1)); return
  fi
  echo "  SURVIVED $label"
  SURVIVORS+=("$label")
  survived=$((survived + 1))
}

mutate_land() {
  local label="$1" from="$2" to="$3"
  restore_lib
  restore_land
  if ! python3 - "$LAND" "$from" "$to" <<'PY'
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
if a not in s:
    sys.exit(3)
open(p, 'w').write(s.replace(a, b, 1))
PY
  then
    echo "  skip     $label (land anchor not found)"
    skipped=$((skipped + 1)); return
  fi
  if unit_fails || accept_fails; then
    echo "  killed   $label"
    killed=$((killed + 1)); return
  fi
  echo "  SURVIVED $label"
  SURVIVORS+=("$label")
  survived=$((survived + 1))
}

echo "mutation sweep over $LIB + $LAND"

mutate_lib "publish-rematch-max-attempts unbounded (99)" \
  '(def publish-rematch-max-attempts' \
  '(def publish-rematch-max-attempts-unbounded'

mutate_lib "peer lock ignored (always push on stale tip)" \
  '    peer-holds-land-lock? :wait-land-lock' \
  '    false :wait-land-lock'

mutate_lib "conflict check skipped (stale tip -> rematch not refuse)" \
  '    rematch-would-conflict? :refuse-rematch-lander' \
  '    false :refuse-rematch-lander'

mutate_lib "lock edge always admits second publisher" \
  '    lock-available? :admit' \
  '    true :admit'

mutate_lib "contention wait-lock does not win" \
  '    :wait-lock :wait-land-lock' \
  '    :wait-lock :rematch-then-push'

mutate_lib "origin-advanced-since-gate always false" \
  '(not= gate-origin-sha publish-origin-sha)' \
  'false'

mutate_land "decide-only uses bb REPL not bb -e" \
  'bb -e "$(cat <<'\''BB'\''' \
  'bb "$(cat <<'\''BB'\'''

mutate_land "tip contains origin check inverted" \
  '  CONTAINS=true' \
  '  CONTAINS=false'

mutate_land "lock-free always true even when lock dir exists" \
  '[[ -d "$LOCK_DIR" ]] && LOCK_FREE=false' \
  '[[ -d "$LOCK_DIR" ]] && LOCK_FREE=true'

echo "---"
echo "surgical killed=$killed survived=$survived skipped=$skipped"
printf 'survivors: %s\n' "${SURVIVORS[*]:-none}"
