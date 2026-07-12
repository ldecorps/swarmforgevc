#!/usr/bin/env bash
# BL-314: coordinator_config_cli.bb - the shell-callable entry point
# swarmforge.sh's provision_coordinator uses to resolve the effective
# coordinator model/effort without re-implementing the parse in bash.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../coordinator_config_cli.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

printf 'config coordinator_model claude-opus-4-8\nconfig coordinator_effort xhigh\n' > "$ROOT/opus.conf"
printf 'window coder claude coder --model x\n' > "$ROOT/no-coordinator-config.conf"

OUT="$(bb "$CLI" "$ROOT/opus.conf")"
[[ "$OUT" == $'claude-opus-4-8\txhigh' ]] || fail "expected the declared model/effort, got: $OUT"
pass "coordinator_config_cli.bb prints a declared model/effort"

OUT="$(bb "$CLI" "$ROOT/no-coordinator-config.conf")"
[[ "$OUT" == $'claude-sonnet-5\thigh' ]] || fail "expected the Sonnet/high default with no coordinator_model/effort lines, got: $OUT"
pass "coordinator_config_cli.bb falls back to claude-sonnet-5/high when the conf declares neither"

OUT="$(bb "$CLI" "$ROOT/does-not-exist.conf")"
[[ "$OUT" == $'claude-sonnet-5\thigh' ]] || fail "expected the default for a missing conf file, got: $OUT"
pass "coordinator_config_cli.bb falls back to the default for a missing conf file"

echo "ALL PASS"
