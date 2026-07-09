#!/usr/bin/env bash
# BL-114 issue-loop-01: closes the loop on a GitHub issue that seeded a raw
# backlog-root item, once the specifier has drained it into a spec under
# backlog/paused/. Comments the issue with the paused item's path and
# applies the swarm-specced label.
#
# Never blocks the pipeline (issue-loop-03): if `gh` auth is unavailable,
# prints a SKIP line and exits 0 rather than failing the specifier's turn.
#
# Usage: issue_specced.sh <issue-ref> <paused-path>
#   issue-ref:   a GitHub issue URL or number (anything `gh issue` accepts) -
#                the drained root item's own `source:` field or `id: GH-<n>`.
#   paused-path: the backlog/paused/<file>.yaml path just written.
#
# Testable without live GitHub: put a fake `gh` executable earlier on PATH
# (see test_issue_intake_loop.sh).

set -euo pipefail

ISSUE_REF="${1:?Usage: issue_specced.sh <issue-ref> <paused-path>}"
PAUSED_PATH="${2:?Usage: issue_specced.sh <issue-ref> <paused-path>}"

if ! gh auth status >/dev/null 2>&1; then
  echo "SKIP: gh auth unavailable - issue $ISSUE_REF not commented/labeled"
  exit 0
fi

SUMMARY="Specced: \`$PAUSED_PATH\` is ready in the swarm's paused backlog."
gh issue comment "$ISSUE_REF" --body "$SUMMARY" >/dev/null
gh issue edit "$ISSUE_REF" --add-label "swarm-specced" >/dev/null

echo "OK: commented and labeled $ISSUE_REF"
