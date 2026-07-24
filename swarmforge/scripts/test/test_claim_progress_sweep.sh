#!/usr/bin/env bash
# BL-528: shell-level wiring test for claim-without-progress sweep.
# Exercises the chase_sweep_test_runner.bb harness with real fixture files
# and the BL-528 adapters enabled (CLAIM_HEAD_COMMIT env var set).
#
# Checks:
#   1. Fresh claim (under timeout) — no action, sidecar initialised
#   2. Commit advanced  — :progressed, sidecar reset
#   3. Same commit past timeout — :nudge fired
#   4. Same commit past timeout, reclaims=2 — :nudge still
#   5. Same commit past timeout, reclaims=5 — :bounce fired
#   6. Same commit past timeout, reclaims=9 — :halt fired; sidecar cleared
#   6b. Relaunch (second sweep, sidecar cleared by the halt) does not re-halt
#       on the first post-relaunch sweep
#
# Env vars the runner uses:
#   CLAIM_HEAD_COMMIT     — which HEAD to report for :get-role-head-commit
#   CLAIM_IDLE_TIMEOUT_MS — short value to force elapsed in tests

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="${SCRIPT_DIR}/chase_sweep_test_runner.bb"
FAILURES=0

fail() { echo "FAIL: $*" >&2; FAILURES=$((FAILURES + 1)); }
pass() { echo "PASS: $*"; }

run_sweep() {
  local fixture="$1" now_ms="$2" liveness="${3:-alive}" activity_ms="${4:-$2}"
  # Use short stuck timeout so action="skipped" (no nudge) for the stuck check;
  # claim-progress check fires independently through the "skipped" branch.
  env -u SWARMFORGE_CONFIG \
    CLAIM_IDLE_TIMEOUT_MS=1000 \
    CLAIM_PROBE_GRACE_MS=0 \
    "${@:5}" \
    bb "${RUNNER}" "${fixture}" "${now_ms}" "${liveness}" "${activity_ms}"
}

make_handoff() {
  local dir="$1" name="$2" claim_commit="${3:-aaaa000000}"
  mkdir -p "${dir}/inbox/in_process" "${dir}/inbox/new" \
           "${dir}/inbox/completed" "${dir}/inbox/abandoned"
  cat > "${dir}/inbox/in_process/${name}" << EOF
id: ${name%.handoff}
from: coordinator
to: coder
priority: 10
type: git_handoff
task: BL-528-test
commit: ${claim_commit}
dequeued_at: 2026-07-19T22:00:00Z
EOF
}

write_claim_sidecar() {
  local dir="$1" name="$2" commit="$3" claim_ms="$4" reclaims="$5" probe_ms="${6:-}"
  if [[ -n "${probe_ms}" ]]; then
    printf '{"claimCommit":"%s","claimAtMs":%s,"reclaims":%s,"idleProbeAtMs":%s}' \
      "${commit}" "${claim_ms}" "${reclaims}" "${probe_ms}" \
      > "${dir}/inbox/in_process/${name}.claim-progress.json"
  else
    printf '{"claimCommit":"%s","claimAtMs":%s,"reclaims":%s}' \
      "${commit}" "${claim_ms}" "${reclaims}" \
      > "${dir}/inbox/in_process/${name}.claim-progress.json"
  fi
}

# ── Test 1: fresh claim (under timeout) — no claim-idle action ────────────────
T=$(mktemp -d)
make_handoff "${T}" "test.handoff" "aaaa000000"
NOW=1000000000
run_sweep "${T}" "${NOW}" alive "${NOW}" CLAIM_HEAD_COMMIT=aaaa000000
# Sidecar should be initialised
if [[ -f "${T}/inbox/in_process/test.handoff.claim-progress.json" ]]; then
  pass "test1: sidecar initialised on first sight"
else
  fail "test1: sidecar NOT initialised"
fi
# No bounce/halt/nudge logged
if grep -q "claim-bounce\|claim-halt\|claim-nudge" "${T}/calls.log" 2>/dev/null; then
  fail "test1: unexpected claim action in calls.log"
else
  pass "test1: no claim action within timeout"
fi
rm -rf "${T}"

# ── Test 2: commit advanced → :progressed, sidecar reset to new commit ────────
T=$(mktemp -d)
make_handoff "${T}" "test.handoff" "aaaa000000"
CLAIM_MS=0
write_claim_sidecar "${T}" "test.handoff" "aaaa000000" "${CLAIM_MS}" 0
# now_ms = claim_ms + 5s (within timeout so stuck check says "skipped"),
# but we pass a DIFFERENT head commit → :progressed
NOW=$((CLAIM_MS + 2000))
run_sweep "${T}" "${NOW}" alive "${NOW}" CLAIM_HEAD_COMMIT=bbbb111111
SIDECAR_COMMIT=$(python3 -c "import json,sys; print(json.load(open('${T}/inbox/in_process/test.handoff.claim-progress.json'))['claimCommit'])" 2>/dev/null || echo "MISSING")
if [[ "${SIDECAR_COMMIT}" == "bbbb111111" ]]; then
  pass "test2: sidecar reset to new commit on advance"
else
  fail "test2: sidecar not reset; claimCommit=${SIDECAR_COMMIT}"
fi
rm -rf "${T}"

# ── Test 3: same commit past timeout → probe agent before first reclaim ───────
T=$(mktemp -d)
make_handoff "${T}" "test.handoff" "aaaa000000"
CLAIM_MS=0
write_claim_sidecar "${T}" "test.handoff" "aaaa000000" "${CLAIM_MS}" 0
NOW=$((CLAIM_MS + 2000))  # > CLAIM_IDLE_TIMEOUT_MS=1000
run_sweep "${T}" "${NOW}" alive "${NOW}" CLAIM_HEAD_COMMIT=aaaa000000
if grep -q "claim-idle-probe coder" "${T}/calls.log" 2>/dev/null; then
  pass "test3: idle probe sent before first reclaim"
else
  fail "test3: expected claim-idle-probe; calls.log=$(cat ${T}/calls.log 2>/dev/null)"
fi
RECLAIMS=$(python3 -c "import json; print(json.load(open('${T}/inbox/in_process/test.handoff.claim-progress.json'))['reclaims'])" 2>/dev/null || echo "0")
if [[ "${RECLAIMS}" == "0" ]]; then
  pass "test3: reclaims not incremented until after probe grace"
else
  fail "test3: reclaims incremented before probe grace; reclaims=${RECLAIMS}"
fi
rm -rf "${T}"

# ── Test 3b: after probe grace → first reclaim → :nudge ─────────────────────
T=$(mktemp -d)
make_handoff "${T}" "test.handoff" "aaaa000000"
CLAIM_MS=0
PROBE_MS=1000
write_claim_sidecar "${T}" "test.handoff" "aaaa000000" "${CLAIM_MS}" 0 "${PROBE_MS}"
NOW=$((CLAIM_MS + 2000))
run_sweep "${T}" "${NOW}" alive "${NOW}" CLAIM_HEAD_COMMIT=aaaa000000
if grep -q "wake-up coder\|send-in-process-resume coder" "${T}/calls.log" 2>/dev/null || \
   python3 -c "import json,sys; d=json.load(open('${T}/inbox/in_process/test.handoff.claim-progress.json')); assert d['reclaims']==1" 2>/dev/null; then
  pass "test3b: nudge fired or reclaims incremented after probe grace"
else
  fail "test3b: expected nudge/reclaim after probe; calls.log=$(cat ${T}/calls.log 2>/dev/null)"
fi
rm -rf "${T}"

# ── Test 4: sidecar reclaims=1 (increments to 2 in sweep) → :nudge ───────────
T=$(mktemp -d)
make_handoff "${T}" "test.handoff" "aaaa000000"
CLAIM_MS=0
write_claim_sidecar "${T}" "test.handoff" "aaaa000000" "${CLAIM_MS}" 1
NOW=$((CLAIM_MS + 2000))
run_sweep "${T}" "${NOW}" alive "${NOW}" CLAIM_HEAD_COMMIT=aaaa000000
RECLAIMS=$(python3 -c "import json; print(json.load(open('${T}/inbox/in_process/test.handoff.claim-progress.json'))['reclaims'])" 2>/dev/null || echo "0")
if grep -q "claim-bounce\|claim-halt" "${T}/calls.log" 2>/dev/null; then
  fail "test4: unexpected bounce/halt at reclaims=2 (was 1); calls=$(cat ${T}/calls.log 2>/dev/null)"
else
  pass "test4: no bounce/halt when reclaims reaches 2 (below bounce-threshold=6)"
fi
rm -rf "${T}"

# ── Test 5: reclaims=5 (becomes 6 after increment) → :bounce ─────────────────
T=$(mktemp -d)
make_handoff "${T}" "test.handoff" "aaaa000000"
CLAIM_MS=0
write_claim_sidecar "${T}" "test.handoff" "aaaa000000" "${CLAIM_MS}" 5
NOW=$((CLAIM_MS + 2000))
run_sweep "${T}" "${NOW}" alive "${NOW}" CLAIM_HEAD_COMMIT=aaaa000000
# After run, sidecar reclaims should be 6 (incremented by sweep)
RECLAIMS=$(python3 -c "import json,sys; print(json.load(open('${T}/inbox/in_process/test.handoff.claim-progress.json'))['reclaims'])" 2>/dev/null || echo "0")
if [[ "${RECLAIMS}" == "6" ]] && grep -q "claim-bounce coder 6" "${T}/calls.log" 2>/dev/null; then
  pass "test5: bounce fired at reclaims=6"
else
  fail "test5: expected bounce at reclaims=6; reclaims=${RECLAIMS} calls=$(cat ${T}/calls.log 2>/dev/null)"
fi
rm -rf "${T}"

# ── Test 6: reclaims=9 (becomes 10 after increment) → :halt ───────────────────
T=$(mktemp -d)
make_handoff "${T}" "test.handoff" "aaaa000000"
CLAIM_MS=0
write_claim_sidecar "${T}" "test.handoff" "aaaa000000" "${CLAIM_MS}" 9
NOW=$((CLAIM_MS + 2000))
run_sweep "${T}" "${NOW}" alive "${NOW}" CLAIM_HEAD_COMMIT=aaaa000000
SIDECAR="${T}/inbox/in_process/test.handoff.claim-progress.json"
if grep -q "claim-halt coder 10" "${T}/calls.log" 2>/dev/null; then
  pass "test6: halt fired at reclaims=10"
else
  fail "test6: expected halt at reclaims=10; calls=$(cat ${T}/calls.log 2>/dev/null)"
fi
# BL-528 priority bump: the sidecar must be CLEARED as part of the halt
# itself, or a relaunch re-reads reclaims=10 and re-halts on the first sweep.
if [[ ! -f "${SIDECAR}" ]]; then
  pass "test6: claim-progress sidecar cleared on halt"
else
  fail "test6: sidecar NOT cleared on halt; contents=$(cat "${SIDECAR}" 2>/dev/null)"
fi
rm -rf "${T}"

# ── Test 6b: relaunch after halt does NOT re-halt on the first sweep ─────────
# Reproduces the priority-bump incident: same in_process item still sitting
# there post-halt (halt kills the swarm, it does not move the handoff), same
# commit still unchanged. A fresh handoffd process's first sweep must not
# read a stale reclaims>=halt-threshold value off disk and immediately halt
# again — that skipped the whole nudge->bounce ladder in the 4th occurrence.
T=$(mktemp -d)
make_handoff "${T}" "test.handoff" "aaaa000000"
CLAIM_MS=0
write_claim_sidecar "${T}" "test.handoff" "aaaa000000" "${CLAIM_MS}" 9
NOW=$((CLAIM_MS + 2000))
run_sweep "${T}" "${NOW}" alive "${NOW}" CLAIM_HEAD_COMMIT=aaaa000000
HALTS_AFTER_FIRST=$(grep -c "claim-halt" "${T}/calls.log" 2>/dev/null || echo 0)
# Simulate the relaunch: same worktree HEAD (no commit landed), a moment later.
NOW2=$((NOW + 1))
run_sweep "${T}" "${NOW2}" alive "${NOW2}" CLAIM_HEAD_COMMIT=aaaa000000
HALTS_AFTER_RELAUNCH=$(grep -c "claim-halt" "${T}/calls.log" 2>/dev/null || echo 0)
if [[ "${HALTS_AFTER_FIRST}" == "1" && "${HALTS_AFTER_RELAUNCH}" == "1" ]]; then
  pass "test6b: relaunch sweep does not re-halt immediately"
else
  fail "test6b: expected exactly 1 halt total (pre-relaunch=1, post-relaunch=1); got pre=${HALTS_AFTER_FIRST} post=${HALTS_AFTER_RELAUNCH} calls=$(cat "${T}/calls.log" 2>/dev/null)"
fi
RECLAIMS_AFTER_RELAUNCH=$(python3 -c "import json; print(json.load(open('${T}/inbox/in_process/test.handoff.claim-progress.json'))['reclaims'])" 2>/dev/null || echo "x")
if [[ "${RECLAIMS_AFTER_RELAUNCH}" == "0" ]]; then
  pass "test6b: relaunch sweep re-initialises the sidecar at reclaims=0"
else
  fail "test6b: expected fresh reclaims=0 after relaunch; got ${RECLAIMS_AFTER_RELAUNCH}"
fi
rm -rf "${T}"

# ── Test 7: .claim-progress.json absent in adapter (no CLAIM_HEAD_COMMIT) ────
# Legacy behavior: sweep runs without the claim check (backward compat).
T=$(mktemp -d)
make_handoff "${T}" "test.handoff" "aaaa000000"
CLAIM_MS=0
write_claim_sidecar "${T}" "test.handoff" "aaaa000000" "${CLAIM_MS}" 5
NOW=$((CLAIM_MS + 2000))
# No CLAIM_HEAD_COMMIT: :get-role-head-commit is nil → no claim check
run_sweep "${T}" "${NOW}" alive "${NOW}"
if grep -q "claim-halt\|claim-bounce" "${T}/calls.log" 2>/dev/null; then
  fail "test7: claim check ran without CLAIM_HEAD_COMMIT"
else
  pass "test7: no claim check when adapter not wired"
fi
rm -rf "${T}"

# ── Test 8: mono-router stale coder claim while hardender active → paused ───
T=$(mktemp -d)
make_handoff "${T}" "test.handoff" "aaaa000000"
CLAIM_MS=0
write_claim_sidecar "${T}" "test.handoff" "aaaa000000" "${CLAIM_MS}" 9
NOW=$((CLAIM_MS + 2000))
run_sweep "${T}" "${NOW}" alive "${NOW}" CLAIM_HEAD_COMMIT=aaaa000000 \
  CLAIM_ROTATION_ROUTER=1 CLAIM_ACTIVE_ROLE=hardender
RECLAIMS=$(python3 -c "import json; print(json.load(open('${T}/inbox/in_process/test.handoff.claim-progress.json'))['reclaims'])" 2>/dev/null || echo "x")
if [[ "${RECLAIMS}" == "0" ]] && ! grep -q "claim-halt" "${T}/calls.log" 2>/dev/null; then
  pass "test8: stale dormant coder claim paused, no halt while hardender active"
else
  fail "test8: expected pause reset; reclaims=${RECLAIMS} calls=$(cat ${T}/calls.log 2>/dev/null)"
fi
rm -rf "${T}"

if [[ "${FAILURES}" -eq 0 ]]; then
  echo "ALL TESTS PASSED (test_claim_progress_sweep)"
  exit 0
else
  echo "${FAILURES} TEST(S) FAILED" >&2
  exit 1
fi
