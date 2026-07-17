#!/usr/bin/env bash
# BL-419: shared commit-integrity helper (commit_integrity_lib.bb). The
# race is timing-dependent, so per the project's no-real-timers testing
# rule this drives the deterministic halves only: injected seams for the
# verify/retry/fail-loud machinery, and a real git fixture for the
# pathspec-scoping guarantee. All assertions live in the TDD runner itself;
# this wrapper just invokes it and checks the summary line.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNNER="$SCRIPT_DIR/commit_integrity_lib_test_runner.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }

OUT="$(bb "$RUNNER" 2>&1)" || { echo "$OUT"; fail "commit_integrity_lib_test_runner.bb exited non-zero"; }
echo "$OUT"
echo "$OUT" | grep -q "ALL TESTS PASSED" || fail "expected all commit_integrity_lib assertions to pass"

echo "PASS: commit_integrity_lib (BL-419) - all assertions passed"
