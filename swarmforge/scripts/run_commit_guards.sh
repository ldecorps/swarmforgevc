#!/usr/bin/env bash
# BL-1252: the pre-commit guard chain, extracted so it reports EVERY
# violation in ONE refusal instead of one violation per commit attempt.
#
# The hook used to run four guards as four sequential commands under
# `set -euo pipefail`. All four end in their own `exit 1`, so the first one
# that refused aborted the hook and the rest never ran. A commit violating
# three guards cost three attempts: fix the size, re-commit, learn about the
# deletion, fix it, re-commit, learn about the pipeline paths. Constitutional
# Article 4.4 forbids exactly that of a reviewing role - "never bounce at the
# FIRST defect; finish the full checklist, send one bounce with every defect"
# - and a pre-commit hook is a reviewing gate.
#
# Same shape the sibling commit-msg hook already uses (BL-1242, 61735035f):
# `set -uo pipefail` across the chain with NO `-e`, one status captured per
# call, the combined status exited. Each guard's own body still runs under
# its own `set -euo pipefail`, so nothing about what a guard DECIDES changes
# here - this file alters the completeness of the report, never the refusal
# predicate.
#
# The two tiers are not a preference, they are a cost asymmetry:
# check_property_suite_drift.sh runs `npm run test:properties`, while the
# others read the git index (or, for BL-1303's guard, the step registry) and
# exit. Completeness is therefore required WITHIN the cheap tier, and the
# expensive tier is reached only when the cheap ones pass - so a full suite
# run is never charged to a commit that is already refused. It still runs on
# every commit those guards allow, which is every commit that is going to
# succeed.
#
# Usage: run_commit_guards.sh [repo-root]
#   repo-root defaults to `git rev-parse --show-toplevel`.
#   SWARMFORGE_COMMIT_GUARD_DIR overrides where the guard scripts are found
#   (a seam for tests and for the acceptance fixture, which wraps the real
#   guards; never a way to change what a guard decides).
set -uo pipefail

REPO_ROOT="${1:-$(git rev-parse --show-toplevel)}"
GUARD_DIR="${SWARMFORGE_COMMIT_GUARD_DIR:-$REPO_ROOT/swarmforge/scripts}"

status=0
refused=""
unexpected=""

# Runs one guard, never aborting the chain. A guard's OWN refusal is exit 1;
# anything else non-zero (a crash, a missing script's 127, a bad argument) is
# an unexpected failure - which still refuses the commit. Aggregating exit
# codes must never convert an error into a pass.
run_guard() {
  local script="$1"
  shift
  local st=0
  "$GUARD_DIR/$script" "$@" || st=$?
  if [ "$st" -ne 0 ]; then
    status="$st"
    refused="${refused}${refused:+ }${script}"
    if [ "$st" -ne 1 ]; then
      unexpected="${unexpected}${unexpected:+ }${script} (exit ${st})"
    fi
  fi
  return 0
}

report_refusals() {
  echo "" >&2
  echo "pre-commit: COMMIT REFUSED. Guards reporting a violation: ${refused}" >&2
  if [ -n "$unexpected" ]; then
    echo "pre-commit: these guards did not refuse cleanly - they failed unexpectedly (a crash, a missing script, or any non-refusal exit): ${unexpected}" >&2
    echo "pre-commit: an unexpected failure still refuses the commit; it is never collected as a pass." >&2
  fi
  echo "pre-commit: every guard in this tier ran, so the list above is complete - there is no second violation waiting for your next attempt (Article 4.4)." >&2
}

# ── Tier 1: the cheap guards. All of them run, whatever any one decides. ──
# Order is the hook's original order and is deliberately unchanged, so a
# committer with exactly one violation sees the same one they see today.
run_guard check_commit_size.sh 50
run_guard check_ticket_deletion.sh
run_guard check_pipeline_code_on_main.sh
# BL-1303: also a `main`-only guard, and it exits before doing any work on
# every other branch - so it joins the cheap tier even though the work it
# does on `main` is a node process reading the step registry, not a git
# index read.
run_guard check_feature_handler_registration.sh

if [ -n "$refused" ]; then
  report_refusals
  exit "$status"
fi

# ── Tier 2: the expensive guard, reached only by a commit the cheap three
#    allow. Deferring it must never mean skipping it. ─────────────────────────
run_guard check_property_suite_drift.sh

if [ -n "$refused" ]; then
  report_refusals
fi

exit "$status"
