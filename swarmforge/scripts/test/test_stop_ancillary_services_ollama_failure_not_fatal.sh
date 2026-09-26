#!/usr/bin/env bash
# BL-1704 architect bounce D1 (2026-09-25): stop_ancillary_services_main's
# new call to ollama_ancillary_stop_swarm_owned had no `|| true`, so a
# real, documented failure return (a swarm-owned server or runner child
# surviving TERM+KILL) aborted the whole function under this file's own
# run-directly `set -euo pipefail`, silently skipping the "done" log and
# anything after it - the exact failure mode
# ollama_ancillary_ensure_ready_for_launch's own BL-1727 comment already
# warns about, in this same file. Stubs ollama_ancillary_stop_swarm_owned
# to fail (never spawns a real stuck process - cheaper and deterministic)
# and asserts the function still reaches its own "done" log and exits 0.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STOP_ANCILLARY="$SCRIPT_DIR/../stop_ancillary_services.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
mkdir -p "$ROOT/.swarmforge/operator"
cleanup() { rm -rf "$ROOT"; }
trap cleanup EXIT

OUT="$(bash -c "
set -euo pipefail
source '$STOP_ANCILLARY'
ollama_ancillary_stop_swarm_owned() { echo 'STUB: ollama stop reporting failure' >&2; return 1; }
stop_ancillary_services_main '$ROOT'
" 2>&1)"
RC=$?

[[ "$RC" -eq 0 ]] || fail "expected stop_ancillary_services_main to exit 0 despite the ollama stop failing, got rc=$RC: $OUT"
pass "stop_ancillary_services_main exits 0 even when the ollama stop call fails"

echo "$OUT" | grep -q "stop_ancillary_services done" \
  || fail "expected the \"done\" log line to be reached, got: $OUT"
pass "the \"done\" log line is reached - the ollama stop failure did not abort the function"

echo "ALL PASS"
