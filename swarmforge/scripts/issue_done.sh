#!/usr/bin/env bash
# BL-114 issue-loop-02: closes the loop on a GitHub issue once its backlog
# item has merged into main and moved to backlog/done/. Comments the merge
# commit and closes the issue.
#
# Never blocks the pipeline (issue-loop-03): if `gh` auth is unavailable,
# prints a SKIP line and exits 0 rather than failing the closing role's
# turn.
#
# Usage: issue_done.sh <issue-ref> <merge-commit>
#   issue-ref:    a GitHub issue URL or number (anything `gh issue` accepts).
#   merge-commit: the commit hash the parcel merged into main as.
#
# Testable without live GitHub: put a fake `gh` executable earlier on PATH
# (see test_issue_intake_loop.sh).

set -euo pipefail

ISSUE_REF="${1:?Usage: issue_done.sh <issue-ref> <merge-commit>}"
MERGE_COMMIT="${2:?Usage: issue_done.sh <issue-ref> <merge-commit>}"

if ! gh auth status >/dev/null 2>&1; then
  echo "SKIP: gh auth unavailable - issue $ISSUE_REF not commented/closed"
  exit 0
fi

gh issue comment "$ISSUE_REF" --body "Merged: \`$MERGE_COMMIT\`." >/dev/null
gh issue close "$ISSUE_REF" >/dev/null

echo "OK: commented and closed $ISSUE_REF"
