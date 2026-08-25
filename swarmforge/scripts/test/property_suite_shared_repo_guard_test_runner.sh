#!/usr/bin/env bash
# BL-1124: shared-repo canary + recovery refusal unit scenarios.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUARD_LIB="$SCRIPT_DIR/../property_suite_shared_repo_guard.sh"
RECOVERY="$SCRIPT_DIR/../main_recovery_refuse_when_ahead.sh"
DRIFT="$SCRIPT_DIR/../check_property_suite_drift.sh"

# shellcheck source=../property_suite_shared_repo_guard.sh
source "$GUARD_LIB"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q -b main
git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init

# ── 01: snapshot + unchanged asserts on a clean fixture ───────────────────
BEFORE="$(bl1124_snapshot "$ROOT")"
bl1124_assert_unchanged "$ROOT" "$BEFORE" || fail "01: clean tree must assert unchanged"
pass "01: snapshot/assert round-trip on clean non-bare repo"

# ── 02: bare flip fails the post-lane assert ──────────────────────────────
git -C "$ROOT" config core.bare true
set +e
bl1124_assert_not_bare "$ROOT"
ST02=$?
set -e
[[ "$ST02" -ne 0 ]] || fail "02: bare=true must fail assert_not_bare"
git -C "$ROOT" config core.bare false
pass "02: post-lane assert fails when core.bare is true"

# ── 03: recovery refuses when ahead of origin/main ────────────────────────
git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q --allow-empty -m ahead
git -C "$ROOT" update-ref refs/remotes/origin/main HEAD~1
set +e
OUT03="$("$RECOVERY" "$ROOT" 2>&1)"
ST03=$?
set -e
[[ "$ST03" -ne 0 ]] || fail "03: ahead tip must refuse recovery, got 0: $OUT03"
echo "$OUT03" | grep -q 'ahead of origin/main' || fail "03: expected ahead message: $OUT03"
pass "03: recovery refuses reset-to-origin when local is ahead"

# ── 04: refuse live fixture dest ──────────────────────────────────────────
LIVE="$(cd "$(mktemp -d)" && pwd -P)"
mkdir -p "$LIVE/swarmforge/scripts"
: > "$LIVE/swarmforge/scripts/handoffd.bb"
set +e
OUT04="$(bl1124_refuse_live_fixture_dest "$LIVE" 2>&1)"
ST04=$?
set -e
[[ "$ST04" -ne 0 ]] || fail "04: live checkout dest must be refused"
rm -rf "$LIVE"
pass "04: refuse_live_fixture_dest blocks a swarmforge checkout path"

# Empty dest must refuse (not silently succeed) — kills return-0-on-empty mutant.
set +e
OUT04b="$(bl1124_refuse_live_fixture_dest "" 2>&1)"
ST04b=$?
set -e
[[ "$ST04b" -ne 0 ]] || fail "04b: empty fixture dest must be refused, got 0: $OUT04b"
pass "04b: refuse_live_fixture_dest rejects empty dest"

# ── 04c: assert_unchanged detects HEAD advance (bare still false) ─────────
BEFORE04c="$(bl1124_snapshot "$ROOT")"
git -C "$ROOT" -c user.email=t@t -c user.name=t commit -q --allow-empty -m advance-canary
set +e
OUT04c="$(bl1124_assert_unchanged "$ROOT" "$BEFORE04c" 2>&1)"
ST04c=$?
set -e
[[ "$ST04c" -ne 0 ]] || fail "04c: HEAD advance must fail assert_unchanged: $OUT04c"
pass "04c: assert_unchanged fails when HEAD sha advances"

# Direct guard recovery refusal (not only the wrapper script).
set +e
OUT04d="$(bl1124_refuse_reset_when_ahead "$ROOT" 2>&1)"
ST04d=$?
set -e
[[ "$ST04d" -ne 0 ]] || fail "04d: guard refuse_reset_when_ahead must fail when ahead"
pass "04d: bl1124_refuse_reset_when_ahead refuses when ahead"

# ── 05: drift guard canary catches bare flip mid-suite ────────────────────
FIX="$(cd "$(mktemp -d)" && pwd -P)"
git -C "$FIX" init -q -b main
git -C "$FIX" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
mkdir -p "$FIX/extension/src"
echo 'x' > "$FIX/extension/src/a.ts"
git -C "$FIX" add extension/src/a.ts
# Suite flips bare then exits 0 — canary must still reject.
FLIP=(bash -c "git -C '$FIX' config core.bare true; exit 0")
set +e
OUT05="$(cd "$FIX" && bash "$DRIFT" "${FLIP[@]}" 2>&1)"
ST05=$?
set -e
[[ "$ST05" -ne 0 ]] || fail "05: drift guard must fail canary on bare flip: $OUT05"
echo "$OUT05" | grep -q 'BL-1124' || fail "05: expected BL-1124 marker: $OUT05"
rm -rf "$FIX"
pass "05: property-suite drift guard fails when suite flips core.bare"

echo "BL-1124 property_suite_shared_repo_guard: ALL PASS"
