#!/usr/bin/env bash
# BL-1318: proves pack_staffing_gate is actually wired into swarmforge.sh's
# real parse_config loop (required_wiring anchor 1) - not just callable in
# isolation. Sources the REAL swarmforge.sh (never a copy) against an
# isolated fixture project root, with MODEL_STEWARD_STATE_DIR pointed at a
# controlled fixture so the decision is deterministic regardless of this
# checkout's own live steward state. The pure decision table lives in
# pack_staffing_gate_lib_test_runner.bb; the CLI fs-adapter in
# test_pack_staffing_gate.sh; this file is the ONE place that proves
# swarmforge.sh's own parse_config loop actually calls the gate, and that a
# refusal happens before parse_config returns - i.e. before any tmux window
# could exist (qa_e2e_procedure's own claim).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

STATE_DIR="$WORK/state"
mkdir -p "$STATE_DIR/scorecards"
cat > "$STATE_DIR/registry.json" <<'JSON'
{
  "models": {
    "cursor/auto": {"provider": "cursor", "model": "auto", "status": "certified", "certification_report_path": null}
  },
  "capabilities": {},
  "role_matrix": {
    "QA": [{"provider": "cursor", "model": "auto", "score": 0.9, "evidence": "compliance-battery:fixture"}],
    "coder": [{"provider": "cursor", "model": "auto", "score": 0.9, "evidence": "compliance-battery:fixture"}]
  },
  "adapters": {}
}
JSON
cat > "$STATE_DIR/scorecards/cursor__auto.json" <<'JSON'
{"model": "auto", "entries": [{"competency": "QA-gate", "status": "pass", "reason": "fixture"}, {"competency": "coder-gate", "status": "pass", "reason": "fixture"}]}
JSON

mk_root() {
  local root="$WORK/$1"
  mkdir -p "$root/swarmforge/roles" "$root/.swarmforge"
  touch "$root/swarmforge/constitution.prompt"
  for role in specifier coder QA; do
    echo "role prompt" > "$root/swarmforge/roles/$role.prompt"
  done
  echo "$root"
}

# ── 1: an uncleared seat refuses, and refuses BEFORE parse_config returns —
#    i.e. before any tmux window is ever opened by the caller. ─────────────
ROOT1="$(mk_root refuse-root)"
cat > "$ROOT1/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window QA cursor QA --model nightly
CONF

OUT1="$(MODEL_STEWARD_STATE_DIR="$STATE_DIR" zsh -c "
  source '$SWARMFORGE_SH' '$ROOT1'
  parse_config
  echo 'PARSE_CONFIG_RETURNED'
" 2>&1)" && RC1=0 || RC1=$?

[[ $RC1 -ne 0 ]] || fail "01: an uncleared seat (cursor/nightly, no steward mapping) should have refused parse_config"
[[ "$OUT1" == *"pack staffing gate refused role 'QA'"* ]] || fail "01: refusal did not name role QA (got: $OUT1)"
[[ "$OUT1" != *"PARSE_CONFIG_RETURNED"* ]] || fail "01: parse_config returned instead of refusing before completion"

pass "01: refuses an unmapped seat, before parse_config (and so before any tmux window) completes"

# ── 2: a seat the steward ranks + gate-passes for its role staffs unchanged ─
ROOT2="$(mk_root pass-root)"
cat > "$ROOT2/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window QA cursor QA --model auto
CONF

OUT2="$(MODEL_STEWARD_STATE_DIR="$STATE_DIR" zsh -c "
  source '$SWARMFORGE_SH' '$ROOT2'
  parse_config
  echo 'PARSE_CONFIG_RETURNED'
" 2>&1)"
[[ "$OUT2" == *"PARSE_CONFIG_RETURNED"* ]] || fail "02: a cleared seat (cursor/auto, QA-gate pass) should have let parse_config complete"
[[ "$OUT2" != *"WARNING"* ]] || fail "02: a plain pass must not print an override warning"

pass "02: a steward-cleared seat staffs exactly as before, no warning printed"

# ── 3: PACK_STAFFING_SKIP_GATE=1 turns the SAME refusal into a loud,
#    never-silent override that still lets parse_config complete. ──────────
OUT3="$(MODEL_STEWARD_STATE_DIR="$STATE_DIR" PACK_STAFFING_SKIP_GATE=1 zsh -c "
  source '$SWARMFORGE_SH' '$ROOT1'
  parse_config
  echo 'PARSE_CONFIG_RETURNED'
" 2>&1)"
[[ "$OUT3" == *"PARSE_CONFIG_RETURNED"* ]] || fail "03: PACK_STAFFING_SKIP_GATE=1 should staff the seat and let parse_config complete"
[[ "$OUT3" == *"WARNING: pack staffing gate OVERRIDE"* ]] || fail "03: override must print a loud, distinct warning (invariant 3)"
[[ "$OUT3" == *"role 'QA'"* ]] || fail "03: override warning did not name the role"

pass "03: PACK_STAFFING_SKIP_GATE=1 stages the seat as a loud override, distinct from a pass"

# ── 3b: an unresolvable seat (no steward provider mapping at all) quotes the
#    raw window line in its refusal - there is no provider/model to name. ──
ROOT3B="$(mk_root unresolvable-root)"
cat > "$ROOT3B/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window QA claude master --model totally-unmapped-model
CONF
OUT3B="$(MODEL_STEWARD_STATE_DIR="$STATE_DIR" zsh -c "
  source '$SWARMFORGE_SH' '$ROOT3B'
  parse_config
" 2>&1)" && RC3B=0 || RC3B=$?
[[ $RC3B -ne 0 ]] || fail "03b: an unresolvable seat should refuse"
[[ "$OUT3B" == *"seat-model-unresolved"* ]] || fail "03b: refusal did not report seat-model-unresolved (got: $OUT3B)"
[[ "$OUT3B" == *"window line 'claude --model totally-unmapped-model"* ]] \
  || fail "03b: refusal did not quote the unresolved window line (got: $OUT3B)"

pass "03b: an unresolvable seat's refusal quotes the raw window line, not a blank provider/model"

# ── 4: with NO fixture override at all, the real wiring falls back to THIS
#    checkout's own committed seed (never silently staffs when a runtime
#    registry.json is absent - swarmforge_root is resolved from the
#    sourced script's OWN location, not from the fixture project root, so
#    a real checkout's seed is always in reach; NO_EVIDENCE itself is a
#    synthetic-fixture-only edge case, exhaustively covered at the CLI
#    layer in test_pack_staffing_gate.sh). A seed-ranked model with no
#    local compliance-battery scorecard fails closed on role-gate-not-pass,
#    never defaults to staffed (invariant 1). Isolates ONLY the runtime
#    state dir, so this never touches this repo's own real registry.json.
ROOT4="$(mk_root seed-fallback-root)"
cat > "$ROOT4/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window specifier claude master --model claude-sonnet-5
CONF

FRESH_STATE="$WORK/fresh-state"
mkdir -p "$FRESH_STATE"
OUT4="$(MODEL_STEWARD_STATE_DIR="$FRESH_STATE" zsh -c "
  source '$SWARMFORGE_SH' '$ROOT4'
  parse_config
  echo 'PARSE_CONFIG_RETURNED'
" 2>&1)" && RC4=0 || RC4=$?
[[ $RC4 -ne 0 ]] || fail "04: a seed-ranked model with no local scorecard should refuse, never default to staffed"
[[ "$OUT4" == *"role-gate-not-pass"* ]] || fail "04: expected role-gate-not-pass against the real committed seed (got: $OUT4)"
[[ "$OUT4" == *"anthropic/claude-sonnet-5"* ]] || fail "04: refusal did not resolve the real seed's provider/model (got: $OUT4)"

pass "04: with no runtime registry, the real committed seed is read and an unscored model fails closed (invariant 1)"

# ── 5: BL-982 - an `@`-seat is gated against its STAGE's role-matrix/gate
#    (a mono-router extra seat, e.g. coder@extra, is not itself a role the
#    matrix knows about), while the refusal still names the full seat id. ──
ROOT5="$(mk_root multi-seat-root)"
cat > "$ROOT5/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window coder cursor coder --model auto
window coder@extra cursor coder-extra --model mystery-unmapped
CONF
OUT5A="$(MODEL_STEWARD_STATE_DIR="$STATE_DIR" zsh -c "
  source '$SWARMFORGE_SH' '$ROOT5'
  parse_config
  echo 'PARSE_CONFIG_RETURNED'
" 2>&1)" && RC5A=0 || RC5A=$?
[[ $RC5A -ne 0 ]] || fail "05a: an unmapped @-seat should refuse"
[[ "$OUT5A" == *"role 'coder@extra'"* ]] || fail "05a: refusal did not name the full seat id 'coder@extra' (got: $OUT5A)"

pass "05a: an @-seat's refusal names the full seat id, not its bare stage"

ROOT5B="$(mk_root multi-seat-pass-root)"
cat > "$ROOT5B/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window coder cursor coder --model auto
window coder@extra cursor coder-extra --model auto
CONF
OUT5B="$(MODEL_STEWARD_STATE_DIR="$STATE_DIR" zsh -c "
  source '$SWARMFORGE_SH' '$ROOT5B'
  parse_config
  echo 'PARSE_CONFIG_RETURNED'
" 2>&1)"
[[ "$OUT5B" == *"PARSE_CONFIG_RETURNED"* ]] \
  || fail "05b: an @-seat resolving to a model ranked+gated for its STAGE (coder) should staff, not refuse for a nonexistent 'coder@extra' matrix entry (got: $OUT5B)"

pass "05b: an @-seat is gated against its bare STAGE's role-matrix and compliance gate (mono-router rotate path coverage)"

echo "test_pack_staffing_gate_wiring: ALL CHECKS PASSED"
