#!/usr/bin/env bash
# BL-111 lint-gate-03/04: the specifier must have a clean parse of a
# parcel's feature file(s) before handoff to coder. Wraps the vendored
# gherkin-parser (swarmforge/vendor/aps/, installed by
# install_aps_tools.sh) so the gate is a runnable script, not aspirational.
#
# Usage: gherkin_lint_gate.sh <feature-file> [repo-root]
#
# Exits 0 with an OK line on a clean parse; exits nonzero (gherkin-parser's
# own exit code) with a FAIL line naming the parse error on a malformed
# file.

set -euo pipefail

FEATURE_FILE="${1:?Usage: gherkin_lint_gate.sh <feature-file> [repo-root]}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${2:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
VENDOR_DIR="$ROOT/swarmforge/vendor/aps"

[[ -d "$VENDOR_DIR" ]] || { echo "Error: APS tools not vendored - run install_aps_tools.sh first" >&2; exit 1; }
[[ -f "$FEATURE_FILE" ]] || { echo "Error: feature file not found: $FEATURE_FILE" >&2; exit 1; }

# Resolve to an absolute path BEFORE cd-ing into the vendor dir (bb.edn's
# task definitions only resolve from that directory) - a relative path
# given by the caller would otherwise be looked up from the wrong cwd.
ABS_FEATURE_FILE="$(cd "$(dirname "$FEATURE_FILE")" && pwd)/$(basename "$FEATURE_FILE")"

TMP_IR="$(mktemp)"
trap 'rm -f "$TMP_IR"' EXIT

set +e
PARSE_OUTPUT="$(cd "$VENDOR_DIR" && bb gherkin-parser "$ABS_FEATURE_FILE" "$TMP_IR" 2>&1)"
STATUS=$?
set -e

if [[ "$STATUS" -eq 0 ]]; then
  echo "OK: $FEATURE_FILE parses cleanly"
  exit 0
else
  echo "FAIL: $FEATURE_FILE did not parse: $PARSE_OUTPUT" >&2
  exit "$STATUS"
fi
