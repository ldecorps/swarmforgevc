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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${1:-$(git rev-parse --show-toplevel)}"
GUARD_DIR="${SWARMFORGE_COMMIT_GUARD_DIR:-$REPO_ROOT/swarmforge/scripts}"
GUARD_CHAIN_LABEL="pre-commit"

# BL-1303: run_guard/report_refusals moved to a sourced lib when
# pre-merge-commit grew a chain of its own. Both callers must run every
# guard and report every violation in one refusal, and the one way to get
# that wrong is shared - so the aggregation is shared too, rather than
# copied and left to drift.
# This file runs WITHOUT `set -e` too, so a failed source would leave
# run_guard undefined and the chain would fall through to `exit 0` - every
# guard silently skipped. Refuse instead.
if [ ! -r "$SCRIPT_DIR/commit_guard_chain_lib.sh" ]; then
  echo "pre-commit: COMMIT REFUSED. The guard chain could not be loaded: $SCRIPT_DIR/commit_guard_chain_lib.sh is missing or unreadable." >&2
  exit 1
fi
# shellcheck source=commit_guard_chain_lib.sh
. "$SCRIPT_DIR/commit_guard_chain_lib.sh"

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
# BL-1385: registration is not loadability. The guard above proves a feature's
# handler is registered and reachable; it never loads one. A hand-land on main
# bypasses the land replay entirely - which is exactly how a93aa4a18f reached
# main on 2026-09-04 - so the load question has to be asked here too, not only
# in the replay's tree-guard list.
run_guard check_handler_module_graph.sh
# BL-1395: registration and loadability are still not the same thing, and a
# handler graph is not a Babashka script. SCI analyses a defn EAGERLY, so a
# forward reference or a runtime require fails at LOAD - three such files
# reached main in eight days, the last crash-looping the live daemon, and that
# land's whole verification was three greps for required_wiring labels. This
# guard loads what the commit changed and BOOTS handoffd, because a grep for a
# label is not proof a file loads.
run_guard check_bb_scripts_load.sh
# BL-1428: a standing red must name an open ticket. A git index read, same
# cost class as the other cheap-tier guards.
run_guard check_standing_red_register.sh
# BL-1440: a staged constitution article must never cite a docs/ path that
# does not resolve. Skips (cheap) when no article is staged.
run_guard check_constitution_doc_citations.sh

if guard_chain_has_refusal; then
  report_refusals
  exit "$guard_chain_status"
fi

# ── Tier 2: the expensive guard, reached only by a commit every cheap guard
#    allows. Deferring it must never mean skipping it. ────────────────────────
run_guard check_property_suite_drift.sh

if guard_chain_has_refusal; then
  report_refusals
fi

exit "$guard_chain_status"
