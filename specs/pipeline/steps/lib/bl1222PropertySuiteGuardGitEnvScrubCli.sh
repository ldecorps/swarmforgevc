#!/usr/bin/env bash
# BL-1222 acceptance driver: invokes the REAL check_property_suite_drift.sh
# (never a reimplementation) against a real git fixture simulating the
# pre-commit hook's inherited git environment (GIT_DIR/GIT_INDEX_FILE
# absolute, GIT_WORK_TREE unset - measured live, ticket description).
#
# Usage: bl1222PropertySuiteGuardGitEnvScrubCli.sh <mode>
#   env-scrubbed            - scenario 01: the launched suite's own env
#   nested-shell-isolated    - scenario 03: a nested shell fixture's git
#                              init/commit does not leak into the invoking
#                              "worktree"
#   short-circuit-override   - scenario 04 row 1
#   short-circuit-no-trigger - scenario 04 row 2
#   short-circuit-toolchain-missing - scenario 04 row 3
# Prints one JSON line.

set -uo pipefail

MODE="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
GUARD="$SCRIPT_DIR/swarmforge/scripts/check_property_suite_drift.sh"

ROOT="$(mktemp -d)"
cleanup() { rm -rf "$ROOT"; }
trap cleanup EXIT

# A REAL git repo standing in for the linked worktree the pre-commit hook
# would invoke the guard from - not just a fabricated path, so an
# un-scrubbed run would actually be able to write into it.
git -C "$ROOT" init -q -b main
git -C "$ROOT" config user.email "t@t"
git -C "$ROOT" config user.name "t"
git -C "$ROOT" config commit.gpgsign false
git -C "$ROOT" commit -q --allow-empty -m seed

stage_trigger_path() {
  mkdir -p "$ROOT/extension/src"
  echo v1 > "$ROOT/extension/src/x.ts"
  git -C "$ROOT" add extension/src/x.ts
}

run_guard() {
  # "$@" - the injected suite command, or nothing for the default.
  (
    cd "$ROOT"
    GIT_DIR="$ROOT/.git" GIT_INDEX_FILE="$ROOT/.git/index" \
      bash "$GUARD" "$@"
  )
}

case "$MODE" in
  env-scrubbed)
    stage_trigger_path
    ENV_OUT="$ROOT/../env_out_$$"
    rm -f "$ENV_OUT"
    STDERR_OUT="$(run_guard bash -c 'env | grep -E "^GIT_(DIR|WORK_TREE|INDEX_FILE)=" > "'"$ENV_OUT"'" || true; exit 0' 2>&1)"
    EXIT_CODE=$?
    LAUNCHED=false
    [[ -f "$ENV_OUT" ]] && LAUNCHED=true
    LEAK="$(cat "$ENV_OUT" 2>/dev/null || true)"
    rm -f "$ENV_OUT"
    LEAK_ESCAPED="$(bb -e '(println (cheshire.core/generate-string (slurp *in*)))' <<<"$LEAK")"
    printf '{"exitCode":%s,"launched":%s,"envLeak":%s}\n' "$EXIT_CODE" "$LAUNCHED" "$LEAK_ESCAPED"
    ;;

  nested-shell-isolated)
    stage_trigger_path
    HEAD_BEFORE="$(git -C "$ROOT" rev-parse HEAD)"
    NESTED_MARKER="$ROOT/../nested_out_$$"
    rm -f "$NESTED_MARKER"
    run_guard bash -c '
      NESTED_DIR="$(mktemp -d)"
      git -C "$NESTED_DIR" init -q -b main
      git -C "$NESTED_DIR" -c user.email=t@t -c user.name=t commit -q --allow-empty -m nested-fixture-commit
      git -C "$NESTED_DIR" rev-parse HEAD > "'"$NESTED_MARKER"'"
      rm -rf "$NESTED_DIR"
    ' >/dev/null 2>&1
    EXIT_CODE=$?
    LAUNCHED=false
    [[ -f "$NESTED_MARKER" ]] && LAUNCHED=true
    rm -f "$NESTED_MARKER"
    HEAD_AFTER="$(git -C "$ROOT" rev-parse HEAD)"
    BRANCH_UNCHANGED=false
    [[ "$HEAD_AFTER" == "$HEAD_BEFORE" ]] && BRANCH_UNCHANGED=true
    printf '{"exitCode":%s,"launched":%s,"branchUnchanged":%s}\n' "$EXIT_CODE" "$LAUNCHED" "$BRANCH_UNCHANGED"
    ;;

  short-circuit-override)
    stage_trigger_path
    MARKER="$ROOT/../marker_$$"
    rm -f "$MARKER"
    run_guard_env() {
      (
        cd "$ROOT"
        GIT_DIR="$ROOT/.git" GIT_INDEX_FILE="$ROOT/.git/index" \
          SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1 \
          bash "$GUARD" bash -c 'touch "'"$MARKER"'"'
      )
    }
    run_guard_env >/dev/null 2>&1
    EXIT_CODE=$?
    LAUNCHED=false
    [[ -f "$MARKER" ]] && LAUNCHED=true
    rm -f "$MARKER"
    printf '{"exitCode":%s,"launched":%s}\n' "$EXIT_CODE" "$LAUNCHED"
    ;;

  short-circuit-no-trigger)
    # No trigger path staged at all.
    MARKER="$ROOT/../marker_$$"
    rm -f "$MARKER"
    run_guard bash -c 'touch "'"$MARKER"'"' >/dev/null 2>&1
    EXIT_CODE=$?
    LAUNCHED=false
    [[ -f "$MARKER" ]] && LAUNCHED=true
    rm -f "$MARKER"
    printf '{"exitCode":%s,"launched":%s}\n' "$EXIT_CODE" "$LAUNCHED"
    ;;

  short-circuit-toolchain-missing)
    stage_trigger_path
    # No injected suite command AND no extension/node_modules in this
    # fixture - default_toolchain_ready() returns false, so the guard
    # never attempts to launch anything.
    run_guard >/dev/null 2>&1
    EXIT_CODE=$?
    printf '{"exitCode":%s,"launched":false}\n' "$EXIT_CODE"
    ;;

  *)
    echo "unknown mode: $MODE" >&2
    exit 2
    ;;
esac
