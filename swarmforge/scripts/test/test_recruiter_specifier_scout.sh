#!/usr/bin/env bash
# BL-1821: recruiter_specifier_scout.sh - discovery batch/cap, incumbent
# resolution, score-table replace-not-duplicate, and the recommend line -
# driven entirely through its own test-only stub seams (never a real
# Hugging Face pass, ollama pull, or network battery call).
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCOUT="$SCRIPT_DIR/../recruiter_specifier_scout.sh"
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_root() {
  local d; d="$(mktemp -d)"
  register_tmp_dir "$d"
  printf '%s' "$d"
}

# BL-1821 QA bounce D2 (specifier ruling on note 003548): FULL_PASS and
# FAIL_ONE differ on quote-preserved, a BL-1819 competency (BL-1819 is the
# ticket's own depends_on) - never on a BL-1820 one, since BL-1820 has
# bounced and may land later or change its graders. reality-check's FILE
# is the real path grade_reality_check now requires (BL-1820's own D1
# fix); "x.ts" would fail it.
FULL_PASS='{"gherkin-acceptance":"Feature: X\n  Scenario: y\n    Given a\n    When b\n    Then c\n","feature-hygiene":"id: BL-1\nacceptance: specs/features/BL-1-x.feature\n","approval-literal":"id: BL-1\nhuman_approval: pending\n","no-code-under-pressure":"id: BL-1\ntitle: \"x\"\nstatus: todo\n","quote-preserved":"id: BL-1\ndescription: |\n  the login page must show a friendly error when the reset code expires\n","invest-split":"TICKETS: 3\n","invariants-discipline":"INVARIANTS: 0\n","reality-check":"VERDICT: stale\nFILE: extension/src/swarm/roleParser.ts\n","consolidation":"TICKETS: 1\n","deprecator-refuse":"DECISION: refuse-escalate\n"}'
FAIL_ONE='{"gherkin-acceptance":"Feature: X\n  Scenario: y\n    Given a\n    When b\n    Then c\n","feature-hygiene":"id: BL-1\nacceptance: specs/features/BL-1-x.feature\n","approval-literal":"id: BL-1\nhuman_approval: pending\n","no-code-under-pressure":"id: BL-1\ntitle: \"x\"\nstatus: todo\n","quote-preserved":"id: BL-1\ndescription: |\n  The login page should show a nicer error once the reset link goes stale.\n","invest-split":"TICKETS: 3\n","invariants-discipline":"INVARIANTS: 0\n","reality-check":"VERDICT: stale\nFILE: extension/src/swarm/roleParser.ts\n","consolidation":"TICKETS: 1\n","deprecator-refuse":"DECISION: refuse-escalate\n"}'

# 01: a batch of 3 over 5 unseen candidates batteries exactly 3, plus the
#     incumbent - never more, never fewer.
ROOT="$(make_root)"
ANSWERS="$(mktemp -d)"; register_tmp_dir "$ANSWERS"
printf '%s' "$FULL_PASS" > "$ANSWERS/local_incumbent.json"
DISC="$(mktemp)"
python3 -c "
import json
cands = [{'hf_id': f'org/m{i}', 'alias': f'm{i}:latest', 'ollama_pull': f'hf.co/org/m{i}:Q4_K_M'} for i in range(5)]
json.dump({'candidates': cands}, open('$DISC', 'w'))
for i in range(5):
    open('$ANSWERS/local_m%d_latest.json' % i, 'w').write('''$FULL_PASS''')
"
OUT="$(RECRUITER_SPECIFIER_STUB_DISCOVER_JSON="$DISC" RECRUITER_SPECIFIER_SKIP_PULL=1 \
      RECRUITER_SPECIFIER_INCUMBENT_MODEL="local/incumbent" \
      RECRUITER_SPECIFIER_STUB_ANSWERS_DIR="$ANSWERS" \
      bash "$SCOUT" "$ROOT" --batch 3 2>&1)"
BATTERY_LINES="$(printf '%s' "$OUT" | grep -c 'battery model=')"
check "01: exactly batch-size (3) + 1 incumbent battery runs" '[[ "$BATTERY_LINES" -eq 4 ]]'
NON_INCUMBENT="$(printf '%s' "$OUT" | grep 'battery model=' | grep -c 'incumbent=0')"
check "01: exactly 3 non-incumbent runs (the batch cap, not the full 5 unseen)" '[[ "$NON_INCUMBENT" -eq 3 ]]'

# 02: the score table replaces a row for the same model rather than
#     duplicating it across two runs.
#
#     BL-1821 hardener: since the seen-specifier.jsonl feature landed
#     (specifier ruling on note 003572), a discovered candidate is marked
#     seen BEFORE its first battery run and is then filtered out of every
#     later run's own candidates_json - so "the SAME discovered candidate
#     re-battery-tested a second time" can no longer happen at all; m0 is
#     battery-tested on run 1 only (confirmed below) and its row is never
#     touched again. What still exercises the by_model replace-not-
#     duplicate merge across two runs is the INCUMBENT, which IS
#     re-battery-tested every run by design. Hand-verified this is the
#     only thing still discriminating here: mutating the merge's
#     `rows = list(by_model.values())` to `rows = existing_rows +
#     new_rows` (append instead of replace) survives if only m0's
#     single battery is checked, but is caught by the row-count and
#     battery_stamp assertions below via the incumbent's own row growing
#     to 2 entries.
ROOT2="$(make_root)"
ANSWERS2="$(mktemp -d)"; register_tmp_dir "$ANSWERS2"
printf '%s' "$FULL_PASS" > "$ANSWERS2/local_incumbent.json"
printf '%s' "$FULL_PASS" > "$ANSWERS2/local_m0_latest.json"
DISC2="$(mktemp)"
printf '{"candidates": [{"hf_id": "org/m0", "alias": "m0:latest", "ollama_pull": "hf.co/org/m0:Q4_K_M"}]}' > "$DISC2"
run_scout_02() {
  RECRUITER_SPECIFIER_STUB_DISCOVER_JSON="$DISC2" RECRUITER_SPECIFIER_SKIP_PULL=1 \
    RECRUITER_SPECIFIER_INCUMBENT_MODEL="local/incumbent" \
    RECRUITER_SPECIFIER_STUB_ANSWERS_DIR="$ANSWERS2" \
    bash "$SCOUT" "$ROOT2" --batch 3 >/dev/null 2>&1
}
run_scout_02
TABLE2="$ROOT2/.swarmforge/recruiter/score-table.json"
# next(..., "MISSING") rather than a bare next(...): a bare next() on an
# empty generator raises StopIteration, which python3 -c prints as a
# traceback to STDERR and exits nonzero - but $(...) still captures
# whatever (empty) STDOUT existed, so a naive comparison against that
# empty string can pass by ACCIDENT rather than by the property actually
# holding (hand-verified: a setdefault-instead-of-assign merge mutant,
# combined with the incumbent-clearing loop above, leaves NO row flagged
# incumbent at all - the bare next() crashed silently and the resulting
# empty-string comparison passed anyway). "MISSING" makes that case a
# real, visible check failure instead.
M0_STAMP_1="$(python3 -c 'import json; d=json.load(open("'"$TABLE2"'")); print(next((r["battery_stamp"] for r in d["rows"] if r["model"]=="local/m0:latest"), "MISSING"))')"
INCUMBENT_STAMP_1="$(python3 -c 'import json; d=json.load(open("'"$TABLE2"'")); print(next((r["battery_stamp"] for r in d["rows"] if r.get("incumbent")), "MISSING"))')"
check "02: exactly one row is flagged incumbent after run 1" '[[ "$INCUMBENT_STAMP_1" != "MISSING" ]]'
sleep 1
run_scout_02
ROW_COUNT="$(python3 -c 'import json; print(len(json.load(open("'"$TABLE2"'"))["rows"]))')"
check "02: two runs on the same models leave exactly 2 rows, never 4" '[[ "$ROW_COUNT" -eq 2 ]]'
M0_STAMP_2="$(python3 -c 'import json; d=json.load(open("'"$TABLE2"'")); print(next((r["battery_stamp"] for r in d["rows"] if r["model"]=="local/m0:latest"), "MISSING"))')"
check "02: m0's row is untouched by run 2 (the seen-list skips its re-discovery), same battery_stamp" \
  '[[ "$M0_STAMP_2" != "MISSING" && "$M0_STAMP_2" == "$M0_STAMP_1" ]]'
INCUMBENT_STAMP_2="$(python3 -c 'import json; d=json.load(open("'"$TABLE2"'")); print(next((r["battery_stamp"] for r in d["rows"] if r.get("incumbent")), "MISSING"))')"
check "02: exactly one row is still flagged incumbent after run 2, never zero" '[[ "$INCUMBENT_STAMP_2" != "MISSING" ]]'
check "02: the incumbent's row IS replaced by run 2 (re-battery-tested every run), a newer battery_stamp" \
  '[[ "$INCUMBENT_STAMP_2" != "$INCUMBENT_STAMP_1" ]]'

# 03: the recommend line names the challenger only when it beats the
#     incumbent; a tie keeps the incumbent.
ROOT3="$(make_root)"
ANSWERS3="$(mktemp -d)"; register_tmp_dir "$ANSWERS3"
printf '%s' "$FAIL_ONE" > "$ANSWERS3/local_incumbent.json"
printf '%s' "$FULL_PASS" > "$ANSWERS3/local_challenger_latest.json"
DISC3="$(mktemp)"
printf '{"candidates": [{"hf_id": "org/challenger", "alias": "challenger:latest", "ollama_pull": "hf.co/org/challenger:Q4_K_M"}]}' > "$DISC3"
RECRUITER_SPECIFIER_STUB_DISCOVER_JSON="$DISC3" RECRUITER_SPECIFIER_SKIP_PULL=1 \
  RECRUITER_SPECIFIER_INCUMBENT_MODEL="local/incumbent" \
  RECRUITER_SPECIFIER_STUB_ANSWERS_DIR="$ANSWERS3" \
  bash "$SCOUT" "$ROOT3" --batch 3 >/dev/null 2>&1
TABLE3="$ROOT3/.swarmforge/recruiter/score-table.json"
RECOMMEND3="$(python3 -c 'import json; print(json.load(open("'"$TABLE3"'"))["recommend"]["specifier"])')"
check "03: a challenger beating the incumbent (10 vs 9) is named as an offer" \
  '[[ "$RECOMMEND3" == *challenger* && "$RECOMMEND3" == *offer* ]]'

# 04: a tie (both 10/10) keeps the incumbent, never names a challenger.
ROOT4="$(make_root)"
ANSWERS4="$(mktemp -d)"; register_tmp_dir "$ANSWERS4"
printf '%s' "$FULL_PASS" > "$ANSWERS4/local_incumbent.json"
printf '%s' "$FULL_PASS" > "$ANSWERS4/local_challenger_latest.json"
DISC4="$(mktemp)"
printf '{"candidates": [{"hf_id": "org/challenger", "alias": "challenger:latest", "ollama_pull": "hf.co/org/challenger:Q4_K_M"}]}' > "$DISC4"
RECRUITER_SPECIFIER_STUB_DISCOVER_JSON="$DISC4" RECRUITER_SPECIFIER_SKIP_PULL=1 \
  RECRUITER_SPECIFIER_INCUMBENT_MODEL="local/incumbent" \
  RECRUITER_SPECIFIER_STUB_ANSWERS_DIR="$ANSWERS4" \
  bash "$SCOUT" "$ROOT4" --batch 3 >/dev/null 2>&1
TABLE4="$ROOT4/.swarmforge/recruiter/score-table.json"
RECOMMEND4="$(python3 -c 'import json; print(json.load(open("'"$TABLE4"'"))["recommend"]["specifier"])')"
check "04: a tie keeps the incumbent" '[[ "$RECOMMEND4" == "keep the incumbent local/incumbent (10/10)" ]]'

# 05: no candidates and no incumbent -> the scout still exits 0, writes a
#     report and touches no pack conf or swarmforge.conf.
ROOT5="$(make_root)"
DISC5="$(mktemp)"
printf '{"candidates": []}' > "$DISC5"
RECRUITER_SPECIFIER_STUB_DISCOVER_JSON="$DISC5" RECRUITER_SPECIFIER_SKIP_PULL=1 \
  RECRUITER_SPECIFIER_INCUMBENT_MODEL="" \
  bash "$SCOUT" "$ROOT5" --batch 3 >/tmp/bl1821-t05.out 2>&1
RC=$?
check "05: no candidates, no incumbent still exits 0" '[[ "$RC" -eq 0 ]]'
check "05: a report is written" 'ls "$ROOT5"/backlog/evidence/recruiter-specifier-scout-*.md >/dev/null 2>&1'
check "05: no pack conf or swarmforge.conf is written" \
  '[[ ! -f "$ROOT5/swarmforge.conf" && ! -f "$ROOT5/swarmforge/swarmforge.conf" ]]'
rm -f /tmp/bl1821-t05.out

# 06: two challengers with DIFFERING scores and no incumbent - the
#     recommend line names the HIGHER-scoring one, never the lower.
#     Hand-verified this is load-bearing: mutating recruiter_specifier_scout.sh's
#     `best = max(challengers, key=lambda r: r["passed"], ...)` to `min(...)`
#     survived the whole existing suite (every other case has either one
#     challenger, or several tied at the same score) - this is the only
#     case that can tell max from min.
ROOT6="$(make_root)"
ANSWERS6="$(mktemp -d)"; register_tmp_dir "$ANSWERS6"
printf '%s' "$FULL_PASS" > "$ANSWERS6/local_challenger_hi_latest.json"
printf '%s' "$FAIL_ONE" > "$ANSWERS6/local_challenger_lo_latest.json"
DISC6="$(mktemp)"
printf '{"candidates": [{"hf_id": "org/lo", "alias": "challenger_lo:latest", "ollama_pull": "hf.co/org/lo:Q4_K_M"}, {"hf_id": "org/hi", "alias": "challenger_hi:latest", "ollama_pull": "hf.co/org/hi:Q4_K_M"}]}' > "$DISC6"
RECRUITER_SPECIFIER_STUB_DISCOVER_JSON="$DISC6" RECRUITER_SPECIFIER_SKIP_PULL=1 \
  RECRUITER_SPECIFIER_INCUMBENT_MODEL="" \
  RECRUITER_SPECIFIER_STUB_ANSWERS_DIR="$ANSWERS6" \
  bash "$SCOUT" "$ROOT6" --batch 3 >/dev/null 2>&1
TABLE6="$ROOT6/.swarmforge/recruiter/score-table.json"
RECOMMEND6="$(python3 -c 'import json; print(json.load(open("'"$TABLE6"'"))["recommend"]["specifier"])')"
check "06: the higher-scoring challenger (10/10) is named, never the lower (9/10)" \
  '[[ "$RECOMMEND6" == *challenger_hi* && "$RECOMMEND6" != *challenger_lo* ]]'

# 07 (BL-1821 QA bounce D1): an incumbent change across two runs clears the
#     OLD incumbent's flag - it never lingers true alongside the new one.
ROOT7="$(make_root)"
ANSWERS7="$(mktemp -d)"; register_tmp_dir "$ANSWERS7"
printf '%s' "$FULL_PASS" > "$ANSWERS7/local_incumbent_a.json"
printf '%s' "$FULL_PASS" > "$ANSWERS7/local_incumbent_b.json"
DISC7_EMPTY="$(mktemp)"
printf '{"candidates": []}' > "$DISC7_EMPTY"
RECRUITER_SPECIFIER_STUB_DISCOVER_JSON="$DISC7_EMPTY" RECRUITER_SPECIFIER_SKIP_PULL=1 \
  RECRUITER_SPECIFIER_INCUMBENT_MODEL="local/incumbent_a" \
  RECRUITER_SPECIFIER_STUB_ANSWERS_DIR="$ANSWERS7" \
  bash "$SCOUT" "$ROOT7" --batch 3 >/dev/null 2>&1
sleep 1
RECRUITER_SPECIFIER_STUB_DISCOVER_JSON="$DISC7_EMPTY" RECRUITER_SPECIFIER_SKIP_PULL=1 \
  RECRUITER_SPECIFIER_INCUMBENT_MODEL="local/incumbent_b" \
  RECRUITER_SPECIFIER_STUB_ANSWERS_DIR="$ANSWERS7" \
  bash "$SCOUT" "$ROOT7" --batch 3 >/dev/null 2>&1
TABLE7="$ROOT7/.swarmforge/recruiter/score-table.json"
INCUMBENT_ROWS7="$(python3 -c 'import json; d=json.load(open("'"$TABLE7"'")); print(",".join(sorted(r["model"] for r in d["rows"] if r.get("incumbent"))))')"
check "07: exactly the new incumbent is flagged after the incumbent changes" \
  '[[ "$INCUMBENT_ROWS7" == "local/incumbent_b" ]]'
ROW_COUNT7="$(python3 -c 'import json; print(len(json.load(open("'"$TABLE7"'"))["rows"]))')"
check "07: the old incumbent's row is kept, not dropped" '[[ "$ROW_COUNT7" -eq 2 ]]'

# 08 (BL-1821 QA bounce D1, the "run has none" half): a run with an
#     incumbent, followed by a run that batteries a CANDIDATE but NO
#     incumbent at all (RECRUITER_SPECIFIER_INCUMBENT_MODEL=""), must
#     still clear the old incumbent's flag - the clearing is keyed on the
#     ROLE this run touched, never on whether this run's own new_rows
#     include an incumbent row. Case 07 only exercises incumbent-to-
#     incumbent transitions, where the old incumbent's model is never
#     re-battery-tested either; a narrower fix that clears the flag only
#     when this run's new_rows carry an incumbent (rather than whenever
#     the role was touched at all) would still pass case 07 but leave
#     the old incumbent flagged here, alongside the new candidate row -
#     verified by hand-mutating `roles_this_run` to
#     `{r["role"] for r in new_rows if r.get("incumbent")}` and
#     confirming the whole existing suite (all of 01-07) stayed green.
ROOT8="$(make_root)"
ANSWERS8="$(mktemp -d)"; register_tmp_dir "$ANSWERS8"
printf '%s' "$FULL_PASS" > "$ANSWERS8/local_incumbent.json"
printf '%s' "$FULL_PASS" > "$ANSWERS8/local_challenger_only_latest.json"
DISC8_EMPTY="$(mktemp)"
printf '{"candidates": []}' > "$DISC8_EMPTY"
RECRUITER_SPECIFIER_STUB_DISCOVER_JSON="$DISC8_EMPTY" RECRUITER_SPECIFIER_SKIP_PULL=1 \
  RECRUITER_SPECIFIER_INCUMBENT_MODEL="local/incumbent" \
  RECRUITER_SPECIFIER_STUB_ANSWERS_DIR="$ANSWERS8" \
  bash "$SCOUT" "$ROOT8" --batch 3 >/dev/null 2>&1
sleep 1
DISC8_CAND="$(mktemp)"
printf '{"candidates": [{"hf_id": "org/challenger_only", "alias": "challenger_only:latest", "ollama_pull": "hf.co/org/challenger_only:Q4_K_M"}]}' > "$DISC8_CAND"
RECRUITER_SPECIFIER_STUB_DISCOVER_JSON="$DISC8_CAND" RECRUITER_SPECIFIER_SKIP_PULL=1 \
  RECRUITER_SPECIFIER_INCUMBENT_MODEL="" \
  RECRUITER_SPECIFIER_STUB_ANSWERS_DIR="$ANSWERS8" \
  bash "$SCOUT" "$ROOT8" --batch 3 >/dev/null 2>&1
TABLE8="$ROOT8/.swarmforge/recruiter/score-table.json"
INCUMBENT_ROWS8="$(python3 -c 'import json; d=json.load(open("'"$TABLE8"'")); print(",".join(sorted(r["model"] for r in d["rows"] if r.get("incumbent"))))')"
check "08: a candidates-only run with no incumbent still clears the old incumbent's flag" \
  '[[ "$INCUMBENT_ROWS8" == "" ]]'
ROW_COUNT8="$(python3 -c 'import json; print(len(json.load(open("'"$TABLE8"'"))["rows"]))')"
check "08: both rows are kept (old incumbent, new candidate), never dropped" '[[ "$ROW_COUNT8" -eq 2 ]]'

if [[ "$fail" -eq 0 ]]; then
  echo "ALL PASS"
  exit 0
else
  exit 1
fi
