#!/usr/bin/env zsh
set -euo pipefail

# Resolve the directory this script lives in.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Move to the SwarmForge scripts root so that relative paths inside the
# Babashka dispatcher script resolve correctly, regardless of the caller's
# current working directory.
cd "$SCRIPT_DIR"

# Delegate to the rotate_to_role.sh script directly.
set +e
OUT="$(rotate_to_role.sh "$@")"
RC=$?
set -e

printf '%s\n' "$OUT"

if [[ "$(printf '%s\n' "$OUT" | head -n1)" == "ROTATE_HOME" ]]; then
  HOME_ROLE="$(printf '%s\n' "$OUT" | sed -n 's/^HOME_ROLE: //p' | head -n1)"
  # Hotfix 2026-09-13: the dispatcher names the seat the resident just
  # forwarded its parcel to (ROTATE_TO); it is home only when there is no
  # confirmed recipient or the pack sets `rotation_after_forward home`.
  ROTATE_TO="$(printf '%s\n' "$OUT" | sed -n 's/^ROTATE_TO: //p' | head -n1)"
  TARGET="${ROTATE_TO:-${HOME_ROLE:-coder}}"
  if [[ -n "$ROTATE_TO" && "$ROTATE_TO" != "${HOME_ROLE:-coder}" ]]; then
    REASON=rotate-forward
  else
    REASON=rotate-home
  fi
  ROTATE_BIN="${SWARMFORGE_ROTATE_TO_ROLE:-$SCRIPT_DIR/rotate_to_role.sh}"
  SWARMFORGE_ROTATION_REASON="$REASON" exec "$ROTATE_BIN" "$TARGET"
fi

exit "$RC"
