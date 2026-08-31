#!/usr/bin/env bash
# BL-1303: refuses a commit or merge-commit on `main` that would leave a
# feature file with no runnable step handler.
#
# specs/pipeline/runtime.js THROWS on any scenario whose steps no registered
# handler matches. Nothing refused the state that creates, so a feature file
# could land with its handler unregistered - or with the handler registered
# but a script it executes missing - and the failure surfaced later, to
# whichever role next ran the suite, against a parcel that did not cause it.
# Observed 2026-08-30 on BL-1253: a bounce-revert removed a handler, its lib
# script and its index.js registration together; a later merge resurrected the
# handler and the feature but neither the registration nor the lib, and `main`
# carried 8 scenarios that all failed.
#
# Sits beside check_pipeline_code_on_main.sh in the commit-guard chain, which
# already refuses a bad `main` tip before it exists rather than reacting to
# one that already does. Delegated to from swarmforge/scripts/run_commit_guards.sh,
# which both swarmforge/git-hooks/pre-commit and pre-merge-commit exec.
#
# The decision itself lives in the pure assessor
# (extension/src/tools/featureHandlerRegistrationCheck.ts, unit-tested under
# extension/test/); this script owns the branch gate and the delegation.
#
# Usage: check_feature_handler_registration.sh [repo-root]
#   repo-root defaults to `git rev-parse --show-toplevel`.
#
# Exit 0: any branch other than `main`, or a tree whose every feature file
#         resolves to a registered, runnable handler.
# Exit 1: at least one offender - ALL of them named in one refusal (Article
#         4.4's shape applied in a gate; a guard that stopped at the first
#         would reproduce the one-defect-at-a-time loop that rule prevents) -
#         or the checker itself could not be run, which is a refusal naming
#         the reason rather than a silent pass.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The tree under examination. The checker itself always comes from THIS
# script's own checkout, so a caller may point the guard at any repository
# (the acceptance fixture points it at a scratch one) without that repository
# needing a compiled extension of its own.
REPO_ROOT="${1:-$(git rev-parse --show-toplevel)}"
CHECKER="$SCRIPT_DIR/../../extension/out/tools/check-feature-handler-registration.js"

# A hook runs with GIT_DIR (and sometimes GIT_WORK_TREE) already exported, so
# `git -C` alone would not decide which repository is being asked about.
unset GIT_DIR GIT_WORK_TREE

BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
if [[ "$BRANCH" != "main" ]]; then
  exit 0
fi

refuse() {
  echo "Commit refused: the feature-handler registration guard could not run: $1" >&2
  echo "This guard fails closed - a check it cannot run is never collected as a pass (BL-1303)." >&2
  exit 1
}

command -v node >/dev/null 2>&1 || refuse "node is not on PATH"
[[ -f "$CHECKER" ]] || refuse "$CHECKER is missing (run \`npm run compile\` from extension/)"

exec node "$CHECKER" "$REPO_ROOT"
