#!/usr/bin/env bash
# BL-1127: local_coder_battery.sh harness seams and evidence artifact shape.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BATTERY="$SCRIPT_DIR/../local_coder_battery.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

TEMP_DIRS=()
cleanup() {
  local d
  for d in "${TEMP_DIRS[@]+"${TEMP_DIRS[@]}"}"; do
    [[ -n "$d" ]] && rm -rf "$d" 2>/dev/null || true
  done
}
trap cleanup EXIT

EVID="$(mktemp -d)"
TEMP_DIRS+=("$EVID")

# 01: --result=pass writes dated artifact under override dir, exit 0
OUT="$(LOCAL_CODER_BATTERY_EVIDENCE_DIR="$EVID" bash "$BATTERY" --result=pass)"
echo "$OUT" | grep -q 'RESULT=pass' || fail "01: expected RESULT=pass; got $OUT"
EVPATH="$(echo "$OUT" | sed -n 's/^EVIDENCE=//p')"
[[ -f "$EVPATH" ]] || fail "01: evidence missing: $EVPATH"
[[ "$EVPATH" == "$EVID"/* ]] || fail "01: evidence not under override dir"
basename "$EVPATH" | grep -q 'BL-1127-coder-battery-' || fail "01: bad basename"
pass "01: --result=pass writes evidence under LOCAL_CODER_BATTERY_EVIDENCE_DIR"

# 02: --result=fail exits nonzero and stays ineligible for staffing
set +e
OUT="$(LOCAL_CODER_BATTERY_EVIDENCE_DIR="$EVID" bash "$BATTERY" --result=fail 2>&1)"
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "02: fail must exit nonzero"
echo "$OUT" | grep -q 'RESULT=fail' || fail "02: expected RESULT=fail"
pass "02: --result=fail exits nonzero"

# 03: env FORCE_RESULT alias still works (APS compatibility)
OUT="$(LOCAL_CODER_BATTERY_EVIDENCE_DIR="$EVID" LOCAL_CODER_BATTERY_FORCE_RESULT=pass bash "$BATTERY")"
echo "$OUT" | grep -q 'RESULT=pass' || fail "03: FORCE_RESULT=pass alias broken"
pass "03: LOCAL_CODER_BATTERY_FORCE_RESULT alias still works"

# 04: invalid forced result exits 2
set +e
LOCAL_CODER_BATTERY_EVIDENCE_DIR="$EVID" bash "$BATTERY" --result=maybe >/dev/null 2>&1
RC=$?
set -e
[[ "$RC" -eq 2 ]] || fail "04: invalid --result must exit 2; got $RC"
pass "04: invalid --result exits 2"

# 05: harness pass artifact lists claim/edit/test/handoff phases
EVPATH="$(LOCAL_CODER_BATTERY_EVIDENCE_DIR="$EVID" bash "$BATTERY" --result=pass | sed -n 's/^EVIDENCE=//p')"
grep -q 'phase=claim' "$EVPATH" || fail "05: missing claim phase"
grep -q 'phase=edit' "$EVPATH" || fail "05: missing edit phase"
grep -q 'phase=test' "$EVPATH" || fail "05: missing test phase"
grep -q 'phase=handoff' "$EVPATH" || fail "05: missing handoff phase"
pass "05: evidence lists claim/edit/test/handoff phases"

GATE="$SCRIPT_DIR/../local_coder_battery_staffing_gate.sh"
ROOT="$(mktemp -d)"
TEMP_DIRS+=("$ROOT")
mkdir -p "$ROOT/backlog/evidence" "$ROOT/swarmforge/scripts"
cp "$GATE" "$ROOT/swarmforge/scripts/"
cp "$SCRIPT_DIR/../model_steward_lib.bb" "$ROOT/swarmforge/scripts/"

# 06: staffing gate refuses fail evidence
FAIL_EV="$ROOT/backlog/evidence/BL-1127-coder-battery-ollama-qwen-fail.md"
printf '# x\n\n- result: fail\n' >"$FAIL_EV"
set +e
LOCAL_CODER_BATTERY_EVIDENCE_PATH="$FAIL_EV" bash "$ROOT/swarmforge/scripts/local_coder_battery_staffing_gate.sh" "$ROOT" >/dev/null 2>&1
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "06: fail evidence must refuse staffing"
pass "06: staffing gate refuses fail evidence"

# 07: staffing gate accepts pass evidence
PASS_EV="$ROOT/backlog/evidence/BL-1127-coder-battery-ollama-qwen-pass.md"
printf '# x\n\n- result: pass\n' >"$PASS_EV"
LOCAL_CODER_BATTERY_EVIDENCE_PATH="$PASS_EV" bash "$ROOT/swarmforge/scripts/local_coder_battery_staffing_gate.sh" "$ROOT" >/dev/null
pass "07: staffing gate accepts pass evidence"

# 08: absent evidence refuses
set +e
env -u LOCAL_CODER_BATTERY_EVIDENCE_PATH bash "$ROOT/swarmforge/scripts/local_coder_battery_staffing_gate.sh" "$ROOT" >/dev/null 2>&1
RC=$?
set -e
# newest under dir may be fail — use empty dir
EMPTY="$(mktemp -d)"
TEMP_DIRS+=("$EMPTY")
mkdir -p "$EMPTY/backlog/evidence" "$EMPTY/swarmforge/scripts"
cp "$GATE" "$EMPTY/swarmforge/scripts/"
cp "$SCRIPT_DIR/../model_steward_lib.bb" "$EMPTY/swarmforge/scripts/"
set +e
bash "$EMPTY/swarmforge/scripts/local_coder_battery_staffing_gate.sh" "$EMPTY" >/dev/null 2>&1
RC=$?
set -e
[[ "$RC" -ne 0 ]] || fail "08: absent evidence must refuse staffing"
pass "08: staffing gate refuses absent evidence"

echo "ALL PASS"
