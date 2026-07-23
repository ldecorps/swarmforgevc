#!/usr/bin/env bash
# BL-313: backlog_depth_cli.bb - the shell-callable entry point
# swarmforge.sh uses to resolve + persist + display the effective
# active_backlog_max_depth without re-implementing the parse in bash.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../backlog_depth_cli.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

printf 'config active_backlog_max_depth 1\n' > "$ROOT/cap1.conf"
printf 'config active_backlog_max_depth -1\n' > "$ROOT/unlimited.conf"

OUT="$(bb "$CLI" "$ROOT/cap1.conf")"
[[ "$OUT" == "1" ]] || fail "expected 1 for a conf declaring cap 1, got: $OUT"
pass "backlog_depth_cli.bb prints the resolved positive cap"

OUT="$(bb "$CLI" "$ROOT/unlimited.conf")"
[[ "$OUT" == "-1" ]] || fail "expected -1 (no-limit sentinel) preserved, got: $OUT"
pass "backlog_depth_cli.bb preserves the -1 no-limit sentinel"

OUT="$(bb "$CLI" "$ROOT/does-not-exist.conf")"
[[ "$OUT" == "5" ]] || fail "expected the shared default (5) for a missing conf file, got: $OUT"
pass "backlog_depth_cli.bb falls back to the shared default for a missing conf file"

echo "ALL PASS"
