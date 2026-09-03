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
# one that already does. Reached on BOTH commit-time paths, which are two
# different hooks rather than one: swarmforge/git-hooks/pre-commit execs
# swarmforge/scripts/run_commit_guards.sh, and swarmforge/git-hooks/pre-merge-commit
# - the only hook git fires for a clean `git merge --no-ff` - runs this guard
# itself. Both incidents above put `main` into the bad state BY MERGE, so
# wiring reached only from run_commit_guards.sh would have caught neither.
#
# The decision itself lives in the pure assessor
# (extension/src/tools/featureHandlerRegistrationCheck.ts, unit-tested under
# extension/test/); this script owns the branch gate and the delegation.
#
# Usage: check_feature_handler_registration.sh [repo-root] [--assume-main]
#   repo-root defaults to `git rev-parse --show-toplevel`.
#
#   --assume-main (BL-1375) skips the branch gate below and assesses the tree
#   whatever branch it is checked out on. The land step's tip-pure replay is
#   built on a scratch `land-replay/...` branch while BEING the tree about to
#   become main's tip, so without this the guard exits 0 on the branch name
#   alone and the land collects a pass it never performed. It can only ever
#   make the guard RUN where it would have skipped - there is no path here
#   that changes what the checker decides.
#
# Exit 0: any branch other than `main` (unless --assume-main), or a tree whose
#         every feature file resolves to a registered, runnable handler.
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
ASSUME_MAIN=0
REPO_ROOT_ARG=""
for arg in "$@"; do
  if [ "$arg" = "--assume-main" ]; then
    ASSUME_MAIN=1
  elif [ -z "$REPO_ROOT_ARG" ]; then
    REPO_ROOT_ARG="$arg"
  fi
done

REPO_ROOT="${REPO_ROOT_ARG:-$(git rev-parse --show-toplevel)}"
CHECKER="$SCRIPT_DIR/../../extension/out/tools/check-feature-handler-registration.js"

# A hook runs with GIT_DIR (and sometimes GIT_WORK_TREE) already exported, so
# `git -C` alone would not decide which repository is being asked about.
unset GIT_DIR GIT_WORK_TREE

if [[ "$ASSUME_MAIN" != "1" ]]; then
  BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
  if [[ "$BRANCH" != "main" ]]; then
    exit 0
  fi
fi

refuse() {
  echo "Commit refused: the feature-handler registration guard could not run: $1" >&2
  echo "This guard fails closed - a check it cannot run is never collected as a pass (BL-1303)." >&2
  exit 1
}

command -v node >/dev/null 2>&1 || refuse "node is not on PATH"
[[ -f "$CHECKER" ]] || refuse "$CHECKER is missing (run \`npm run compile\` from extension/)"

exec node "$CHECKER" "$REPO_ROOT"
