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
#
# BL-638: the vendored CLI reports `Total 0` both when a feature has no
# Scenario Outline (nothing was ever discovered) and, on a soft re-run, when
# every mutation was reused from a valid stamp - both exit 0 with no
# survivors/errors, indistinguishable from a real clean sweep. finalize_
# gherkin_mutation.js classifies the captured report after the vendored tool
# returns and corrects the feature file when nothing was ever discovered, so
# this can no longer `exec` (the process must survive to post-process).
# Exit codes: 0 = real pass, 1 = fail (survivors/errors), 2 = inapplicable
# (nothing to mutate - never a silent pass).

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
WORK_DIR="$(cd "$WORK_DIR" && pwd)"

cd "$VENDOR_DIR"
set +e
RAW_OUTPUT="$(bb gherkin-mutator \
  --feature "$FEATURE_FILE" \
  --work-dir "$WORK_DIR" \
  --runner-worker "node $PIPELINE_DIR/mutationWorker.js $STEPS_MODULE" \
  --level "$LEVEL" \
  --status-interval 1s \
  --json)"
BB_EXIT=$?
set -e

printf '%s' "$RAW_OUTPUT" | node "$SCRIPT_DIR/finalize_gherkin_mutation.js" "$FEATURE_FILE" "$BB_EXIT"
