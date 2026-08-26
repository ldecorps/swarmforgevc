#!/usr/bin/env bash
# BL-1144 unit scenarios for land_main_publish.sh wiring.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI="$SCRIPT_DIR/../land_main_publish.sh"
REPO="$(cd "$SCRIPT_DIR/../../.." && pwd)"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
mkdir -p "$ROOT/.swarmforge"
git -C "$ROOT" init -q -b main
git -C "$ROOT" config user.email t@t
git -C "$ROOT" config user.name t
git -C "$ROOT" commit -q --allow-empty -m init
# origin/main == HEAD for tip-purity :push path
git -C "$ROOT" branch -M main
git -C "$ROOT" remote add origin "$ROOT/.git"
git -C "$ROOT" fetch origin main -q 2>/dev/null || true

# ── 01: decide-only prints EDN map (bb -e, not REPL) ───────────────────
grep -q 'bb -e' "$CLI" || fail "01: land_main_publish.sh must use bb -e for decide-only"
OUT01="$(bash "$CLI" "$ROOT" --decide-only 2>&1)" || fail "01: decide-only failed: $OUT01"
[[ "$OUT01" == \{* ]] || fail "01: expected EDN map output, got: $OUT01"
[[ "$OUT01" != *"user=>"* ]] || fail "01: REPL leak in output"
echo "$OUT01" | grep -q ':purity-action :push' \
  || fail "01: tip contains origin should yield :push, got: $OUT01"
pass "01 decide-only EDN + tip-pure :push"

# ── 02: existing lock dir → lock-admission not free admit on peer path ───
bash "$CLI" "$ROOT" --acquire-lock >/dev/null
OUT02="$(LAND_PEER_HOLDS_LOCK=1 bash "$CLI" "$ROOT" --decide-only 2>&1)" \
  || fail "02: decide-only with lock failed: $OUT02"
echo "$OUT02" | grep -q ':wait-land-lock' \
  || fail "02: peer lock should wait, got: $OUT02"
bash "$CLI" "$ROOT" --release-lock >/dev/null
pass "02 lock dir + peer → wait-land-lock"

# ── 02b: lock held without peer → rematch-once-at-edge (not admit) ───────
bash "$CLI" "$ROOT" --acquire-lock >/dev/null
OUT02B="$(bash "$CLI" "$ROOT" --decide-only 2>&1)" \
  || fail "02b: decide-only with held lock failed: $OUT02B"
echo "$OUT02B" | grep -q ':lock-admission :rematch-once-at-edge' \
  || fail "02b: held lock should rematch-once-at-edge, got: $OUT02B"
bash "$CLI" "$ROOT" --release-lock >/dev/null
pass "02b held lock → rematch-once-at-edge"

# ── 03: origin advanced since gate → flag set in decision ────────────────
SHA="$(git -C "$ROOT" rev-parse HEAD)"
OUT03="$(LAND_GATE_ORIGIN_SHA=0000000000000000000000000000000000000000 \
  bash "$CLI" "$ROOT" --decide-only 2>&1)" || fail "03: decide-only failed: $OUT03"
echo "$OUT03" | grep -q ':origin-advanced-since-gate true' \
  || fail "03: expected origin-advanced-since-gate true, got: $OUT03"
[[ -n "$SHA" ]] || fail "03: missing HEAD sha"
pass "03 origin-advanced-since-gate wiring"

echo "ALL PASS: land_main_publish.sh"
