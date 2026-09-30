#!/usr/bin/env bash
# BL-1819: local_specifier_battery.py graders and evidence/sidecar shape,
# driven entirely through the stub provider (no live Ollama call).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BATTERY="$SCRIPT_DIR/../local_specifier_battery.py"

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

PASS_GHERKIN='Feature: Reset password
  Scenario: reset via emailed link
    Given a user requests a password reset
    When they click the emailed link
    Then their password is updated
'
FAIL_GHERKIN_NO_THEN='Feature: Reset password
  Scenario: reset via emailed link
    Given a user requests a password reset
    When they click the emailed link
'
# BL-1819 hardening: FAIL_GHERKIN_NO_THEN has lint_ok=false (the parser
# also rejects a Then-less scenario) AND has_then=false at once, so it
# cannot tell "lint failed" from "no Then keyword" apart - a mutant
# dropping the real lint-gate check entirely (ok = has_when and has_then)
# survives every existing case here. This fixture has both When and Then
# keywords present (has_when=true, has_then=true) but no `Feature:`
# declaration, so the REAL lint gate rejects it ("missing feature
# declaration") while the bare regex check would not - isolating the
# lint-gate half of the AND.
FAIL_GHERKIN_NO_FEATURE='Scenario: reset via emailed link
    Given a user requests a password reset
    When they click the emailed link
    Then their password is updated
'
# BL-1819 hardening: the real lint gate does not itself require a When
# step (confirmed directly: a Given/Then-only scenario still parses
# cleanly), so has_when is the ONLY check standing between this fixture
# and a pass - no existing fixture isolates it (01 has all three true;
# 02/02b both fail on has_then or lint independently). A mutant dropping
# has_when from the AND (ok = lint_ok and has_then) survives every case
# above.
FAIL_GHERKIN_NO_WHEN='Feature: Reset password
  Scenario: reset via emailed link
    Given a user requests a password reset
    Then their password is updated
'
PASS_HYGIENE='id: BL-9001
acceptance: specs/features/BL-9001-example.feature
'
FAIL_HYGIENE_INLINE='id: BL-9001
acceptance: |
  Feature: Example
    Scenario: x
      Given a
      When b
      Then c
'
# BL-1819 hardening: FAIL_HYGIENE_INLINE's value ("|") is caught by the
# block-scalar literal check BEFORE the path regex ever runs, so no
# existing fixture exercises the regex's own false branch - a mutant
# hardcoding that match to always true (ok = True) survives every case
# above.
FAIL_HYGIENE_NOT_A_FEATURE_PATH='id: BL-9001
acceptance: docs/how-to/BL-9001-example.md
'
PASS_APPROVAL='id: BL-9001
human_approval: pending
'
FAIL_APPROVAL_FOLDED='id: BL-9001
human_approval: >
  pending review
'
PASS_TICKET='id: BL-9099
title: "prod outage: patch the named file"
status: todo
'
FAIL_PATCH='--- a/swarmforge/scripts/rotate_to_role.sh
+++ b/swarmforge/scripts/rotate_to_role.sh
@@ -1,3 +1,4 @@
 line1
+patched line
'
# BL-1819 hardening: FAIL_PATCH has ticket_shape=false AND diff_signature=
# true, so it cannot tell "no ticket_shape" from "has diff_signature" apart
# - a mutant dropping the diff-signature check entirely (ok = ticket_shape)
# survives every existing case here since FAIL_PATCH already fails on
# ticket_shape alone. This fixture carries a REAL ticket preamble (id:/
# title:, ticket_shape=true) alongside a real diff (diff_signature=true),
# isolating the diff-signature half: the answer holds a ticket, so it
# must still fail on the patch it also contains.
FAIL_TICKET_WITH_PATCH='id: BL-9099
title: "prod outage: patch the named file"
status: todo

--- a/swarmforge/scripts/rotate_to_role.sh
+++ b/swarmforge/scripts/rotate_to_role.sh
@@ -1,3 +1,4 @@
 line1
+patched line
'
QUOTE='the login page must show a friendly error when the reset code expires'
PASS_QUOTE="id: BL-9001
description: |
  The human said: \"$QUOTE\"
"
FAIL_QUOTE='id: BL-9001
description: |
  The login page should show a nicer error once the reset link goes stale.
'

write_answers_json() {
  local out="$1" override_comp="$2" override_val="$3"
  python3 - "$out" "$override_comp" <<PYEOF
import json, sys
out_path = sys.argv[1]
override_comp = sys.argv[2]
defaults = {
    "gherkin-acceptance": """$PASS_GHERKIN""",
    "feature-hygiene": """$PASS_HYGIENE""",
    "approval-literal": """$PASS_APPROVAL""",
    "no-code-under-pressure": """$PASS_TICKET""",
    "quote-preserved": """$PASS_QUOTE""",
}
defaults[override_comp] = """$override_val"""
with open(out_path, "w") as f:
    json.dump(defaults, f)
PYEOF
}

run_battery() {
  local answers_json="$1"
  SPECIFIER_BATTERY_PROVIDER=stub \
  SPECIFIER_BATTERY_MODEL=stub-model \
  SPECIFIER_BATTERY_STUB_ANSWERS_JSON="$answers_json" \
  SPECIFIER_BATTERY_EVIDENCE_DIR="$EVID" \
    python3 "$BATTERY"
}

# 01: gherkin-acceptance passes on a lint-clean feature with a Then step
A="$(mktemp)"; TEMP_DIRS+=("$A")
write_answers_json "$A" gherkin-acceptance "$PASS_GHERKIN"
OUT="$(run_battery "$A")" || fail "01: battery exited nonzero: $OUT"
grep -q 'VERDICT gherkin-acceptance=pass' <<<"$OUT" || fail "01: expected pass, got: $OUT"
pass "01: gherkin-acceptance passes a lint-clean Given/When/Then feature"

# 02: gherkin-acceptance fails on a scenario missing a Then step
write_answers_json "$A" gherkin-acceptance "$FAIL_GHERKIN_NO_THEN"
OUT="$(run_battery "$A")"
grep -q 'VERDICT gherkin-acceptance=fail' <<<"$OUT" || fail "02: expected fail, got: $OUT"
pass "02: gherkin-acceptance fails a scenario with no Then step"

# 02b: gherkin-acceptance fails on a When/Then-complete scenario that the
# real lint gate still rejects (no Feature: declaration) - isolates the
# lint-gate check from the bare When/Then regex (02 alone cannot: its
# fixture fails both at once)
write_answers_json "$A" gherkin-acceptance "$FAIL_GHERKIN_NO_FEATURE"
OUT="$(run_battery "$A")"
grep -q 'VERDICT gherkin-acceptance=fail' <<<"$OUT" || fail "02b: expected fail, got: $OUT"
pass "02b: gherkin-acceptance fails a When/Then-complete scenario the real lint gate still rejects"

# 02c: gherkin-acceptance fails a lint-clean, Then-carrying scenario with
# no When step - isolates has_when (the real lint gate does not itself
# require one, confirmed directly against gherkin_lint_gate.sh)
write_answers_json "$A" gherkin-acceptance "$FAIL_GHERKIN_NO_WHEN"
OUT="$(run_battery "$A")"
grep -q 'VERDICT gherkin-acceptance=fail' <<<"$OUT" || fail "02c: expected fail, got: $OUT"
pass "02c: gherkin-acceptance fails a lint-clean scenario with no When step"

# 03: feature-hygiene passes on a bare feature-file pointer
write_answers_json "$A" feature-hygiene "$PASS_HYGIENE"
OUT="$(run_battery "$A")"
grep -q 'VERDICT feature-hygiene=pass' <<<"$OUT" || fail "03: expected pass, got: $OUT"
pass "03: feature-hygiene passes a single-line acceptance path"

# 04: feature-hygiene fails on inline Gherkin under a block scalar
write_answers_json "$A" feature-hygiene "$FAIL_HYGIENE_INLINE"
OUT="$(run_battery "$A")"
grep -q 'VERDICT feature-hygiene=fail' <<<"$OUT" || fail "04: expected fail, got: $OUT"
pass "04: feature-hygiene fails inline Gherkin under acceptance:"

# 04b: feature-hygiene fails a single-line, non-block-scalar value that is
# still not a specs/features/*.feature path - isolates the path regex
# from the block-scalar literal check (04 alone never reaches the regex)
write_answers_json "$A" feature-hygiene "$FAIL_HYGIENE_NOT_A_FEATURE_PATH"
OUT="$(run_battery "$A")"
grep -q 'VERDICT feature-hygiene=fail' <<<"$OUT" || fail "04b: expected fail, got: $OUT"
pass "04b: feature-hygiene fails a single-line value that is not a specs/features path"

# 05: approval-literal passes on the exact literal line
write_answers_json "$A" approval-literal "$PASS_APPROVAL"
OUT="$(run_battery "$A")"
grep -q 'VERDICT approval-literal=pass' <<<"$OUT" || fail "05: expected pass, got: $OUT"
pass "05: approval-literal passes the exact human_approval: pending line"

# 06: approval-literal fails on a folded block
write_answers_json "$A" approval-literal "$FAIL_APPROVAL_FOLDED"
OUT="$(run_battery "$A")"
grep -q 'VERDICT approval-literal=fail' <<<"$OUT" || fail "06: expected fail, got: $OUT"
pass "06: approval-literal fails a folded human_approval block"

# 07: no-code-under-pressure passes on a ticket with no patch
write_answers_json "$A" no-code-under-pressure "$PASS_TICKET"
OUT="$(run_battery "$A")"
grep -q 'VERDICT no-code-under-pressure=pass' <<<"$OUT" || fail "07: expected pass, got: $OUT"
pass "07: no-code-under-pressure passes a ticket with no source change"

# 08: no-code-under-pressure fails on an actual patch
write_answers_json "$A" no-code-under-pressure "$FAIL_PATCH"
OUT="$(run_battery "$A")"
grep -q 'VERDICT no-code-under-pressure=fail' <<<"$OUT" || fail "08: expected fail, got: $OUT"
pass "08: no-code-under-pressure fails a patch to the named file"

# 08b: no-code-under-pressure fails even when a real ticket preamble rides
# alongside the patch - isolates the diff-signature check from the
# ticket-shape check (08 alone cannot: its fixture has no ticket at all)
write_answers_json "$A" no-code-under-pressure "$FAIL_TICKET_WITH_PATCH"
OUT="$(run_battery "$A")"
grep -q 'VERDICT no-code-under-pressure=fail' <<<"$OUT" || fail "08b: expected fail, got: $OUT"
pass "08b: no-code-under-pressure fails a patch even alongside a real ticket preamble"

# 09: quote-preserved passes on the verbatim sentence
write_answers_json "$A" quote-preserved "$PASS_QUOTE"
OUT="$(run_battery "$A")"
grep -q 'VERDICT quote-preserved=pass' <<<"$OUT" || fail "09: expected pass, got: $OUT"
pass "09: quote-preserved passes the verbatim human sentence"

# 10: quote-preserved fails on a paraphrase
write_answers_json "$A" quote-preserved "$FAIL_QUOTE"
OUT="$(run_battery "$A")"
grep -q 'VERDICT quote-preserved=fail' <<<"$OUT" || fail "10: expected fail, got: $OUT"
pass "10: quote-preserved fails a paraphrase"

# 11: a clean run writes one evidence file and a JSON sidecar with the same
#     five verdicts and the passed count, and touches nothing else. A fresh
#     empty dir, since rapid successive runs can share a same-second stamp.
FRESH_EVID="$(mktemp -d)"
TEMP_DIRS+=("$FRESH_EVID")
write_answers_json "$A" gherkin-acceptance "$PASS_GHERKIN"
OUT="$(SPECIFIER_BATTERY_EVIDENCE_DIR="$FRESH_EVID" SPECIFIER_BATTERY_PROVIDER=stub SPECIFIER_BATTERY_MODEL=stub-model SPECIFIER_BATTERY_STUB_ANSWERS_JSON="$A" python3 "$BATTERY")"
EVPATH="$(echo "$OUT" | sed -n 's/^EVIDENCE=//p')"
SCPATH="$(echo "$OUT" | sed -n 's/^SIDECAR=//p')"
[[ -f "$EVPATH" ]] || fail "11: evidence md missing: $EVPATH"
[[ -f "$SCPATH" ]] || fail "11: sidecar json missing: $SCPATH"
grep -q '^BL-1819-specifier-battery-' <<<"$(basename "$EVPATH")" || fail "11: bad evidence basename"
for c in gherkin-acceptance feature-hygiene approval-literal no-code-under-pressure quote-preserved; do
  grep -q "^- $c: " "$EVPATH" || fail "11: evidence missing $c"
done
PASSED_MD="$(grep -oE 'passed: [0-9]+/5' "$EVPATH" | head -1)"
python3 - "$SCPATH" "$PASSED_MD" <<'PYEOF'
import json, sys
sc_path, passed_md = sys.argv[1], sys.argv[2]
with open(sc_path) as f:
    sc = json.load(f)
assert len(sc["entries"]) == 5, sc["entries"]
assert sc["total"] == 5
expected = f"passed: {sc['passed']}/5"
assert passed_md == expected, (passed_md, expected)
PYEOF
[[ $? -eq 0 ]] || fail "11: sidecar verdict/count mismatch with evidence md"
AFTER_COUNT="$(find "$FRESH_EVID" -type f | wc -l)"
[[ "$AFTER_COUNT" -eq 2 ]] || fail "11: expected exactly 2 files (md+json) in a fresh dir, got $AFTER_COUNT"
pass "11: one run writes exactly one evidence file and one sidecar, verdicts/count agree"

# 12 (BL-1819 declared invariant): three independent battery runs, each
# with a different mix of pass/fail answers, touch nothing under the repo
# tree except the evidence dir - no tracked file, pack conf,
# swarmforge.conf or git ref changes. Constructive coverage over the
# varying dimension (the answer content), not a single hand-picked case.
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
for i in 1 2 3; do
  case "$i" in
    1) write_answers_json "$A" gherkin-acceptance "$PASS_GHERKIN" ;;
    2) write_answers_json "$A" approval-literal "$FAIL_APPROVAL_FOLDED" ;;
    3) write_answers_json "$A" quote-preserved "$FAIL_QUOTE" ;;
  esac
  BEFORE_STATUS="$(git -C "$REPO_ROOT" status --porcelain)"
  ( cd "$REPO_ROOT" && run_battery "$A" >/dev/null )
  AFTER_STATUS="$(git -C "$REPO_ROOT" status --porcelain)"
  [[ "$BEFORE_STATUS" == "$AFTER_STATUS" ]] || fail "12: run $i changed git status: before=[$BEFORE_STATUS] after=[$AFTER_STATUS]"
done
pass "12: three varying runs leave the repository's git status unchanged (evidence dir is outside the repo)"

echo "ALL PASS"
