#!/usr/bin/env zsh
set -euo pipefail

# Resolve the directory this script lives in.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Move to the SwarmForge scripts root so that relative paths inside the
# Babashka ready_for_next.bb helper resolve correctly, regardless of the
# caller's current working directory.
cd "$SCRIPT_DIR"

# Delegate to the Babashka dispatcher script, capturing (not exec-ing) its
# stdout: BL-550 needs to inspect the first line for ROTATE_HOME before
# deciding whether to hand off to rotate_to_role.sh. The exit code is
# preserved exactly as a plain exec would have propagated it.
set +e
OUT="$(bb "$SCRIPT_DIR/ready_for_next.bb" "$@")"
RC=$?
set -e

printf '%s\n' "$OUT"

if [[ "$(printf '%s\n' "$OUT" | head -n1)" == "ROTATE_HOME" ]]; then
  HOME_ROLE="$(printf '%s\n' "$OUT" | sed -n 's/^HOME_ROLE: //p' | head -n1)"
  ROTATE_BIN="${SWARMFORGE_ROTATE_TO_ROLE:-$SCRIPT_DIR/rotate_to_role.sh}"
  exec "$ROTATE_BIN" "${HOME_ROLE:-coder}"
fi

exit "$RC"
