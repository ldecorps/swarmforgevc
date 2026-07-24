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

# ── 6: --model reaches compose's metadata via compose-metadata (BL-563 Slice 2) ─
MD="$(bb "$ROOT/swarmforge/scripts/prompt_engine_cli.bb" compose-metadata claude coder 0 "" --model opus)"
[[ "$MD" == *'"model":"opus"'* ]] \
  || fail "06: compose-metadata did not record the passed --model, got: $MD"
[[ "$MD" == *'"role":"coder"'* ]] \
  || fail "06: compose-metadata did not record the role, got: $MD"

pass "06: CLI --model flag reaches compose-metadata's :model field"

# ── 7: compose (system-prompt text) is unaffected by --model — the ─────────
# adapter-consumption half stays BL-574's scope; this slice is metadata-only.
COMPOSED_NO_MODEL="$(bb "$ROOT/swarmforge/scripts/prompt_engine_cli.bb" compose claude coder 0 "")"
COMPOSED_WITH_MODEL="$(bb "$ROOT/swarmforge/scripts/prompt_engine_cli.bb" compose claude coder 0 "" --model opus)"
[[ "$COMPOSED_NO_MODEL" == "$COMPOSED_WITH_MODEL" ]] \
  || fail "07: --model must not change the composed system-prompt text (metadata-only in this slice)"

pass "07: CLI compose system-prompt text is unchanged by --model (metadata-only)"

# ── 8: --model and --deterministic compose in either order ─────────────────
MD_ORDER_A="$(bb "$ROOT/swarmforge/scripts/prompt_engine_cli.bb" compose-metadata claude coder 0 "" --model opus --deterministic)"
MD_ORDER_B="$(bb "$ROOT/swarmforge/scripts/prompt_engine_cli.bb" compose-metadata claude coder 0 "" --deterministic --model opus)"
[[ "$MD_ORDER_A" == *'"model":"opus"'* && "$MD_ORDER_A" == *'"deterministic?":true'* ]] \
  || fail "08a: --model before --deterministic did not set both, got: $MD_ORDER_A"
[[ "$MD_ORDER_B" == *'"model":"opus"'* && "$MD_ORDER_B" == *'"deterministic?":true'* ]] \
  || fail "08b: --deterministic before --model did not set both, got: $MD_ORDER_B"

pass "08: CLI --model and --deterministic compose in either order"

# ── 9: no --model -> compose-metadata's :model is absent/null (unchanged default) ─
MD_NO_MODEL="$(bb "$ROOT/swarmforge/scripts/prompt_engine_cli.bb" compose-metadata claude coder 0 "")"
[[ "$MD_NO_MODEL" == *'"model":null'* ]] \
  || fail "09: expected null :model with no --model flag, got: $MD_NO_MODEL"

pass "09: CLI compose-metadata :model is null when --model is not passed"

echo "ALL PASS"
