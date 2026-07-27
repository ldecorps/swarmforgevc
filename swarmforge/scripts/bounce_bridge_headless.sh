#!/usr/bin/env bash
# Compiles the Mini App bridge (extension TypeScript) and restarts the
# supervised headless bridge so the new build is live on the console.
#
# Usage: bounce_bridge_headless.sh [project-root] [port]
#
# Order: compile → stop → start. A compile failure leaves the live bridge up.
# start_bridge_headless is idempotent when already running, so stop is required
# to load the freshly compiled entrypoint.
#
# Env:
#   BRIDGE_HEADLESS_BOUNCE_DRYRUN=1   print plan, change nothing
#   BRIDGE_HEADLESS_SKIP_COMPILE=1    restart only (skip npm run compile)
#   BRIDGE_HEADLESS_COMPILE_CMD       override compile command (tests)
#   BRIDGE_HEADLESS_SKIP_HEALTH=1     skip post-start /lets-talk probe
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ROOT="$(cd "${1:-$DEFAULT_ROOT}" && pwd)"
PORT="${2:-8765}"
EXTENSION_DIR="$ROOT/extension"
START_SH="$SCRIPT_DIR/start_bridge_headless.sh"
STOP_SH="$SCRIPT_DIR/stop_bridge_headless.sh"
HEALTH_URL="http://127.0.0.1:${PORT}/lets-talk"
HEALTH_ATTEMPTS="${BRIDGE_HEADLESS_HEALTH_ATTEMPTS:-40}"

if [[ ! -f "$START_SH" || ! -f "$STOP_SH" ]]; then
  echo "bounce_bridge_headless: start/stop scripts missing under $SCRIPT_DIR" >&2
  exit 1
fi

if [[ "${BRIDGE_HEADLESS_BOUNCE_DRYRUN:-}" == "1" ]]; then
  printf 'DRYRUN bounce_bridge_headless root=%s port=%s\n' "$ROOT" "$PORT"
  if [[ "${BRIDGE_HEADLESS_SKIP_COMPILE:-}" == "1" ]]; then
    printf 'DRYRUN skip compile\n'
  else
    printf 'DRYRUN compile: npm run compile (cwd %s)\n' "$EXTENSION_DIR"
  fi
  printf 'DRYRUN stop: %s %s\n' "$STOP_SH" "$ROOT"
  printf 'DRYRUN start: %s %s %s\n' "$START_SH" "$ROOT" "$PORT"
  exit 0
fi

if [[ "${BRIDGE_HEADLESS_SKIP_COMPILE:-}" != "1" ]]; then
  if [[ ! -d "$EXTENSION_DIR" ]]; then
    echo "bounce_bridge_headless: extension dir not found: $EXTENSION_DIR" >&2
    exit 1
  fi
  echo "bounce_bridge_headless: compiling extension…"
  if [[ -n "${BRIDGE_HEADLESS_COMPILE_CMD:-}" ]]; then
    # shellcheck disable=SC2086
    (cd "$EXTENSION_DIR" && eval "$BRIDGE_HEADLESS_COMPILE_CMD")
  else
    (cd "$EXTENSION_DIR" && npm run compile)
  fi
fi

echo "bounce_bridge_headless: stopping headless bridge…"
bash "$STOP_SH" "$ROOT"

echo "bounce_bridge_headless: starting headless bridge on port $PORT…"
bash "$START_SH" "$ROOT" "$PORT"

if [[ "${BRIDGE_HEADLESS_SKIP_HEALTH:-}" == "1" ]]; then
  echo "bounce_bridge_headless: done (health probe skipped)"
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "bounce_bridge_headless: done (curl missing; skipped /lets-talk probe)"
  exit 0
fi

ok=0
for (( attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++ )); do
  if curl -sf --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 0.25
done

if [[ "$ok" -ne 1 ]]; then
  echo "bounce_bridge_headless: bridge started but $HEALTH_URL not healthy yet" >&2
  echo "  check: $ROOT/.swarmforge/operator/bridge-headless-supervisor.log" >&2
  exit 1
fi

echo "bounce_bridge_headless: live — $HEALTH_URL ok"
