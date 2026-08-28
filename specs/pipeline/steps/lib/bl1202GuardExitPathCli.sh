#!/usr/bin/env bash
# BL-1202 acceptance driver: runs the REAL check_property_suite_drift.sh
# against a real fixture git repo with a fake suite command that mutates
# the shared checkout (a new commit on HEAD) and then ends one of three
# ways - passing, failing, or being killed mid-run (a SIGTERM from this
# driver while the fake suite is deliberately sleeping). Mirrors
# swarmforge/scripts/test/test_property_suite_drift_guard.sh's own
# scenarios 14/15 exactly, driven once per ending so the acceptance
# feature's Outline can call this once per row.
#
# Usage: bl1202GuardExitPathCli.sh <repo-root> <ending: passing|failing|killed>
# Prints one JSON line: {"exitCode":N,"canaryReported":bool,"childAlive":bool}

set -euo pipefail

ROOT="$1"
ENDING="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
GUARD="$SCRIPT_DIR/swarmforge/scripts/check_property_suite_drift.sh"

MARKER="$(mktemp)"
CHILD_MARKER="$(mktemp)"
OUT_FILE="$(mktemp)"
rm -f "$MARKER" "$CHILD_MARKER"

case "$ENDING" in
  passing)
    SUITE=(bash -c 'git -C "'"$ROOT"'" -c user.email=t@t -c user.name=t commit -q --allow-empty -m mutated; exit 0')
    ;;
  failing)
    SUITE=(bash -c 'git -C "'"$ROOT"'" -c user.email=t@t -c user.name=t commit -q --allow-empty -m mutated; echo "FAIL some.property.test.js" >&2; exit 1')
    ;;
  killed)
    SUITE=(bash -c '
      git -C "'"$ROOT"'" -c user.email=t@t -c user.name=t commit -q --allow-empty -m mutated
      echo $$ > "'"$MARKER"'"
      (sleep 30) &
      echo $! > "'"$CHILD_MARKER"'"
      sleep 30
    ')
    ;;
  *)
    echo "usage: bl1202GuardExitPathCli.sh <repo-root> <passing|failing|killed>" >&2
    exit 2
    ;;
esac

mkdir -p "$ROOT/extension/src"
echo "v$RANDOM" > "$ROOT/extension/src/bl1202Fixture.ts"
git -C "$ROOT" add extension/src/bl1202Fixture.ts

HEAD_BEFORE="$(git -C "$ROOT" rev-parse HEAD)"

if [[ "$ENDING" == "killed" ]]; then
  (
    cd "$ROOT"
    exec bash "$GUARD" "${SUITE[@]}" >"$OUT_FILE" 2>&1
  ) &
  GUARD_PID=$!

  DEADLINE=$((SECONDS + 10))
  while [[ ! -s "$MARKER" ]] && (( SECONDS < DEADLINE )); do
    sleep 0.05
  done

  kill -TERM "$GUARD_PID" 2>/dev/null || true
  set +e
  wait "$GUARD_PID"
  EXIT_CODE=$?
  set -e

  CHILD_ALIVE=false
  if [[ -s "$MARKER" ]]; then
    CHILD_PID="$(cat "$MARKER")"
    DEADLINE=$((SECONDS + 5))
    while kill -0 "$CHILD_PID" 2>/dev/null && (( SECONDS < DEADLINE )); do
      sleep 0.05
    done
    kill -0 "$CHILD_PID" 2>/dev/null && CHILD_ALIVE=true
    if [[ -s "$CHILD_MARKER" ]]; then
      GRANDCHILD_PID="$(cat "$CHILD_MARKER")"
      kill -0 "$GRANDCHILD_PID" 2>/dev/null && CHILD_ALIVE=true
    fi
  fi
else
  set +e
  (cd "$ROOT" && bash "$GUARD" "${SUITE[@]}") >"$OUT_FILE" 2>&1
  EXIT_CODE=$?
  set -e
  CHILD_ALIVE=false
fi

OUT="$(cat "$OUT_FILE" 2>/dev/null || true)"
CANARY_REPORTED=false
echo "$OUT" | grep -q 'BL-1124: shared repo refs/bare changed' && CANARY_REPORTED=true

# Undo the fake suite's mutation for the next Outline row / scenario.
git -C "$ROOT" reset -q --hard "$HEAD_BEFORE" >/dev/null 2>&1 || true

rm -f "$MARKER" "$CHILD_MARKER" "$OUT_FILE"

printf '{"exitCode":%s,"canaryReported":%s,"childAlive":%s}\n' "$EXIT_CODE" "$CANARY_REPORTED" "$CHILD_ALIVE"
