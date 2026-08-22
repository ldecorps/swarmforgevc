#!/usr/bin/env bash
# BL-853: backlog_depth_conf_path_cli.bb - the shell-callable entry point
# promote_and_route_next.sh's depth-cap fallback uses to resolve the
# EFFECTIVE config file path (a persisted .swarmforge/swarm-identity
# override, or the tracked default) without re-deriving that lookup in
# bash a second time.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../backlog_depth_conf_path_cli.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

OUT="$(bb "$CLI" "$ROOT")"
[[ "$OUT" == "$ROOT/swarmforge/swarmforge.conf" ]] || fail "expected the tracked default conf path with no persisted identity, got: $OUT"
pass "backlog_depth_conf_path_cli.bb resolves the tracked default with no persisted swarm-identity"

mkdir -p "$ROOT/.swarmforge" "$ROOT/custom"
printf 'active_backlog_max_depth_conf_path\tcustom/override.conf\n' > "$ROOT/.swarmforge/swarm-identity"
OUT="$(bb "$CLI" "$ROOT")"
[[ "$OUT" == "$ROOT/custom/override.conf" ]] || fail "expected the persisted override conf path, got: $OUT"
pass "backlog_depth_conf_path_cli.bb resolves a persisted swarm-identity override"

echo "ALL PASS"
