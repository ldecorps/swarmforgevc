#!/usr/bin/env bash
# BL-1077: unit coverage for qwen_launch_guard_lib.sh.
# Never sources the operator profile; every credential is a fixture literal.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB="$SCRIPT_DIR/../qwen_launch_guard_lib.sh"
# shellcheck source=../qwen_launch_guard_lib.sh
source "$LIB"

FAILS=0
assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$expected" != "$actual" ]]; then
    echo "FAIL: $label (expected='$expected' actual='$actual')" >&2
    FAILS=$((FAILS + 1))
  else
    echo "ok: $label"
  fi
}

scrub() {
  unset QWEN_API_KEY BAILIAN_TOKEN_PLAN_API_KEY BAILIAN_CODING_PLAN_API_KEY \
        BAILIAN_API_KEY OPENAI_API_KEY OPENAI_API_BASE OPENAI_BASE_URL SWARMFORGE_USE_QWEN || true
}

scrub
export BAILIAN_TOKEN_PLAN_API_KEY='sk-fixture-token-plan'
qwen_guard_require_token_plan_endpoint
assert_eq 'token-plan preferred name maps' 'sk-fixture-token-plan' "${OPENAI_API_KEY:-}"
assert_eq 'token-plan base url' "$QWEN_TOKEN_PLAN_BASE_URL" "${OPENAI_API_BASE:-}"

scrub
export BAILIAN_CODING_PLAN_API_KEY='sk-fixture-coding-plan'
qwen_guard_require_token_plan_endpoint
assert_eq 'coding-plan legacy alias still maps' 'sk-fixture-coding-plan' "${OPENAI_API_KEY:-}"

scrub
export QWEN_API_KEY='sk-fixture-explicit'
export BAILIAN_TOKEN_PLAN_API_KEY='sk-fixture-other'
qwen_guard_require_token_plan_endpoint
assert_eq 'explicit QWEN_API_KEY wins' 'sk-fixture-explicit' "${OPENAI_API_KEY:-}"

scrub
set +e
err="$(qwen_guard_require_token_plan_endpoint 2>&1)"
status=$?
set -e
assert_eq 'missing credential refuses' '1' "$status"
case "$err" in
  *QWEN_API_KEY*BAILIAN_TOKEN_PLAN_API_KEY*BAILIAN_CODING_PLAN_API_KEY*) echo "ok: refusal names every accepted variable" ;;
  *) echo "FAIL: refusal message incomplete: $err" >&2; FAILS=$((FAILS + 1)) ;;
esac

scrub
export SWARMFORGE_USE_QWEN=1
export BAILIAN_TOKEN_PLAN_API_KEY='sk-fixture-soft'
qwen_guard_map_if_flagged
assert_eq 'soft branch accepts token-plan name' 'sk-fixture-soft' "${OPENAI_API_KEY:-}"

if [[ "$FAILS" -ne 0 ]]; then
  echo "BL-1077 unit runner: $FAILS failure(s)" >&2
  exit 1
fi
echo "BL-1077 unit runner: all assertions passed"
