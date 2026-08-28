#!/usr/bin/env bash
# BL-570: when staged changes can invalidate a property, run the property
# suite before the commit lands. Shared via swarmforge/git-hooks/pre-commit
# (core.hooksPath), same standalone-script pattern as check_commit_size.sh.
#
# Usage: check_property_suite_drift.sh [suite-command [args...]]
#   No args — run `npm run test:properties` from extension/ when the
#   toolchain is present. With args — those are the suite command
#   (injectable for tests; no *_FORCE_RESULT env bypasses).
#
# Env:
#   SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1 — warn and exit 0 (recovery-only;
#   never the standing recipe — see BL-1121).
#
# Exit 0: path skip, reconcile-import skip (BL-1121), override, green suite,
#         allowlisted standing reds only (BL-1175), or toolchain unavailable.
# Exit 1: genuine property regression (suite red with a non-allowlisted file)
#         OR BL-1124 shared-repo canary failure (core.bare flipped / live refs
#         rewritten).
#
# BL-1175 property suite gate: green or allowlisted standing reds; unrelated
# green commits not refused (property_suite_standing_allowlist.tsv).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=property_suite_shared_repo_guard.sh
source "$SCRIPT_DIR/property_suite_shared_repo_guard.sh"
# shellcheck source=incoming_merge_parent_lib.sh
source "$SCRIPT_DIR/incoming_merge_parent_lib.sh"

ALLOWLIST_TSV=""
if [[ -f "$SCRIPT_DIR/property_suite_standing_allowlist_lib.sh" ]]; then
  # shellcheck source=property_suite_standing_allowlist_lib.sh
  source "$SCRIPT_DIR/property_suite_standing_allowlist_lib.sh"
  ALLOWLIST_TSV="$(ps_allowlist_tsv_path "$SCRIPT_DIR")"
fi

warn_override() {
  echo "property-suite-guard: overridden" >&2
  echo "Warning: property check was overridden (SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1)." >&2
}

warn_skipped() {
  echo "property-suite-guard: skipped (toolchain unavailable)" >&2
  echo "Warning: property check was skipped (toolchain unavailable)." >&2
}

path_triggers_check() {
  case "$1" in
    extension/src/*|*.property.test.js) return 0 ;;
  esac
  return 1
}

collect_trigger_paths() {
  local file
  TRIGGER_PATHS=()
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    if path_triggers_check "$file"; then
      TRIGGER_PATHS+=("$file")
    fi
  done < <(git diff --cached --name-only)
}

staged_needs_check() {
  collect_trigger_paths
  (( ${#TRIGGER_PATHS[@]} > 0 ))
}

# True when every suite-triggering staged path is byte-identical to the
# incoming parent (pure import — BL-925/1096 lineage; BL-1121 standing recipe).
reconcile_import_byte_identical() {
  local parent="$1"
  local f
  for f in "${TRIGGER_PATHS[@]}"; do
    [[ -z "$(git diff --cached "$parent" -- "$f")" ]] || return 1
  done
  return 0
}

maybe_skip_reconcile_import() {
  local parent
  parent="$(resolve_incoming_merge_parent || true)"
  [[ -n "$parent" ]] || return 1
  reconcile_import_byte_identical "$parent" || return 1
  echo "property-suite-guard: skip-reconcile-import (staged trigger paths byte-identical to incoming parent ${parent:0:10})" >&2
  return 0
}

default_toolchain_ready() {
  [[ -d extension/node_modules ]] && command -v npm >/dev/null 2>&1
}

run_default_suite() {
  (cd extension && npm run test:properties)
}

# BL-1202: the guard must report its BL-1124 canary verdict on EVERY exit
# path of the run it guards - green, red, AND a kill mid-run (the foreground
# `git commit` being killed by a client-side timeout, the incident this
# ticket exists for) - and must not leave the suite's own process group
# running once the guard itself is gone. BEFORE/SUITE_PID are set only once
# a real suite run actually starts (right before it starts); every
# short-circuit above this point never touches them, so the EXIT/INT/TERM
# traps below are a no-op for a path that never started a suite (a path
# with nothing to report must not start printing one).
BEFORE=""
SUITE_PID=""
CANARY_DONE=0
CANARY_RESULT=0

# Idempotent: the first caller (either the normal post-suite path below, or
# the trap on an abnormal exit) computes and reports the verdict; every
# later call (the OTHER of those two, whichever runs second) is a fast
# no-op returning the same verdict, so the message and the process-group
# kill each happen exactly once. Never blocks indefinitely on a dying
# child (constraint: the report path must not itself hang the hook) - the
# grace-then-force kill loop below is bounded.
report_canary_once() {
  if (( CANARY_DONE )); then
    return "$CANARY_RESULT"
  fi
  CANARY_DONE=1
  [[ -n "$BEFORE" ]] || return 0

  if [[ -n "$SUITE_PID" ]]; then
    kill -TERM -- "-$SUITE_PID" 2>/dev/null || true
    local waited
    for waited in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 -- "-$SUITE_PID" 2>/dev/null || break
      sleep 0.05
    done
    kill -KILL -- "-$SUITE_PID" 2>/dev/null || true
  fi

  set +e
  bl1124_assert_unchanged "$REPO_ROOT" "$BEFORE"
  CANARY_RESULT=$?
  set -e
  if (( CANARY_RESULT != 0 )); then
    echo "Commit rejected: property suite mutated the shared checkout (BL-1124)." >&2
  fi
  return "$CANARY_RESULT"
}

# A caught INT/TERM (the guard itself being killed mid-run) must still
# report the canary and take the suite process group down with it - then
# exit non-zero, same as any other abnormal end to a started run. The
# explicit exit here also fires the EXIT trap below, which is a no-op by
# then (report_canary_once's own idempotency guard).
on_interrupt() {
  report_canary_once || true
  exit 1
}
trap on_interrupt INT TERM
trap 'report_canary_once || true' EXIT

if [[ "${SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD:-}" == "1" ]]; then
  warn_override
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if ! staged_needs_check; then
  echo "property-suite-guard: skip-paths" >&2
  exit 0
fi

# BL-1121: standing recipe for already-QA'd reconcile imports — not the env override.
if maybe_skip_reconcile_import; then
  exit 0
fi

echo "property-suite-guard: run" >&2

if ! default_toolchain_ready && (( $# == 0 )); then
  warn_skipped
  exit 0
fi

# BL-1124: canary the live checkout before fixtures run.
BEFORE="$(bl1124_snapshot "$REPO_ROOT")"

# BL-1202: run the suite as the leader of its OWN process group (job
# control enabled just for the background launch, both on Linux and macOS
# bash), redirected to a temp file rather than a command substitution, so
# report_canary_once (from either the normal path below or a kill trap)
# can address that whole group by pgid and `wait` can be interrupted by a
# caught signal without losing the suite's own exit status.
# BL-1196 (amended 2026-08-28): git exports GIT_DIR/GIT_INDEX_FILE (absolute,
# GIT_WORK_TREE unset) into every hook it runs for a commit made from a
# linked worktree, and this script's own environment inherits them straight
# from the pre-commit hook that invoked it. A fixture inside the suite doing
# mkdtemp + `git init` + `git commit` would silently obey an inherited
# redirect over its own cwd - this is the vector a vitest setupFile can never
# reach, since it covers code inside vitest, not the shell fixtures the
# suite shells out to. Stripped here, once, right before the suite (or the
# test-injected command) launches, so every subprocess it starts inherits a
# clean environment regardless of what the invoking hook exported.
unset -v GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

SUITE_OUT_FILE="$(mktemp)"
set -m
if (( $# > 0 )); then
  "$@" >"$SUITE_OUT_FILE" 2>&1 &
else
  run_default_suite >"$SUITE_OUT_FILE" 2>&1 &
fi
SUITE_PID=$!
set +m

set +e
wait "$SUITE_PID"
STATUS=$?
set -e
OUT="$(cat "$SUITE_OUT_FILE" 2>/dev/null || true)"
rm -f "$SUITE_OUT_FILE"

if (( STATUS == 127 )); then
  CANARY_DONE=1
  warn_skipped
  [[ -n "$OUT" ]] && echo "$OUT" >&2
  exit 0
fi

# Always assert canary after a real suite run (green or red).
set +e
report_canary_once
CANARY=$?
set -e
if (( CANARY != 0 )); then
  [[ -n "$OUT" ]] && echo "$OUT" >&2
  exit 1
fi

if (( STATUS != 0 )); then
  echo "$OUT" >&2
  set +e
  ALLOWLIST_OK=1
  UNLISTED=""
  if [[ -n "$ALLOWLIST_TSV" && -f "$ALLOWLIST_TSV" ]]; then
    UNLISTED="$(ps_suite_failures_all_allowlisted "$ALLOWLIST_TSV" "$OUT")"
    ALLOWLIST_OK=$?
  fi
  set -e
  if (( ALLOWLIST_OK == 0 )); then
    echo "property-suite-guard: allowlisted-standing-reds; unrelated green commits not refused (BL-1175)" >&2
    exit 0
  fi
  if [[ -n "$UNLISTED" ]]; then
    echo "Commit rejected: property suite failed with non-allowlisted files:" >&2
    echo "$UNLISTED" >&2
  else
    echo "Commit rejected: property suite failed. Fix the red property or set SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1 to override." >&2
  fi
  exit 1
fi

[[ -n "$OUT" ]] && echo "$OUT" >&2
exit 0
