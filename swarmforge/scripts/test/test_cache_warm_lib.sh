#!/usr/bin/env bash
# TDD tests for the BL-519 launch cache-warm content-hash decision.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# ── 1: pure + impure decision tests (bb) ────────────────────────────────────
bb "$SCRIPT_DIR/cache_warm_test_runner.bb" \
  || fail "cache_warm_test_runner.bb"

pass "01: cache_warm_lib pure/impure tests"

# ── 2: CLI decide-and-record-warm round-trip ────────────────────────────────
STATE_DIR="$(mktemp -d)"
trap 'rm -rf "$STATE_DIR"' EXIT

FIRST="$(bb "$ROOT/swarmforge/scripts/cache_warm_cli.bb" decide-and-record-warm "$STATE_DIR" cli-pack "modelA" | head -1)"
[[ "$FIRST" == "rewarm" ]] \
  || fail "02: first launch of a pack must re-warm, got: $FIRST"

SECOND="$(bb "$ROOT/swarmforge/scripts/cache_warm_cli.bb" decide-and-record-warm "$STATE_DIR" cli-pack "modelA" | head -1)"
[[ "$SECOND" == "reuse-cache" ]] \
  || fail "02: an unchanged relaunch must reuse the cache, got: $SECOND"

THIRD="$(bb "$ROOT/swarmforge/scripts/cache_warm_cli.bb" decide-and-record-warm "$STATE_DIR" cli-pack "modelB" | head -1)"
[[ "$THIRD" == "rewarm" ]] \
  || fail "02: a changed model-routing-text must re-warm, got: $THIRD"

pass "02: CLI decide-and-record-warm tracks the stable-prefix content hash"

echo "ALL PASS"
