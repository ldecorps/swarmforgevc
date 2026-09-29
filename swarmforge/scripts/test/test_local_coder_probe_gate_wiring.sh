#!/usr/bin/env bash
# BL-1702: proves local_coder_probe_gate is actually wired into
# swarmforge.sh's real parse_config (required_wiring anchor 1) - not just
# callable in isolation. Sources the REAL swarmforge.sh (never a copy)
# against isolated fixture roots, with LOCAL_CODER_PROBE_EVIDENCE_DIR
# pointed at controlled fixture evidence so the decision is deterministic
# regardless of this checkout's own live steward evidence. The pure
# decision table lives in local_coder_probe_gate_lib_test_runner.bb; the
# CLI fs-adapter has its own coverage via the acceptance feature; this file
# is the ONE place that proves swarmforge.sh's own parse_config loop
# actually calls the gate, that a refusal happens before parse_config
# returns (before any tmux window could exist), and that
# PACK_STAFFING_SKIP_GATE=1 - the pre-existing BL-1318 escape hatch a real
# local-model pack ALWAYS needs, since no loopback host is in
# pack_staffing_gate_lib.bb's api-base-host-providers table - does NOT
# also bypass this newer, independent gate (the ticket's own FIRM
# invariant).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mk_root() {
  local root="$WORK/$1"
  mkdir -p "$root/swarmforge/roles" "$root/.swarmforge"
  touch "$root/swarmforge/constitution.prompt"
  for role in specifier coder "coder@2" cleaner architect hardender documenter QA; do
    local stage="${role%%@*}"
    echo "role prompt" > "$root/swarmforge/roles/$stage.prompt"
  done
  echo "$root"
}

DRIVER_LINE='window coder@2 aider coder2 --model openai/qwen3-14b:latest --openai-api-base http://127.0.0.1:11434/v1 --seat-tier easy'

# ── 1: a driver seat with NO evidence at all refuses, before parse_config
#    returns - i.e. before any tmux window is ever opened. ──────────────────
ROOT1="$(mk_root refuse-root)"
cat > "$ROOT1/swarmforge/swarmforge.conf" <<CONF
config active_backlog_max_depth -1
window coder claude coder --model claude-sonnet-5 --seat-tier hard
$DRIVER_LINE
window specifier claude master --model claude-opus-5-5
CONF

EMPTY_EVIDENCE="$WORK/empty-evidence"
mkdir -p "$EMPTY_EVIDENCE"

OUT1="$(LOCAL_CODER_PROBE_EVIDENCE_DIR="$EMPTY_EVIDENCE" PACK_STAFFING_SKIP_GATE=1 zsh -c "
  source '$SWARMFORGE_SH' '$ROOT1'
  parse_config
  echo 'PARSE_CONFIG_RETURNED'
" 2>&1)" && RC1=0 || RC1=$?

[[ $RC1 -ne 0 ]] || fail "01: a driver seat with no probe summary should have refused parse_config"
[[ "$OUT1" == *"local coder probe gate refused this launch"* ]] || fail "01: refusal did not name the gate (got: $OUT1)"
[[ "$OUT1" == *"no probe summary"* ]] || fail "01: refusal did not cite 'no probe summary' (got: $OUT1)"
[[ "$OUT1" == *"qwen3-14b:latest"* ]] || fail "01: refusal did not name the model (got: $OUT1)"
[[ "$OUT1" != *"PARSE_CONFIG_RETURNED"* ]] || fail "01: parse_config returned instead of refusing before completion"

pass "01: refuses a driver seat with no probe summary, before parse_config (and so before any tmux window) completes"

# ── 2: PACK_STAFFING_SKIP_GATE=1 (needed here just to clear BL-1318's own
#    pack_staffing_gate for an unmapped loopback aider seat) does NOT also
#    turn THIS gate's refusal into an override - it stays a hard refusal. ──
OUT2="$(LOCAL_CODER_PROBE_EVIDENCE_DIR="$EMPTY_EVIDENCE" PACK_STAFFING_SKIP_GATE=1 zsh -c "
  source '$SWARMFORGE_SH' '$ROOT1'
  parse_config
  echo 'PARSE_CONFIG_RETURNED'
" 2>&1)" && RC2=0 || RC2=$?
[[ $RC2 -ne 0 ]] || fail "02: PACK_STAFFING_SKIP_GATE=1 must not bypass the local coder probe gate"
[[ "$OUT2" == *"local coder probe gate refused this launch"* ]] || fail "02: expected the SAME refusal under PACK_STAFFING_SKIP_GATE=1 (got: $OUT2)"
[[ "$OUT2" != *"WARNING: pack staffing gate OVERRIDE"* ]] || true # BL-1318's own override warning may legitimately print for the unmapped seat
[[ "$OUT2" != *"PARSE_CONFIG_RETURNED"* ]] || fail "02: parse_config returned under PACK_STAFFING_SKIP_GATE=1 instead of refusing"

pass "02: PACK_STAFFING_SKIP_GATE=1 clears the OLDER staffing gate but never this one - still a hard refusal"

# ── 3: a driver seat WITH a passing summary lets parse_config complete. ─────
ROOT3="$(mk_root pass-root)"
cat > "$ROOT3/swarmforge/swarmforge.conf" <<CONF
config active_backlog_max_depth -1
window coder claude coder --model claude-sonnet-5 --seat-tier hard
$DRIVER_LINE
window specifier claude master --model claude-opus-5-5
CONF

PASS_EVIDENCE="$WORK/pass-evidence"
mkdir -p "$PASS_EVIDENCE"
cat > "$PASS_EVIDENCE/local-coder-probe-qwen3-14b-latest-2026-09-27T00-00-00Z.md" <<'MD'
# local coder probe: qwen3-14b:latest

handed off 4 of 5 - verdict pass
MD

OUT3="$(LOCAL_CODER_PROBE_EVIDENCE_DIR="$PASS_EVIDENCE" PACK_STAFFING_SKIP_GATE=1 zsh -c "
  source '$SWARMFORGE_SH' '$ROOT3'
  parse_config
  echo 'PARSE_CONFIG_RETURNED'
" 2>&1)"
[[ "$OUT3" == *"PARSE_CONFIG_RETURNED"* ]] || fail "03: a driver seat with a passing probe summary should have let parse_config complete (got: $OUT3)"
[[ "$OUT3" != *"local coder probe gate refused"* ]] || fail "03: a passing summary must not refuse"

pass "03: a driver seat with a passing steward probe summary staffs, parse_config completes"

# ── 4: a pack with NO driver seat at all is untouched, whatever evidence
#    is (or is not) present - this gate is a silent no-op for every
#    existing pack. ───────────────────────────────────────────────────────
ROOT4="$(mk_root no-driver-root)"
cat > "$ROOT4/swarmforge/swarmforge.conf" <<'CONF'
config active_backlog_max_depth -1
window coder claude coder --model claude-sonnet-5 --seat-tier hard
window specifier claude master --model claude-opus-5-5
CONF

OUT4="$(LOCAL_CODER_PROBE_EVIDENCE_DIR="$EMPTY_EVIDENCE" PACK_STAFFING_SKIP_GATE=1 zsh -c "
  source '$SWARMFORGE_SH' '$ROOT4'
  parse_config
  echo 'PARSE_CONFIG_RETURNED'
" 2>&1)"
[[ "$OUT4" == *"PARSE_CONFIG_RETURNED"* ]] || fail "04: a pack with no driver seat should never be refused by this gate (got: $OUT4)"
[[ "$OUT4" != *"local coder probe gate refused"* ]] || fail "04: this gate must never fire when there is no driver seat (got: $OUT4)"

pass "04: a pack with no driver seat is a silent no-op for this gate"

echo "test_local_coder_probe_gate_wiring: ALL CHECKS PASSED"
