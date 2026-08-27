#!/usr/bin/env bash
# BL-736: lifecycle scripts share one sourced print_lifecycle_help helper.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SCRIPTS="$ROOT/swarmforge/scripts"
FIXTURES="$SCRIPT_DIR/fixtures/bl736_help"
source "$SCRIPTS/test/lib/tmp_cleanup.sh"

PASS=0
FAIL=0

pass() { echo "PASS: $*"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $*" >&2; FAIL=$((FAIL + 1)); }

AFFECTED=(
  start_ancillary_services.sh
  start_operator_runtime.sh
  start_bridge_headless.sh
  start_cursor_bridge.sh
  start_handoff_daemon.sh
  start_babysitterd.sh
  launch_cursor_bridge.sh
  launch_front_desk.sh
  launch_negotiation_relay.sh
  launch_operator.sh
  launch_support.sh
  launch_operator_runtime_supervisor.sh
  launch_front_desk_operator.sh
  launch_resident_spy_tunnel.sh
  launch_onboarder.sh
  kill_pipeline_swarm.sh
)

# ── 01: no embedded help heredocs in affected scripts ───────────────────────
HEREDOC_FAIL=0
for base in "${AFFECTED[@]}"; do
  if grep -q "cat <<'EOF'" "$SCRIPTS/$base"; then
    echo "FAIL: 01: $base still embeds cat <<'EOF'" >&2
    HEREDOC_FAIL=1
    FAIL=$((FAIL + 1))
  fi
done
if [[ "$HEREDOC_FAIL" -eq 0 ]]; then
  pass "01: no affected script embeds a duplicate --help heredoc body"
fi

# ── 02: --help output matches pre-refactor golden fixtures ──────────────────
GOLDEN_FAIL=0
for base in "${AFFECTED[@]}"; do
  golden="$FIXTURES/${base}.txt"
  if [[ ! -f "$golden" ]]; then
    echo "FAIL: 02: missing golden fixture $golden" >&2
    GOLDEN_FAIL=1
    FAIL=$((FAIL + 1))
    continue
  fi
  out="$(bash "$SCRIPTS/$base" --help 2>&1)" || true
  expected="$(cat "$golden")"
  if [[ "$out" != "$expected" ]]; then
    echo "FAIL: 02: $base --help differs from golden" >&2
    diff -u "$golden" <(printf '%s' "$out") >&2 || true
    GOLDEN_FAIL=1
    FAIL=$((FAIL + 1))
  fi
done
if [[ "$GOLDEN_FAIL" -eq 0 ]]; then
  pass "02: every affected script --help matches pre-refactor golden output"
fi

# ── 03: lifecycle scope suite still passes ──────────────────────────────────
if bash "$SCRIPTS/test/test_lifecycle_script_scope.sh" >/tmp/bl736-lifecycle-scope.out 2>&1; then
  pass "03: test_lifecycle_script_scope and siblings pass unchanged"
else
  fail "03: lifecycle scope suite failed: $(cat /tmp/bl736-lifecycle-scope.out)"
fi

# ── 04: scripts source shared helper ────────────────────────────────────────
HELPER_FAIL=0
for base in "${AFFECTED[@]}"; do
  f="$SCRIPTS/$base"
  if ! grep -q 'lifecycle_help_lib\.sh' "$f"; then
    echo "FAIL: 04: $base does not source lifecycle_help_lib.sh" >&2
    HELPER_FAIL=1
    FAIL=$((FAIL + 1))
    continue
  fi
  if [[ "$base" == kill_pipeline_swarm.sh ]]; then
    if ! grep -q 'print_kill_pipeline_help' "$f"; then
      echo "FAIL: 04: $base missing print_kill_pipeline_help call" >&2
      HELPER_FAIL=1
      FAIL=$((FAIL + 1))
    fi
  elif ! grep -q 'print_lifecycle_help' "$f"; then
    echo "FAIL: 04: $base missing print_lifecycle_help call" >&2
    HELPER_FAIL=1
    FAIL=$((FAIL + 1))
  fi
done
if [[ "$HELPER_FAIL" -eq 0 ]]; then
  pass "04: every affected script sources and calls the shared help helper"
fi

if [[ "$FAIL" -gt 0 ]]; then
  echo "BL-736 lifecycle help: $PASS passed, $FAIL failed" >&2
  exit 1
fi
echo "ALL BL-736 LIFECYCLE HELP CHECKS PASSED ($PASS checks)"
exit 0
