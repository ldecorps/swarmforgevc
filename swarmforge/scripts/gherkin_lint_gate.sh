#!/usr/bin/env bash
# BL-111 lint-gate-03/04: the specifier must have a clean parse of a
# parcel's feature file(s) before handoff to coder. Wraps the vendored
# gherkin-parser (swarmforge/vendor/aps/, installed by
# install_aps_tools.sh) so the gate is a runnable script, not aspirational.
#
# BL-515: a clean parse from the vendored parser is not proof the feature
# file is well-formed - it silently drops a step's wrapped second line (and
# any <param> on it) while still exiting 0. On top of the parser's own
# parse check, this gate also runs gherkin_lint_gate_cli.bb (backed by the
# pure gherkin_lint_gate_lib.bb) to reject that silent drop and an Examples
# column no step references. BL-520 drained the temporary legacy wrap
# exemptions, so single-line step enforcement is unconditional.
#
# Usage: gherkin_lint_gate.sh <feature-file> [repo-root]
#
# Exits 0 with an OK line on a clean, well-formed parse; exits nonzero with
# a FAIL line naming the parse error (a malformed file) or the offending
# line/column (a wrapped step or a phantom Examples column).

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

if [[ "$STATUS" -ne 0 ]]; then
  echo "FAIL: $FEATURE_FILE did not parse: $PARSE_OUTPUT" >&2
  exit "$STATUS"
fi

set +e
LINT_OUTPUT="$(bb "$SCRIPT_DIR/gherkin_lint_gate_cli.bb" "$ABS_FEATURE_FILE" "$TMP_IR" "$ROOT" 2>&1)"
LINT_STATUS=$?
set -e

if [[ "$LINT_STATUS" -ne 0 ]]; then
  echo "$LINT_OUTPUT" >&2
  exit "$LINT_STATUS"
fi

echo "OK: $FEATURE_FILE parses cleanly"
exit 0
