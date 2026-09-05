#!/usr/bin/env bash
# BL-1143 unit scenarios for cold_swap_day_shift_to_ollama_qwen.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWAP="$SCRIPT_DIR/../cold_swap_day_shift_to_ollama_qwen.sh"
REPO="$(cd "$SCRIPT_DIR/../../.." && pwd)"
source "$SCRIPT_DIR/lib/tmp_cleanup.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
register_tmp_dir "$ROOT"
mkdir -p "$ROOT/swarmforge/packs" "$ROOT/swarmforge/scripts" "$ROOT/backlog/evidence"

# Minimal mono pack + stub gates that succeed.
cp "$REPO/swarmforge/packs/ollama-qwen3-mono-router.conf" "$ROOT/swarmforge/packs/"
cp "$REPO/swarmforge/scripts/local_ollama_pack_shape_lib.sh" "$ROOT/swarmforge/scripts/"
cp "$REPO/swarmforge/scripts/local_ollama_pack_shape_gate.sh" "$ROOT/swarmforge/scripts/"
cp "$REPO/swarmforge/scripts/model_steward_lib.bb" "$ROOT/swarmforge/scripts/"
# Staffing gate stub: always pass.
cat > "$ROOT/swarmforge/scripts/local_coder_battery_staffing_gate.sh" <<'EOF'
#!/usr/bin/env bash
echo "BL-1127 staffing gate: stub pass"
exit 0
EOF
chmod +x "$ROOT/swarmforge/scripts/local_coder_battery_staffing_gate.sh"
# Pass battery so steward can align when injected.
cat > "$ROOT/backlog/evidence/BL-1127-coder-battery-ollama-qwen2.5-coder-20260825T180452Z.md" <<'EOF'
# BL-1127 coder battery — pass
- provider: ollama
- model: qwen2.5-coder
- result: pass
EOF
# start script stub
cat > "$ROOT/start-swarm-ollama-qwen.sh" <<'EOF'
#!/usr/bin/env bash
echo "START_STUB ollama-qwen3-mono-router"
exit 0
EOF
chmod +x "$ROOT/start-swarm-ollama-qwen.sh"

# Point SWAP's SCRIPT_DIR helpers at ROOT copies by running a wrapper that
# cds — actually SWAP uses its own SCRIPT_DIR. Copy the swap script and patch
# is heavy; instead invoke the real SWAP but override gates via copying into
# the real script dir is wrong. Simpler: run real SWAP against REPO in verify
# (integration) and for fixture use env COLD_SWAP with a thin copy.

# ── 01: verify on real repo writes day_shift_pack + evidence ──────────────
# Use a disposable overlay for day_shift file by running against ROOT with a
# local copy of the swap script that sources ROOT's scripts.
cp "$SWAP" "$ROOT/swarmforge/scripts/cold_swap_day_shift_to_ollama_qwen.sh"
chmod +x "$ROOT/swarmforge/scripts/cold_swap_day_shift_to_ollama_qwen.sh"

OUT01="$(bash "$ROOT/swarmforge/scripts/cold_swap_day_shift_to_ollama_qwen.sh" "$ROOT" --verify 2>&1)" \
  || fail "01: verify failed: $OUT01"
[[ -f "$ROOT/.swarmforge/day_shift_pack" ]] || fail "01: day_shift_pack missing"
[[ "$(cat "$ROOT/.swarmforge/day_shift_pack")" == "ollama-qwen3-mono-router" ]] \
  || fail "01: wrong day_shift_pack"
ls "$ROOT/backlog/evidence"/BL-1143-cold-swap-*.md >/dev/null \
  || fail "01: evidence missing"
echo "$OUT01" | grep -q 'VERIFY OK' || fail "01: expected VERIFY OK"
pass "01: verify sets day_shift_pack + evidence"

# ── 02: execute uses kill/start seams; never names qwen-forge ─────────────
KILL_LOG="$ROOT/kill.log"
START_LOG="$ROOT/start.log"
OUT02="$(
  COLD_SWAP_KILL_CMD="bash -c 'echo KILL >> \"$KILL_LOG\"'" \
  COLD_SWAP_START_CMD="bash -c 'echo START >> \"$START_LOG\"'" \
  bash "$ROOT/swarmforge/scripts/cold_swap_day_shift_to_ollama_qwen.sh" "$ROOT" --execute 2>&1
)" || fail "02: execute failed: $OUT02"
grep -q KILL "$KILL_LOG" || fail "02: kill seam not called"
grep -q START "$START_LOG" || fail "02: start seam not called"
echo "$OUT02" | grep -qi qwen-forge && fail "02: must not thrash qwen-forge"
EV="$(ls -1 "$ROOT/backlog/evidence"/BL-1143-cold-swap-*.md | sort | tail -1)"
grep -q 'qwen_forge: not launched' "$EV" || fail "02: evidence must deny qwen-forge"
pass "02: execute kill+start seams; no qwen-forge"

# ── 03: how-to exists on real repo ────────────────────────────────────────
[[ -f "$REPO/docs/how-to/BL-1143-cold-swap-day-shift-ollama-qwen.md" ]] \
  || fail "03: how-to missing (create before shipping)"
pass "03: how-to present"

# ── 04: no-winner-yet steward outcome is still allowed (BL-1140) ──────────
# Hardener: kills dropping no-winner-yet from the align allow-list.
rm -f "$ROOT/backlog/evidence"/BL-1127-coder-battery-*.md
OUT04="$(bash "$ROOT/swarmforge/scripts/cold_swap_day_shift_to_ollama_qwen.sh" "$ROOT" --verify 2>&1)" \
  || fail "04: verify without battery must still pass (no-winner-yet): $OUT04"
echo "$OUT04" | grep -qE 'OUTCOME=no-winner-yet|VERIFY OK' \
  || fail "04: expected no-winner-yet or VERIFY OK: $OUT04"
pass "04: no-winner-yet align path allowed"

rm -rf "$ROOT"
echo "BL-1143 cold_swap_day_shift: ALL PASS"
