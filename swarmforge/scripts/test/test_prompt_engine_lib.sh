#!/usr/bin/env bash
# TDD tests for PromptEngine (BL-546 Slice 1): pure lib tests + CLI smoke,
# including byte-parity between the new primary CLI (prompt_engine_cli.bb
# compose) and the pre-BL-546 path (agent_runtime_cli.bb bootstrap-text).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# ── 1: pure PromptEngine tests (bb) ─────────────────────────────────────────
bb "$SCRIPT_DIR/prompt_engine_test_runner.bb" \
  || fail "prompt_engine_test_runner.bb"

pass "01: prompt_engine_lib pure tests"

# ── 2: CLI compose produces the BL-519 stable-first artifact ────────────────
COMPOSED="$(bb "$ROOT/swarmforge/scripts/prompt_engine_cli.bb" compose claude coder 0 "")"
[[ "$COMPOSED" == *"# SwarmForge Constitution"* ]] \
  || fail "02: compose output missing inlined constitution"
[[ "$COMPOSED" == *"# Parcel Flow"* ]] \
  || fail "02: compose output missing inlined PIPELINE"
[[ "$COMPOSED" == "The following is your constitution and pipeline."* ]] \
  || fail "02: compose output does not start with the stable prefix"

pass "02: CLI compose inlines stable-first content"

# ── 3: deterministic mode is byte-stable across invocations ─────────────────
DET_A="$(bb "$ROOT/swarmforge/scripts/prompt_engine_cli.bb" compose claude coder 0 "" --deterministic)"
DET_B="$(bb "$ROOT/swarmforge/scripts/prompt_engine_cli.bb" compose claude coder 0 "" --deterministic)"
[[ "$DET_A" == "$DET_B" ]] \
  || fail "03: --deterministic compose differs across identical invocations"

pass "03: CLI compose --deterministic byte-stable"

# ── 4: migration parity — new primary CLI byte-equals the old path ──────────
OLD="$(bb "$ROOT/swarmforge/scripts/agent_runtime_cli.bb" bootstrap-text claude coder 0 "")"
NEW="$(bb "$ROOT/swarmforge/scripts/prompt_engine_cli.bb" compose claude coder 0 "")"
[[ "$OLD" == "$NEW" ]] \
  || fail "04: prompt_engine_cli compose differs from agent_runtime_cli bootstrap-text"

OLD_TP="$(bb "$ROOT/swarmforge/scripts/agent_runtime_cli.bb" bootstrap-text claude coordinator 1 "")"
NEW_TP="$(bb "$ROOT/swarmforge/scripts/prompt_engine_cli.bb" compose claude coordinator 1 "")"
[[ "$OLD_TP" == "$NEW_TP" ]] \
  || fail "04: two-pack coordinator compose differs from old path"

pass "04: CLI compose byte-parity with pre-BL-546 path"

# ── 5: stable-prefix commands exist on the new CLI ──────────────────────────
PREFIX="$(bb "$ROOT/swarmforge/scripts/prompt_engine_cli.bb" stable-bootstrap-prefix)"
[[ "$PREFIX" == *"# SwarmForge Constitution"* ]] \
  || fail "05: stable-bootstrap-prefix missing constitution"

pass "05: CLI stable-prefix commands"

echo "ALL PASS"
