#!/usr/bin/env bash
# BL-1162: remove every swarmforge cron line scoped to this project root.
# Supersedes uninstall_freshness_cron.sh for the full-stack stop path.
#
# Usage: uninstall_swarmforge_crons.sh <project-root>
set -euo pipefail

ROOT="${1:?usage: uninstall_swarmforge_crons.sh <project-root>}"
ROOT="$(cd "$ROOT" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/swarmforge_cron_lib.sh"

if ! command -v crontab >/dev/null 2>&1; then
  echo "uninstall_swarmforge_crons.sh: no crontab command on this host; nothing to remove for $ROOT" >&2
  exit 0
fi

existing="$(crontab -l 2>/dev/null || true)"

# BL-1382: say what is being LEFT, not only what is removed. An unmarked line
# naming this root is the human's, and reporting it is how they see that the
# tool noticed it and chose not to touch it (human ruling, 2026-09-04). This
# runs before the early exit below, because "no swarmforge lines for R" is
# exactly the case where a human's line naming R is most likely present.
printf '%s\n' "$existing" | swarmforge_cron_report_unmarked "$ROOT"

if ! swarmforge_cron_root_has_lines "$ROOT" "$existing"; then
  echo "No swarmforge cron lines for $ROOT"
  exit 0
fi

filtered="$(printf '%s\n' "$existing" | swarmforge_cron_filter_out_root "$ROOT")"
remaining="$(printf '%s\n' "$filtered" | grep -v '^$' || true)"
if [[ -z "$remaining" ]]; then
  crontab -r 2>/dev/null || true
else
  printf '%s\n' "$remaining" | crontab -
fi

echo "Removed all swarmforge cron lines for $ROOT"
