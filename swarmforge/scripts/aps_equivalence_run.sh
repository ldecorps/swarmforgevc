#!/usr/bin/env bash
# aps_equivalence_run.sh (BL-959) - the thin boundary of the APS
# candidate-toolchain equivalence run: fetch the candidate at EXACTLY the
# ticket's SHA into a throwaway dir (install_aps_tools.sh's
# clone-at-SHA-and-verify pattern - refuses to proceed on a rev-parse
# mismatch), run BOTH real toolchains over the corpus via
# aps_equivalence_runner.bb, and produce the verdict matrix via
# aps_equivalence_cli.bb. All logic lives in the bb modules; this script
# only sequences them.
#
# Read-only toward every pinned surface (declared invariant 1):
# swarmforge/vendor/aps/ is READ as the pinned toolchain,
# swarmforge.lock.json is READ for the repo URL, upstream-watch.json is not
# touched at all. The candidate is never copied into vendor/. The pin bump
# itself remains a separate human commit after reading the evidence.
#
# Usage: aps_equivalence_run.sh [repo-root] [work-dir] [corpus-limit]
#   work-dir defaults to a fresh temp dir (printed); it holds the result
#   sets, matrix.txt and matrix.md, and is LEFT IN PLACE for inspection.
#   corpus-limit is a smoke-run seam - omit it for the real evidence run.
#   APS_EQUIVALENCE_CANDIDATE_DIR: reuse an existing candidate checkout
#   (still SHA-verified) instead of cloning - offline re-runs, qa_e2e.
#
# Exit code is the comparator's: 0 only for a non-empty all-EQUIVALENT
# matrix (fail closed).

set -euo pipefail

CANDIDATE_SHA="1001283af353d3c5072fc5f07f2b9f5dbf7336e8"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="${1:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
ROOT="$(cd "$ROOT" && pwd)"
WORK_DIR="${2:-$(mktemp -d -t aps-equivalence)}"
mkdir -p "$WORK_DIR"
WORK_DIR="$(cd "$WORK_DIR" && pwd)"
CORPUS_LIMIT="${3:-}"

LOCK_FILE="$ROOT/swarmforge.lock.json"
VENDOR_DIR="$ROOT/swarmforge/vendor/aps"
[[ -f "$LOCK_FILE" ]] || { echo "Error: $LOCK_FILE not found" >&2; exit 2; }
[[ -d "$VENDOR_DIR/bb/src" ]] || { echo "Error: pinned APS tools not vendored - run install_aps_tools.sh first" >&2; exit 2; }

if [[ -n "${APS_EQUIVALENCE_CANDIDATE_DIR:-}" ]]; then
  CANDIDATE_DIR="$APS_EQUIVALENCE_CANDIDATE_DIR"
else
  REPO_URL="$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['aps']['repo'])" "$LOCK_FILE")"
  CANDIDATE_DIR="$(mktemp -d -t aps-equivalence-candidate)"
  trap 'rm -rf "$CANDIDATE_DIR"' EXIT
  git clone --quiet "$REPO_URL" "$CANDIDATE_DIR"
  git -C "$CANDIDATE_DIR" checkout --quiet "$CANDIDATE_SHA"
fi

ACTUAL_SHA="$(git -C "$CANDIDATE_DIR" rev-parse HEAD)"
if [[ "$ACTUAL_SHA" != "$CANDIDATE_SHA" ]]; then
  echo "Error: candidate checkout is $ACTUAL_SHA, not the ticket's $CANDIDATE_SHA - refusing to run" >&2
  exit 2
fi

echo "work dir: $WORK_DIR"
bb "$SCRIPT_DIR/aps_equivalence_runner.bb" pinned "$VENDOR_DIR" "$ROOT" "$WORK_DIR" ${CORPUS_LIMIT:+"$CORPUS_LIMIT"}
bb "$SCRIPT_DIR/aps_equivalence_runner.bb" candidate "$CANDIDATE_DIR" "$ROOT" "$WORK_DIR" ${CORPUS_LIMIT:+"$CORPUS_LIMIT"}

set +e
bb "$SCRIPT_DIR/aps_equivalence_cli.bb" compare "$WORK_DIR"
COMPARE_EXIT=$?
set -e

echo "matrix: $WORK_DIR/matrix.txt (markdown: $WORK_DIR/matrix.md)"
exit "$COMPARE_EXIT"
