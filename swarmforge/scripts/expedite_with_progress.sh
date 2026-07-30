#!/usr/bin/env bash
# Run expedite with preflight gates and Telegram progress updates.
#
# Usage:
#   expedite_with_progress.sh [<project-root>] <BL-id> [expedite options...]
#
# Examples:
#   ./swarmforge/scripts/expedite_with_progress.sh BL-696
#   ./swarmforge/scripts/expedite_with_progress.sh /path/to/repo BL-696 --dry-run
#
# Env:
#   Sources .swarmforge/swarm.env when present (CURSOR_API_KEY, Telegram vars).
#   EXPEDITE_NOTIFY=0          skip Telegram progress watcher
#   EXPEDITE_SKIP_PREFLIGHT=1  skip compile + scoped vitest
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "Usage: expedite_with_progress.sh [<project-root>] <BL-id> [expedite options...]" >&2
  exit 2
fi

if [[ "$1" =~ ^BL-[0-9]+$ ]]; then
  ROOT="$DEFAULT_ROOT"
  TICKET="$1"
  shift
else
  ROOT="$(cd "$1" && pwd)"
  TICKET="${2:?usage: expedite_with_progress.sh [<project-root>] <BL-id>}"
  shift 2
fi

SWARM_ENV="$ROOT/.swarmforge/swarm.env"
if [[ -f "$SWARM_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$SWARM_ENV"
fi

RUN_DIR="$ROOT/.swarmforge/expedite/$TICKET"
mkdir -p "$RUN_DIR"

NOTIFY_PID=""
cleanup() {
  if [[ -n "${NOTIFY_PID:-}" ]] && kill -0 "$NOTIFY_PID" 2>/dev/null; then
    kill "$NOTIFY_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ "${EXPEDITE_NOTIFY:-1}" != "0" ]]; then
  bb "$SCRIPT_DIR/expedite_progress_notify.bb" "$ROOT" "$TICKET" &
  NOTIFY_PID=$!
  echo "expedite-with-progress: telegram notifier pid=$NOTIFY_PID"
fi

if [[ "${EXPEDITE_SKIP_PREFLIGHT:-}" != "1" ]]; then
  echo "expedite-with-progress: preflight compile + scoped vitest"
  (cd "$ROOT/extension" && npm run compile)
  (cd "$ROOT/extension" && npx vitest run --config vitest.letsTalkCursorBridge.config.mjs)
  if [[ "$TICKET" == "BL-696" ]]; then
    (cd "$ROOT/extension" && npm run crap:lets-talk-cursor-bridge)
    (cd "$ROOT/extension" && npm run coverage:lets-talk-cursor-bridge)
  fi
fi

set +e
"$SCRIPT_DIR/expedite.sh" "$ROOT" "$TICKET" "$@"
EXIT=$?
set -e

if [[ -n "${NOTIFY_PID:-}" ]]; then
  bb "$SCRIPT_DIR/expedite_progress_notify.bb" "$ROOT" "$TICKET" --once || true
  kill "$NOTIFY_PID" 2>/dev/null || true
  NOTIFY_PID=""
fi

if [[ -f "$RUN_DIR/progress.json" ]]; then
  echo "expedite-with-progress: final progress:"
  cat "$RUN_DIR/progress.json"
fi

exit "$EXIT"
