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
#         or toolchain unavailable.
# Exit 1: genuine property regression (suite red) OR BL-1124 shared-repo
#         canary failure (core.bare flipped / live refs rewritten).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=property_suite_shared_repo_guard.sh
source "$SCRIPT_DIR/property_suite_shared_repo_guard.sh"

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

# Incoming merge parent — same contract as check_pipeline_code_on_main.sh
# (MERGE_HEAD, else a lone GITHEAD_<sha> env). Empty when not mid-merge.
resolve_incoming_merge_parent() {
  local merge_head_sha githead_count githead_candidate env_name
  merge_head_sha="$(git rev-parse -q --verify MERGE_HEAD 2>/dev/null || true)"
  if [[ -n "$merge_head_sha" ]]; then
    printf '%s\n' "$merge_head_sha"
    return 0
  fi
  githead_count=0
  githead_candidate=""
  while IFS='=' read -r env_name _; do
    case "$env_name" in
      GITHEAD_????????????????????????????????????????)
        githead_candidate="${env_name#GITHEAD_}"
        githead_count=$((githead_count + 1))
        ;;
    esac
  done < <(env)
  if [[ "$githead_count" -eq 1 ]]; then
    printf '%s\n' "$githead_candidate"
    return 0
  fi
  return 1
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

# BL-1124: canary the live checkout before fixtures run.
BEFORE="$(bl1124_snapshot "$REPO_ROOT")"

set +e
if (( $# > 0 )); then
  OUT="$("$@" 2>&1)"
  STATUS=$?
else
  if ! default_toolchain_ready; then
    warn_skipped
    exit 0
  fi
  OUT="$(run_default_suite 2>&1)"
  STATUS=$?
fi
set -e

if (( STATUS == 127 )); then
  warn_skipped
  [[ -n "$OUT" ]] && echo "$OUT" >&2
  exit 0
fi

# Always assert canary after a real suite run (green or red).
set +e
bl1124_assert_unchanged "$REPO_ROOT" "$BEFORE"
CANARY=$?
set -e
if (( CANARY != 0 )); then
  [[ -n "$OUT" ]] && echo "$OUT" >&2
  echo "Commit rejected: property suite mutated the shared checkout (BL-1124)." >&2
  exit 1
fi

if (( STATUS != 0 )); then
  echo "$OUT" >&2
  echo "Commit rejected: property suite failed. Fix the red property or set SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1 to override." >&2
  exit 1
fi

[[ -n "$OUT" ]] && echo "$OUT" >&2
exit 0
