#!/usr/bin/env bash
# TDD tests for agent runtime facade (pure lib + inject wiring smoke).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# ── 1: pure strategy tests (bb) ─────────────────────────────────────────────
bb "$SCRIPT_DIR/agent_runtime_test_runner.bb" \
  || fail "agent_runtime_test_runner.bb"

pass "01: agent_runtime_lib pure tests"

# ── 2: CLI handoff-draft-path ─────────────────────────────────────────────────
DRAFT="$(bb "$ROOT/swarmforge/scripts/agent_runtime_cli.bb" handoff-draft-path aider)"
[[ "$DRAFT" == "swarmforge/runtime/handoff-draft.txt" ]] \
  || fail "02: CLI handoff-draft-path, got: $DRAFT"

pass "02: CLI handoff-draft-path"

# ── 3: CLI wake-steps JSON for aider vs claude ────────────────────────────────
AIDER_WAKE="$(bb "$ROOT/swarmforge/scripts/agent_runtime_cli.bb" wake-text aider)"
[[ "$AIDER_WAKE" == "! ./swarmforge/scripts/ready_for_next.sh" ]] \
  || fail "03: aider wake-text, got: $AIDER_WAKE"

CLAUDE_WAKE="$(bb "$ROOT/swarmforge/scripts/agent_runtime_cli.bb" wake-text claude)"
[[ "$CLAUDE_WAKE" == *"handoff mail"* ]] \
  || fail "03: claude wake-text, got: $CLAUDE_WAKE"

MOCK_WAKE="$(bb "$ROOT/swarmforge/scripts/agent_runtime_cli.bb" wake-text mock)"
[[ "$MOCK_WAKE" == "MOCK_WAKE" ]] \
  || fail "03b: mock wake-text, got: $MOCK_WAKE"

pass "03: CLI wake-text per agent"

# ── 4: mock inject wiring (fake tmux) ─────────────────────────────────────────
bash "$SCRIPT_DIR/test_agent_runtime_inject_mock.sh" \
  || fail "test_agent_runtime_inject_mock.sh"

pass "04: mock agent inject through fake tmux"

echo "ALL PASS"
