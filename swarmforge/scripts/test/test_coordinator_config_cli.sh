#!/usr/bin/env bash
# BL-314/BL-319: coordinator_config_cli.bb - the shell-callable entry point
# swarmforge.sh's provision_coordinator uses to resolve the effective
# coordinator model/effort/agent without re-implementing the parse in bash.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../coordinator_config_cli.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

printf 'config coordinator_model claude-opus-4-8\nconfig coordinator_effort xhigh\nconfig coordinator_agent copilot\n' > "$ROOT/opus.conf"
printf 'window coder claude coder --model x\n' > "$ROOT/no-coordinator-config.conf"
printf 'config coordinator_mode deterministic\n' > "$ROOT/deterministic.conf"

OUT="$(bb "$CLI" "$ROOT/opus.conf")"
[[ "$OUT" == $'claude-opus-4-8\txhigh\tcopilot\tmodel' ]] || fail "expected the declared model/effort/agent plus the default mode, got: $OUT"
pass "coordinator_config_cli.bb prints a declared model/effort/agent"

OUT="$(bb "$CLI" "$ROOT/no-coordinator-config.conf")"
[[ "$OUT" == $'claude-sonnet-5\thigh\tclaude\tmodel' ]] || fail "expected the Sonnet/high/claude default with no coordinator_* lines, got: $OUT"
pass "coordinator_config_cli.bb falls back to claude-sonnet-5/high/claude when the conf declares none"

OUT="$(bb "$CLI" "$ROOT/does-not-exist.conf")"
[[ "$OUT" == $'claude-sonnet-5\thigh\tclaude\tmodel' ]] || fail "expected the default for a missing conf file, got: $OUT"
pass "coordinator_config_cli.bb falls back to the default for a missing conf file"

OUT="$(bb "$CLI" "$ROOT/deterministic.conf")"
[[ "$OUT" == $'claude-sonnet-5\thigh\tclaude\tdeterministic' ]] || fail "expected the declared deterministic mode, got: $OUT"
pass "coordinator_config_cli.bb prints the declared deterministic mode"

echo "ALL PASS"
