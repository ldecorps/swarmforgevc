#!/usr/bin/env bash
# BL-112: convenience wrapper for the executable acceptance pipeline.
# feature file -> gherkin-parser -> JSON IR -> generated entry points -> run.
#
# Usage: run_acceptance.sh <feature-file> [outDir] [stepsModulePath]
#
# Generation and the acceptance run happen sequentially inside cli.js's
# single runPipeline() call. This script never runs the extension's
# whole-suite unit tests (npm test) - run it separately, never concurrently
# with this one (engineering.prompt's Verification rule).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PIPELINE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

FEATURE_FILE="${1:?Usage: run_acceptance.sh <feature-file> [outDir] [stepsModulePath]}"
OUT_DIR="${2:-$PIPELINE_DIR/generated}"
STEPS_MODULE="${3:-$PIPELINE_DIR/steps/index.js}"

exec node "$PIPELINE_DIR/cli.js" "$FEATURE_FILE" "$OUT_DIR" "$STEPS_MODULE"
