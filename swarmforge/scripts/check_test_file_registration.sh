#!/usr/bin/env bash
# BL-1424: refuses a commit that STAGES a new test file under
# swarmforge/scripts/test/ (a suite_inventory_lib.bb test-file? shape) with
# no row in the STAGED suite-manifest.tsv. BL-1240 asks this same question
# at a parcel's git_handoff send, so it never sees a commit made outside any
# parcel - a hotfix straight onto main sends no handoff at all. Hotfix
# 27d6ab8630 added two such files on 2026-09-02 and the standing suite
# refused every run for three days before a coordinator sweep noticed
# (BL-1423).
#
# Runs on EVERY commit, in every checkout - not only on main. A hotfix is a
# commit on main, but a branch commit merged later would then need a second
# check at merge time; one guard at the commit covers both, and the cost to
# a role branch is one re-commit with the exact row quoted, no more than
# BL-1240 already asks of a git_handoff.
#
# PARCEL-... no, COMMIT-SCOPED (invariant 1, the load-bearing property): the
# decision (unregistered_test_gate_lib.bb's findings-for-staged-commit) asks
# only about THIS commit's own staged additions (`git diff --cached
# --diff-filter=A`). Pre-existing drift in the tree - a file an earlier
# commit left unregistered - is never this commit's fault and never refuses
# it; a tree-wide check here would refuse every commit in the repository on
# drift its author did not create, exactly the relocation BL-1240's own
# header refuses to make.
#
# ONE NOTION OF REGISTERED (invariant 2): what counts as a test file and
# what a manifest row says both come from suite_inventory_lib.bb, through
# unregistered_test_gate_lib.bb's own shared findings-for-staged-commit /
# findings-for-git-handoff - never a second, independently-maintained
# notion of "registered".
#
# FAIL-OPEN IS ABSOLUTE (invariant 3): an unreadable index or an unreadable
# STAGED manifest WARNS to stderr and exits 0, same posture as BL-1240's own
# gate. The guard never runs a test and reads only the git index (`git diff
# --cached`, `git show :<path>`) - never unstaged working-tree state.
#
# This guard is a thin shell wrapper (the direction this ticket states):
# the decision lives in unregistered_test_gate_lib.bb, reached through
# check_test_file_registration_cli.bb (IO/argv only, task_scope_gate_cli.bb's
# own shape) - never re-implemented here.
#
# Usage: check_test_file_registration.sh [commit-message-file]
#   The message-file argument is accepted for interface parity with the
#   other pre-commit guards but unused - registration never depends on
#   commit message text.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$SCRIPT_DIR/check_test_file_registration_cli.bb"

if ! command -v bb >/dev/null 2>&1; then
  echo "check_test_file_registration: WARNING - babashka is not on PATH; skipping." >&2
  exit 0
fi

if [[ ! -r "$CLI" ]]; then
  echo "check_test_file_registration: WARNING - CLI missing at $CLI; skipping." >&2
  exit 0
fi

OUT="$(bb "$CLI" 2>&1)"
STATUS=$?

if [[ "$STATUS" -ne 0 ]]; then
  echo "check_test_file_registration: COMMIT REFUSED." >&2
  printf '%s\n' "$OUT" >&2
  exit 1
fi

# A WARNING (fail-open) still prints - visible, never silent - but never
# refuses.
if [[ "$OUT" != "OK" ]]; then
  printf '%s\n' "$OUT" >&2
fi

exit 0
