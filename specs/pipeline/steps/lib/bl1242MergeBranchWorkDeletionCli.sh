#!/usr/bin/env bash
# BL-1242 acceptance driver: invokes the REAL check_merge_deletion.sh (and,
# for the no-double-report scenario, check_ticket_deletion.sh too) against
# a real git fixture reproducing the 2026-08-28 incident shape - both
# files introduced on shared history, then reverted on one branch while
# the other keeps them, so the merge resolves as "theirs deleted, ours
# unchanged".
#
# Usage: bl1242MergeBranchWorkDeletionCli.sh <mode> [param]
#   matrix <none|every>   - scenario 01: message names none/every ticket
#   refusal-detail        - scenario 02: refusal content detail
#   no-removal            - scenario 03: nothing removed, always allowed
#   double-report <ticket-yaml|product> - scenario 04
# Prints one JSON line.

set -uo pipefail

MODE="$1"
PARAM="${2:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
MERGE_GUARD="$SCRIPT_DIR/swarmforge/scripts/check_merge_deletion.sh"
TICKET_GUARD="$SCRIPT_DIR/swarmforge/scripts/check_ticket_deletion.sh"

ROOT="$(mktemp -d)"
cleanup() { rm -rf "$ROOT"; }
trap cleanup EXIT

git -C "$ROOT" init -q -b main
git -C "$ROOT" config user.email "test@test"
git -C "$ROOT" config user.name "test"
git -C "$ROOT" config commit.gpgsign false
git -C "$ROOT" commit -q --allow-empty -m seed

# Two files under two tickets, introduced on shared history.
mkdir -p "$ROOT/specs/pipeline/steps" "$ROOT/swarmforge/scripts"
echo "step handler" > "$ROOT/specs/pipeline/steps/bl0001ExampleSteps.js"
git -C "$ROOT" add specs/pipeline/steps/bl0001ExampleSteps.js
git -C "$ROOT" commit -q -m "BL-0001: add step handler"
echo "lib" > "$ROOT/swarmforge/scripts/bl0002_example_lib.bb"
git -C "$ROOT" add swarmforge/scripts/bl0002_example_lib.bb
git -C "$ROOT" commit -q -m "BL-0002: add lib"

git -C "$ROOT" checkout -q -b feature
echo "feature progress" > "$ROOT/feature-note.txt"
git -C "$ROOT" add feature-note.txt
git -C "$ROOT" commit -q -m "feature: unrelated progress"
FEATURE_TIP="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

git -C "$ROOT" checkout -q main
git -C "$ROOT" rm -q specs/pipeline/steps/bl0001ExampleSteps.js swarmforge/scripts/bl0002_example_lib.bb
git -C "$ROOT" commit -q -m "revert BL-0001/BL-0002 bounce"
MAIN_TIP="$(git -C "$ROOT" rev-parse --short=10 HEAD)"

start_merge() {
  git -C "$ROOT" checkout -q feature
  git -C "$ROOT" reset -q --hard "$FEATURE_TIP"
  git -C "$ROOT" merge --no-ff --no-commit "$MAIN_TIP" >/dev/null 2>&1 || true
}

run_merge_guard() {
  local msg_file="$1"
  (cd "$ROOT" && bash "$MERGE_GUARD" "$msg_file")
}

case "$MODE" in
  matrix)
    start_merge
    MSG="$ROOT/../msg_$$.txt"
    if [[ "$PARAM" == "none" ]]; then
      echo "merge main" > "$MSG"
    else
      echo "BL-0001 and BL-0002: revert propagation, named" > "$MSG"
    fi
    OUT="$(run_merge_guard "$MSG" 2>&1)"
    EXIT_CODE=$?
    rm -f "$MSG"
    STDERR_ESCAPED="$(bb -e '(println (cheshire.core/generate-string (slurp *in*)))' <<<"$OUT")"
    printf '{"exitCode":%s,"stderr":%s}\n' "$EXIT_CODE" "$STDERR_ESCAPED"
    ;;

  refusal-detail)
    start_merge
    MSG="$ROOT/../msg_$$.txt"
    echo "merge main" > "$MSG"
    OUT="$(run_merge_guard "$MSG" 2>&1)"
    EXIT_CODE=$?
    rm -f "$MSG"
    STDERR_ESCAPED="$(bb -e '(println (cheshire.core/generate-string (slurp *in*)))' <<<"$OUT")"
    printf '{"exitCode":%s,"stderr":%s,"featureTip":"%s"}\n' "$EXIT_CODE" "$STDERR_ESCAPED" "$FEATURE_TIP"
    ;;

  no-removal)
    git -C "$ROOT" checkout -q -b feature2 "$FEATURE_TIP"
    echo "more work" > "$ROOT/specs/pipeline/steps/bl0003ExampleSteps.js"
    git -C "$ROOT" add specs/pipeline/steps/bl0003ExampleSteps.js
    git -C "$ROOT" commit -q -m "BL-0003: more work"
    git -C "$ROOT" checkout -q feature
    git -C "$ROOT" reset -q --hard "$FEATURE_TIP"
    git -C "$ROOT" merge --no-ff --no-commit feature2 >/dev/null 2>&1 || true
    MSG="$ROOT/../msg_$$.txt"
    echo "totally unrelated message" > "$MSG"
    OUT="$(run_merge_guard "$MSG" 2>&1)"
    EXIT_CODE=$?
    rm -f "$MSG"
    printf '{"exitCode":%s}\n' "$EXIT_CODE"
    ;;

  double-report)
    if [[ "$PARAM" == "ticket-yaml" ]]; then
      mkdir -p "$ROOT/backlog/paused"
      echo "id: BL-0001" > "$ROOT/backlog/paused/BL-0001-example.yaml"
      git -C "$ROOT" checkout -q feature
      git -C "$ROOT" add backlog/paused/BL-0001-example.yaml
      git -C "$ROOT" commit -q -m "BL-0001: seed ticket yaml"
      FTIP="$(git -C "$ROOT" rev-parse --short=10 HEAD)"
      git -C "$ROOT" reset -q --hard "$FTIP"
      git -C "$ROOT" merge --no-ff --no-commit "$MAIN_TIP" >/dev/null 2>&1 || true
      git -C "$ROOT" rm -q backlog/paused/BL-0001-example.yaml >/dev/null 2>&1 || true
      MSG="$ROOT/../msg_$$.txt"
      echo "unrelated" > "$MSG"
      MERGE_OUT="$(run_merge_guard "$MSG" 2>&1)"; MERGE_EXIT=$?
      TICKET_OUT="$(cd "$ROOT" && bash "$TICKET_GUARD" "$MSG" 2>&1)"; TICKET_EXIT=$?
      rm -f "$MSG"
      MERGE_FLAGGED=false; [[ "$MERGE_EXIT" -ne 0 && "$MERGE_OUT" == *"BL-0001-example.yaml"* ]] && MERGE_FLAGGED=true
      TICKET_FLAGGED=false; [[ "$TICKET_EXIT" -ne 0 && "$TICKET_OUT" == *"BL-0001-example.yaml"* ]] && TICKET_FLAGGED=true
      printf '{"mergeGuardFlagged":%s,"ticketGuardFlagged":%s}\n' "$MERGE_FLAGGED" "$TICKET_FLAGGED"
    else
      start_merge
      MSG="$ROOT/../msg_$$.txt"
      echo "unrelated" > "$MSG"
      MERGE_OUT="$(run_merge_guard "$MSG" 2>&1)"; MERGE_EXIT=$?
      TICKET_OUT="$(cd "$ROOT" && bash "$TICKET_GUARD" "$MSG" 2>&1)"; TICKET_EXIT=$?
      rm -f "$MSG"
      MERGE_FLAGGED=false; [[ "$MERGE_EXIT" -ne 0 && "$MERGE_OUT" == *"bl0001ExampleSteps.js"* ]] && MERGE_FLAGGED=true
      TICKET_FLAGGED=false; [[ "$TICKET_EXIT" -ne 0 && "$TICKET_OUT" == *"bl0001ExampleSteps.js"* ]] && TICKET_FLAGGED=true
      printf '{"mergeGuardFlagged":%s,"ticketGuardFlagged":%s}\n' "$MERGE_FLAGGED" "$TICKET_FLAGGED"
    fi
    ;;

  *)
    echo "unknown mode: $MODE" >&2
    exit 2
    ;;
esac
