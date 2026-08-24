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
#   SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1 — warn and exit 0 (recovery).
#
# Exit 0: path skip, override, green suite, or toolchain unavailable.
# Exit 1: genuine property regression (suite red).

set -euo pipefail

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

staged_needs_check() {
  local file
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    if path_triggers_check "$file"; then
      return 0
    fi
  done < <(git diff --cached --name-only)
  return 1
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

echo "property-suite-guard: run" >&2

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

if (( STATUS != 0 )); then
  echo "$OUT" >&2
  echo "Commit rejected: property suite failed. Fix the red property or set SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1 to override." >&2
  exit 1
fi

[[ -n "$OUT" ]] && echo "$OUT" >&2
exit 0
