#!/usr/bin/env bash
# BL-1158: recover_miniapp_bridge chooses rearm vs bounce by front-desk liveness.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."

fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fixture() {
  local d; d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/swarmforge/scripts" "$d/.swarmforge/operator"
  cp "$SRC/recover_miniapp_bridge.sh" "$d/swarmforge/scripts/"
  cat > "$d/swarmforge/scripts/rearm_front_desk_bridge.sh" <<'EOF'
#!/usr/bin/env bash
echo "REARM_STUB root=$1 port=$2"
exit 0
EOF
  cat > "$d/swarmforge/scripts/bounce_bridge_headless.sh" <<'EOF'
#!/usr/bin/env bash
echo "BOUNCE_STUB root=$1 port=$2"
exit 0
EOF
  chmod +x "$d/swarmforge/scripts/rearm_front_desk_bridge.sh" \
            "$d/swarmforge/scripts/bounce_bridge_headless.sh"
  printf '%s' "$d"
}

RECOVER_IN() { echo "$1/swarmforge/scripts/recover_miniapp_bridge.sh"; }

F="$(make_fixture)"
sleep 300 &
FD_PID=$!
echo "$FD_PID" > "$F/.swarmforge/operator/front-desk-supervisor.pid"
OUT="$(bash "$(RECOVER_IN "$F")" "$F" 8765 2>&1)" && rc=0 || rc=$?
check "live front desk -> rearm stub" \
  '[[ "$rc" -eq 0 && "$OUT" == *"REARM_STUB"* && "$OUT" != *"BOUNCE_STUB"* ]]'
kill "$FD_PID" 2>/dev/null || true
rm -rf "$F"

F="$(make_fixture)"
OUT="$(bash "$(RECOVER_IN "$F")" "$F" 8765 2>&1)" && rc=0 || rc=$?
check "no front desk -> bounce stub" \
  '[[ "$rc" -eq 0 && "$OUT" == *"BOUNCE_STUB"* && "$OUT" != *"REARM_STUB"* ]]'
rm -rf "$F"

if [[ "$fail" -eq 0 ]]; then
  echo "recover_miniapp_bridge smoke: ALL CHECKS PASSED"
else
  echo "recover_miniapp_bridge smoke: FAILURES"; exit 1
fi
