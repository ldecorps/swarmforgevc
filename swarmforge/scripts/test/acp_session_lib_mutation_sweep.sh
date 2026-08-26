#!/usr/bin/env bash
# BL-1081 hardener: hand-authored mutation sweep over acp_session_lib.bb.
#
# Babashka has no Stryker/CRAP/DRY wiring (engineering.prompt Startup Tools).
# BL-638 also makes Gherkin soft mutation inapplicable for this feature (plain
# Scenario: only — zero Examples cells). Same posture as
# expedite_mutation_sweep.sh: each edit is a real defect a correct suite must
# reject.

set -uo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LIB=swarmforge/scripts/acp_session_lib.bb
UNIT=swarmforge/scripts/test/acp_session_lib_test_runner.bb
AGREE=swarmforge/scripts/test/bl1081_acp_snapshot_agreement_test_runner.bb

BACKUP="$(mktemp)"
cp "$LIB" "$BACKUP"
restore() { cp "$BACKUP" "$LIB"; }
cleanup() { restore; rm -f "$BACKUP"; }
trap cleanup EXIT

killed=0; survived=0; skipped=0
declare -a SURVIVORS=()

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

  if ! bb "$UNIT" >/dev/null 2>&1; then
    echo "  killed   $label (unit)"; killed=$((killed + 1)); return
  fi
  if ! bb "$AGREE" >/dev/null 2>&1; then
    echo "  killed   $label (agreement)"; killed=$((killed + 1)); return
  fi
  echo "  SURVIVED $label"
  SURVIVORS+=("$label")
  survived=$((survived + 1))
}

echo "mutation sweep over $LIB"

# ── snapshot presence / acp gate ───────────────────────────────────────────
mutate "read-snapshot: drop :acp true gate" \
  '(when (and (map? m) (true? (:acp m))) m)' \
  '(when (map? m) m)'
mutate "acp-hosted?: true? -> some?" \
  '(boolean (and snapshot (true? (:acp snapshot))))' \
  '(boolean (and snapshot (:acp snapshot)))'
mutate "menu-check-applies?: not hosted -> always true" \
  '(not (acp-hosted? snapshot))' \
  'true'
mutate "menu-check-applies?: not hosted -> always false" \
  '(not (acp-hosted? snapshot))' \
  'false'

# ── idle / stop-reason ─────────────────────────────────────────────────────
mutate "stop-reason: blank guard dropped" \
  '(when-not (str/blank? (str v)) v)' \
  'v'
mutate "idle-decision: idle? true? -> boolean" \
  '{:idle? (true? (:idle snapshot))' \
  '{:idle? (boolean (:idle snapshot))'
mutate "idle-decision: from default unknown -> pane" \
  '(or (:idleFrom snapshot) "unknown")' \
  '(or (:idleFrom snapshot) "pane")'
mutate "idle-decision: skip acp-hosted? gate" \
  '(when (acp-hosted? snapshot)
    {:idle? (true? (:idle snapshot))
     :from (or (:idleFrom snapshot) "unknown")})' \
  '{:idle? (true? (:idle snapshot))
     :from (or (:idleFrom snapshot) "unknown")}'

# ── permission ─────────────────────────────────────────────────────────────
mutate "permission-pending?: drop hosted? gate" \
  '(boolean (and (acp-hosted? snapshot) (true? (:permissionPending snapshot))))' \
  '(boolean (true? (:permissionPending snapshot)))'
mutate "permission-pending?: true? -> boolean" \
  '(boolean (and (acp-hosted? snapshot) (true? (:permissionPending snapshot))))' \
  '(boolean (and (acp-hosted? snapshot) (:permissionPending snapshot)))'

# ── facts / apply ──────────────────────────────────────────────────────────
mutate "acp-seat-facts: idle-from pane label flipped" \
  ':idle-from (if hosted? (:from idle) "pane")' \
  ':idle-from (if hosted? (:from idle) "unknown")'
mutate "apply-acp-facts: stop-reason disagreement becomes silent" \
  '(when-not (= actual reason)
      (throw (ex-info "BL-1081: the caller'\''s stop reason disagrees with the seat snapshot"
                      {:snapshot-stop-reason actual :caller-stop-reason reason})))' \
  'nil'
mutate "apply-acp-facts: merge dropped — return assess-input alone" \
  '(merge assess-input (acp-seat-facts snapshot) {:stop-reason reason})' \
  'assess-input'
mutate "snapshot-path: role suffix dropped" \
  '(fs/path project-root ".swarmforge" "acp" (str role ".json"))' \
  '(fs/path project-root ".swarmforge" "acp" "seat.json")'

echo
echo "killed=$killed survived=$survived skipped=$skipped"
if (( survived > 0 )); then
  echo "SURVIVORS:"
  printf '  %s\n' "${SURVIVORS[@]}"
  exit 1
fi
exit 0
