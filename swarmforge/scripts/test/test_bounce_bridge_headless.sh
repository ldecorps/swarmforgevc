#!/usr/bin/env bash
# Smoke tests for bounce_bridge_headless.sh (compile → stop → start).
set -euo pipefail
set +m
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."

fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fixture() {
  local d; d="$(mktemp -d)"
  register_tmp_dir "$d"
  mkdir -p "$d/swarmforge/scripts" "$d/extension/out/tools" "$d/.swarmforge/operator"
  cp "$SRC/bounce_bridge_headless.sh" "$SRC/start_bridge_headless.sh" \
     "$SRC/stop_bridge_headless.sh" "$SRC/bridge_headless_supervisor.bb" \
     "$SRC/front_desk_supervisor_lib.bb" "$d/swarmforge/scripts/"
  # Stubs: record call order instead of real npm / supervisor.
  cat > "$d/swarmforge/scripts/start_bridge_headless.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:?}"; PORT="${2:-8765}"
if [[ "${BRIDGE_HEADLESS_LAUNCH_DRYRUN:-}" == "1" ]]; then
  printf 'DRYRUN start_bridge_headless supervisor cmd: bb stub %s\n' "$ROOT"
  exit 0
fi
printf 'start %s %s\n' "$ROOT" "$PORT" >> "$ROOT/.swarmforge/operator/bounce-calls.log"
echo "Started bridge-headless supervisor (pid 1) on port $PORT; log stub"
EOF
  cat > "$d/swarmforge/scripts/stop_bridge_headless.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "${1:-.}" && pwd)"
if [[ "${BRIDGE_HEADLESS_STOP_DRYRUN:-}" == "1" ]]; then
  printf 'DRYRUN stop_bridge_headless supervisor_pid=stub root=%s\n' "$ROOT"
  exit 0
fi
printf 'stop %s\n' "$ROOT" >> "$ROOT/.swarmforge/operator/bounce-calls.log"
echo "Stopped bridge-headless for $ROOT"
EOF
  chmod +x "$d/swarmforge/scripts/"*.sh
  printf '' > "$d/extension/out/tools/start-bridge-headless.js"
  printf '%s' "$d"
}

BOUNCE_IN() { echo "$1/swarmforge/scripts/bounce_bridge_headless.sh"; }
LOG_IN() { echo "$1/.swarmforge/operator/bounce-calls.log"; }

F="$(make_fixture)"
DRY="$(BRIDGE_HEADLESS_BOUNCE_DRYRUN=1 bash "$(BOUNCE_IN "$F")" "$F" 8765 2>&1)"
check "dry-run names root and port" '[[ "$DRY" == *"DRYRUN bounce_bridge_headless root=$F port=8765"* ]]'
check "dry-run plans compile" '[[ "$DRY" == *"DRYRUN compile: npm run compile"* ]]'
check "dry-run plans stop" '[[ "$DRY" == *"DRYRUN stop:"* ]]'
check "dry-run plans start" '[[ "$DRY" == *"DRYRUN start:"* ]]'
check "dry-run writes no call log" '[[ ! -f "$(LOG_IN "$F")" ]]'
rm -rf "$F"

F="$(make_fixture)"
DRY="$(BRIDGE_HEADLESS_BOUNCE_DRYRUN=1 BRIDGE_HEADLESS_SKIP_COMPILE=1 bash "$(BOUNCE_IN "$F")" "$F" 8765 2>&1)"
check "dry-run skip-compile prints skip" '[[ "$DRY" == *"DRYRUN skip compile"* ]]'
rm -rf "$F"

F="$(make_fixture)"
COMPILE_LOG="$(LOG_IN "$F")"
OUT="$(
  BRIDGE_HEADLESS_COMPILE_CMD="printf 'compile\n' >> '$COMPILE_LOG'" \
  BRIDGE_HEADLESS_SKIP_HEALTH=1 \
  bash "$(BOUNCE_IN "$F")" "$F" 9876 2>&1
)" && rc=0 || rc=$?
check "bounce exits 0 with stubs" '[[ "$rc" -eq 0 ]]'
ORDER="$(tr '\n' ' ' < "$(LOG_IN "$F")")"
check "bounce order is compile then stop then start" \
  '[[ "$ORDER" == *"compile"*"stop $F"*"start $F 9876"* ]]'
check "bounce announces compile" '[[ "$OUT" == *"compiling extension"* ]]'
check "bounce announces start" '[[ "$OUT" == *"starting headless bridge"* ]]'
rm -rf "$F"

F="$(make_fixture)"
OUT="$(
  BRIDGE_HEADLESS_SKIP_COMPILE=1 \
  BRIDGE_HEADLESS_SKIP_HEALTH=1 \
  bash "$(BOUNCE_IN "$F")" "$F" 8765 2>&1
)" && rc=0 || rc=$?
ORDER="$(tr '\n' ' ' < "$(LOG_IN "$F")")"
check "skip-compile still stops then starts" \
  '[[ "$rc" -eq 0 && "$ORDER" == *"stop $F"*"start $F 8765"* && "$ORDER" != *"compile"* ]]'
rm -rf "$F"

F="$(make_fixture)"
OUT="$(
  BRIDGE_HEADLESS_COMPILE_CMD='echo compile-failed >&2; exit 7' \
  BRIDGE_HEADLESS_SKIP_HEALTH=1 \
  bash "$(BOUNCE_IN "$F")" "$F" 8765 2>&1
)" && rc=0 || rc=$?
check "compile failure aborts before stop/start" \
  '[[ "$rc" -ne 0 && ! -f "$(LOG_IN "$F")" ]]'
rm -rf "$F"

if [[ "$fail" -eq 0 ]]; then
  echo "bounce_bridge_headless smoke: ALL CHECKS PASSED"
else
  echo "bounce_bridge_headless smoke: FAILURES"; exit 1
fi
