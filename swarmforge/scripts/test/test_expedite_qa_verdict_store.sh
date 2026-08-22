#!/usr/bin/env bash
# BL-1025: the WRITER half. An expedite run's QA hat gives a real
# advance-or-bounce verdict, but with the swarm stopped there is no live QA
# worktree, so `swarmforge-QA` never moves and Article 4.2's
# pipeline-code-on-main check reads every commit of the run as having landed
# outside QA - three of BL-1021's did, on 2026-08-21. The run now leaves that
# verdict where is_qa_ancestor.sh can read it.
#
# Its own file rather than more assertions in test_expedite_cli.sh: this
# drives the run with --override, because the liveness interlock refuses on
# any host where a real swarm is running (which is every host that matters
# here), and that refusal is not the behaviour under test. The fixture's stop
# command is inert by construction, so --override never reaches a real swarm.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS="$SCRIPT_DIR/.."
CLI="$SCRIPTS/expedite_cli.bb"
PREDICATE="$SCRIPTS/is_qa_ancestor.sh"
FIXTURE="$SCRIPT_DIR/expedite_fixture.sh"

fails=0
pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; fails=$((fails + 1)); }
check() { if [[ "$2" == "$3" ]]; then pass "$1"; else fail "$1 (expected '$3', got '$2')"; fi; }
contains() { if grep -qF -- "$3" <<<"$2"; then pass "$1"; else fail "$1 (missing '$3')"; fi; }

TMPROOT="$(mktemp -d)"
register_tmp_dir "$TMPROOT"

run() { # <root> <args...>
  local root="$1"; shift
  EXPEDITE_STAGE_RUNNER="$root/stage-runner.sh" \
  EXPEDITE_STOP_CMD=./stop-swarm.sh \
  EXPEDITE_START_CMD=./start-swarm.sh \
    bb "$CLI" "$root" "$@" 2>&1
}

# ── a passing run records its QA hat's approval ───────────────────────────
echo "BL-1025: a passing run records its QA hat's verdict"
R="$TMPROOT/pass"
bash "$FIXTURE" "$R" --active BL-567 >/dev/null
run "$R" BL-567 --no-restart --override >/dev/null || true

STORE_LINES="$(cat "$R"/.swarmforge/expedite-approvals/*.jsonl 2>/dev/null || true)"
check "the run wrote exactly one verdict record" "$(grep -c . <<<"$STORE_LINES" | tr -d ' ')" "1"
contains "the record names the QA stage, not whichever stage ran last" "$STORE_LINES" '"stage":"QA"'
contains "the record carries the advancing verdict" "$STORE_LINES" '"verdict":"pass"'
contains "the record names the ticket the run walked" "$STORE_LINES" '"ticket":"BL-567"'

RECORDED_SHA="$(sed -E 's/.*"commit":"([0-9a-f]+)".*/\1/' <<<"$STORE_LINES")"
check "the recorded sha is the 10-hex width the other verdict stores use" "${#RECORDED_SHA}" "10"
check "the recorded sha is the tip the QA hat actually looked at (the run branch, never main)" \
  "$(git -C "$R" rev-parse --short=10 expedite/BL-567 2>/dev/null)" "$RECORDED_SHA"

# The point of the whole ticket: the shared predicate now answers yes for
# that sha, in a repo where swarmforge-QA never moved at all.
#
# swarmforge-QA is pinned to an UNRELATED root commit, not to main. The
# fixture's stage runner does not itself commit, so the run branch tip IS
# main's tip - point swarmforge-QA at main and ancestry alone approves the
# sha, and both assertions below pass without the record being read at all.
# (It did, on the first draft of this file.) An empty-tree parentless commit
# shares no history with anything, so ancestry can only ever answer "no" and
# the record is the only thing left that can say yes.
QA_ROOT="$(git -C "$R" commit-tree "$(git -C "$R" hash-object -t tree /dev/null)" -m 'unrelated qa root' </dev/null)"
git -C "$R" branch -f swarmforge-QA "$QA_ROOT"
set +e
(cd "$R" && git merge-base --is-ancestor "$RECORDED_SHA" swarmforge-QA >/dev/null 2>&1); ANCESTRY_EXIT=$?
set -e
check "guard: the sha is genuinely NOT an ancestor of swarmforge-QA, so ancestry cannot be what approves it" \
  "$ANCESTRY_EXIT" "1"
set +e
(cd "$R" && bash "$PREDICATE" "$RECORDED_SHA" >/dev/null 2>&1); PRED_EXIT=$?
set -e
check "the shared predicate reads that sha as approved (exit 0) with no swarmforge-QA ancestry" "$PRED_EXIT" "0"

# ...and the fix is a verdict being read, not a slackened predicate: take the
# record away and the same sha must refuse again (qa_e2e_procedure step 2).
mv "$R"/.swarmforge/expedite-approvals "$R"/.swarmforge/expedite-approvals.moved
set +e
(cd "$R" && bash "$PREDICATE" "$RECORDED_SHA" >/dev/null 2>&1); PRED_EXIT_NO_RECORD=$?
set -e
check "with the record removed the same sha refuses again - the predicate was taught, not weakened" \
  "$PRED_EXIT_NO_RECORD" "1"

# ── a dry run records nothing ─────────────────────────────────────────────
echo "BL-1025: a dry run touches nothing"
R2="$TMPROOT/dry"
bash "$FIXTURE" "$R2" --active BL-567 >/dev/null
run "$R2" BL-567 --dry-run --override >/dev/null || true
check "a --dry-run run writes no verdict record at all" \
  "$(ls "$R2"/.swarmforge/expedite-approvals 2>/dev/null | wc -l | tr -d ' ')" "0"

if [[ $fails -ne 0 ]]; then
  echo "test_expedite_qa_verdict_store: $fails FAILURE(S)"
  exit 1
fi
echo "test_expedite_qa_verdict_store: ALL CHECKS PASSED"
