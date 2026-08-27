#!/usr/bin/env bash
# Smoke test for scripts/wsl-bootstrap.sh — runs --check-only against the
# real repo without installing packages or compiling.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd -P)"
BOOTSTRAP="$REPO_ROOT/scripts/wsl-bootstrap.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

[[ -x "$BOOTSTRAP" ]] || chmod +x "$BOOTSTRAP"

OUT="$( "$BOOTSTRAP" --check-only 2>&1 )" || RC=$?
RC="${RC:-0}"

echo "$OUT" | grep -q "SwarmForge VC WSL bootstrap" || fail "01: missing banner"
echo "$OUT" | grep -q "Repo: $REPO_ROOT" || fail "02: repo path not reported"
echo "$OUT" | grep -q "SWARMFORGE_TERMINAL=none ./swarm" || fail "03: headless start command missing"
echo "$OUT" | grep -q "swarmforge-coordinator" || fail "04: tmux attach hint missing"

pass "wsl-bootstrap --check-only runs and prints WSL start commands"
