#!/usr/bin/env bash
# BL-113: wraps the vendored, pinned gherkin-mutator (swarmforge/vendor/aps,
# same pin as BL-111's gherkin-parser, recorded in swarmforge.lock.json) -
# runs the full feature -> base IR -> mutator -> mutated IRs -> runs chain,
# using specs/pipeline/mutationWorker.js as the --runner-worker so mutated
# examples run through the EXACT same feature->entry-points->run path a
# normal acceptance run uses (generate.js/runnerAdapter.js), never a second
# implementation.
#
# Usage: run_gherkin_mutation.sh <feature-file> [work-dir] [steps-module-path] [level]
#   level: full | hard | soft (default soft, per hardender.prompt's
#          soft-Gherkin-mutation duty - skips re-testing scenarios whose
#          Gherkin text is unchanged, regardless of implementation changes)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIPELINE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENDOR_DIR="$(cd "$PIPELINE_DIR/../../swarmforge/vendor/aps" && pwd)"

FEATURE_FILE="${1:?Usage: run_gherkin_mutation.sh <feature-file> [work-dir] [steps-module-path] [level]}"
WORK_DIR="${2:-}"
STEPS_MODULE="${3:-$PIPELINE_DIR/steps/index.js}"
LEVEL="${4:-soft}"

FEATURE_FILE="$(cd "$(dirname "$FEATURE_FILE")" && pwd)/$(basename "$FEATURE_FILE")"
STEPS_MODULE="$(cd "$(dirname "$STEPS_MODULE")" && pwd)/$(basename "$STEPS_MODULE")"

if [[ -z "$WORK_DIR" ]]; then
  WORK_DIR="$(mktemp -d)"
fi
mkdir -p "$WORK_DIR"

cd "$VENDOR_DIR"
exec bb gherkin-mutator \
  --feature "$FEATURE_FILE" \
  --work-dir "$WORK_DIR" \
  --runner-worker "node $PIPELINE_DIR/mutationWorker.js $STEPS_MODULE" \
  --level "$LEVEL" \
  --status-interval 1s \
  --json
