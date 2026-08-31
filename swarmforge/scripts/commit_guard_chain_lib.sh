#!/usr/bin/env bash
# BL-1303: the guard-chain aggregation, sourced rather than duplicated.
#
# Two hooks now run a chain of independent guards: pre-commit (via
# run_commit_guards.sh, all five) and pre-merge-commit (two of them - see
# that hook for why it is not the whole chain). Both must run EVERY guard
# in their chain and report every violation in one refusal. That shape is
# easy to get wrong in exactly one way - `set -e`, which aborts at the
# first refusal and hides the rest (BL-1242/BL-1252, Article 4.4's shape
# applied in a gate) - so it lives here once and both callers share it
# rather than each re-deriving it.
#
# Sourced, never executed. A caller sets:
#   GUARD_DIR             where the guard scripts are found
#   GUARD_CHAIN_LABEL     the hook name to print in a refusal
# and must itself run under `set -uo pipefail` with NO `-e`.
#
# Nothing here alters what any guard DECIDES; this file owns only the
# completeness of the report.

guard_chain_status=0
guard_chain_refused=""
guard_chain_unexpected=""

# Runs one guard, never aborting the chain. A guard's OWN refusal is exit 1;
# anything else non-zero (a crash, a missing script's 127, a bad argument) is
# an unexpected failure - which still refuses. Aggregating exit codes must
# never convert an error into a pass.
run_guard() {
  local script="$1"
  shift
  local st=0
  "$GUARD_DIR/$script" "$@" || st=$?
  if [ "$st" -ne 0 ]; then
    guard_chain_status="$st"
    guard_chain_refused="${guard_chain_refused}${guard_chain_refused:+ }${script}"
    if [ "$st" -ne 1 ]; then
      guard_chain_unexpected="${guard_chain_unexpected}${guard_chain_unexpected:+ }${script} (exit ${st})"
    fi
  fi
  return 0
}

guard_chain_has_refusal() {
  [ -n "$guard_chain_refused" ]
}

report_refusals() {
  echo "" >&2
  echo "${GUARD_CHAIN_LABEL}: COMMIT REFUSED. Guards reporting a violation: ${guard_chain_refused}" >&2
  if [ -n "$guard_chain_unexpected" ]; then
    echo "${GUARD_CHAIN_LABEL}: these guards did not refuse cleanly - they failed unexpectedly (a crash, a missing script, or any non-refusal exit): ${guard_chain_unexpected}" >&2
    echo "${GUARD_CHAIN_LABEL}: an unexpected failure still refuses the commit; it is never collected as a pass." >&2
  fi
  echo "${GUARD_CHAIN_LABEL}: every guard in this tier ran, so the list above is complete - there is no second violation waiting for your next attempt (Article 4.4)." >&2
}
