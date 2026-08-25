#!/usr/bin/env bash
# BL-888: root-scoped copilot teardown kill — unit scenarios.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KILL_SH="$SCRIPT_DIR/../kill_pipeline_swarm.sh"
ROOT="$(mktemp -d)"
PSF="$(mktemp)"
FIX_PID=""
trap 'rm -rf "$ROOT" "$PSF"; [[ -n "${FIX_PID}" ]] && kill "$FIX_PID" 2>/dev/null || true' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

eval "$(sed -n '/^copilot_pids_for_root()/,/^}/p' "$KILL_SH")"

# 01: other root — must not match THIS root
cat > "$PSF" <<EOF
 1111 copilot -C /other/project/.worktrees/coder --name SwarmForge coder
EOF
out="$(SWARMFORGE_COPILOT_PS_FILE="$PSF" copilot_pids_for_root "$ROOT" || true)"
[[ -z "$out" ]] || fail "01: other-root argv must not match, got: $out"
pass "01: sibling-root copilot argv is not matched"

# 02: this root — must match
cat > "$PSF" <<EOF
 3333 copilot -C $ROOT/.worktrees/coder --name SwarmForge coder
EOF
out="$(SWARMFORGE_COPILOT_PS_FILE="$PSF" copilot_pids_for_root "$ROOT" || true)"
echo "$out" | grep -qx '3333' || fail "02: expected pid 3333, got: $out"
pass "02: same-root copilot argv is matched"

# 03: missing SwarmForge marker — no match
cat > "$PSF" <<EOF
 4444 copilot -C $ROOT/x
EOF
out="$(SWARMFORGE_COPILOT_PS_FILE="$PSF" copilot_pids_for_root "$ROOT" || true)"
[[ -z "$out" ]] || fail "03: must require SwarmForge marker, got: $out"
pass "03: copilot without SwarmForge is ignored"

# 04: live foreign argv fixture is not matched for this ROOT
bash -c 'exec -a "copilot -C /foreign/root/.worktrees/x --name SwarmForge coder" sleep 120' &
FIX_PID=$!
sleep 0.2
if kill -0 "$FIX_PID" 2>/dev/null; then
  live="$(copilot_pids_for_root "$ROOT" || true)"
  echo "$live" | grep -qx "$FIX_PID" && fail "04: foreign fixture must not be matched for ROOT"
  kill -0 "$FIX_PID" 2>/dev/null || fail "04: foreign fixture died unexpectedly"
  kill "$FIX_PID" 2>/dev/null || true
  wait "$FIX_PID" 2>/dev/null || true
  FIX_PID=""
  pass "04: live foreign argv fixture is not matched for this ROOT"
else
  pass "04: skipped (could not spawn exec -a fixture)"
fi

# 05: production script must use matcher, not unscoped pkill
if grep -qE "pkill -f ['\"]copilot\.\*SwarmForge" "$KILL_SH"; then
  fail "05: unscoped pkill still present"
fi
grep -q 'copilot_pids_for_root' "$KILL_SH" || fail "05: matcher missing from kill script"
pass "05: kill script uses copilot_pids_for_root (no unscoped pkill)"

echo "ALL PASS"
