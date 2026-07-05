#!/usr/bin/env bash
# BL-105: ensure_commit_size_guard (swarmforge.sh) must install the shared
# pre-commit hook path repo-wide, idempotently, on every launch.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SWARMFORGE_SH="$SCRIPT_DIR/../swarmforge.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

zsh -c "source '$SWARMFORGE_SH' '$ROOT'; ensure_commit_size_guard"
HOOKS_PATH="$(git -C "$ROOT" config core.hooksPath)"
[[ "$HOOKS_PATH" == "swarmforge/git-hooks" ]] || fail "01: expected core.hooksPath 'swarmforge/git-hooks', got '$HOOKS_PATH'"
pass "01: ensure_commit_size_guard installs core.hooksPath pointing at the tracked hooks dir"

# ── re-running is a no-op (idempotent), does not error or change the value ─
zsh -c "source '$SWARMFORGE_SH' '$ROOT'; ensure_commit_size_guard"
HOOKS_PATH2="$(git -C "$ROOT" config core.hooksPath)"
[[ "$HOOKS_PATH2" == "swarmforge/git-hooks" ]] || fail "02: expected core.hooksPath unchanged on re-run, got '$HOOKS_PATH2'"
pass "02: re-running ensure_commit_size_guard is idempotent"

echo "ALL PASS"
