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
# BL-1309 added a SECOND bb invocation to this script, so "some line says bb -e"
# stopped pinning the decide call: dropping -e from it left the other one to
# satisfy the grep. Assert the absent form instead - EVERY bb here passes its
# program with -e, never as a bare argument (the REPL-leak class BL-1144 pinned).
grep -q 'bb "\$(cat' "$CLI" \
  && fail "01: a bb invocation passes its program as a bare argument instead of with -e"
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

# ── BL-1309: the mandatory decide step asks what the tip carries ─────────
#
# Human ruling (2026-09-03, option 1): refuse EVERY entangled tip. The fixture
# is the shape the reflog caught on 2026-08-31 - a QA-branch tip whose merged
# ancestry carries a sibling ticket whose content never reached origin/main.

# A REAL separate origin, not the repo's own .git: the script fetches
# origin/main on every run, so a self-remote would refresh origin/main back to
# HEAD and the entanglement under test would vanish before it was measured.
E_WORK="$(cd "$(mktemp -d -t bl1309-land-XXXXXX)" && pwd -P)"
cleanup_bl1309() { rm -rf "$E_WORK"; }
trap cleanup_bl1309 EXIT
E_ORIGIN="$E_WORK/origin.git"
E_ROOT="$E_WORK/repo"
git init -q --bare -b main "$E_ORIGIN"
git init -q -b main "$E_ROOT"
mkdir -p "$E_ROOT/.swarmforge"
git -C "$E_ROOT" config user.email t@t
git -C "$E_ROOT" config user.name t
git -C "$E_ROOT" config commit.gpgsign false
git -C "$E_ROOT" remote add origin "$E_ORIGIN"
git -C "$E_ROOT" commit -q --allow-empty -m "seed"
git -C "$E_ROOT" push -q origin main
# Everything after the seed is what the tip would add over origin/main.
echo "sibling work" >"$E_ROOT/sibling.txt"
git -C "$E_ROOT" add -A
git -C "$E_ROOT" commit -q -m "BL-9002: a sibling's own work, never landed"
echo "own work" >"$E_ROOT/own.txt"
git -C "$E_ROOT" add -A
git -C "$E_ROOT" commit -q -m "BL-9001: the ticket being landed"

# ── 04: an unlanded sibling on the tip refuses, names it, exits 3 ────────
set +e
OUT04="$(bash "$CLI" "$E_ROOT" --decide-only 2>&1)"
CODE04=$?
set -e
[[ "$CODE04" -eq 3 ]] || fail "04: expected documented refusal status 3, got $CODE04: $OUT04"
grep -q 'ENTANGLED_SIBLING_BLOCK' <<<"$OUT04" || fail "04: no marker in refusal: $OUT04"
grep -q 'BL-9002' <<<"$OUT04" || fail "04: refusal does not name the unlanded sibling: $OUT04"
grep -q ':purity-action' <<<"$OUT04" && fail "04: a refusal still advised a push: $OUT04"
[[ ! -d "$E_ROOT/.swarmforge/land-main.publish.lock" ]] \
  || fail "04: refusal left the land lock held"
pass "04 unlanded sibling on the tip → ENTANGLED_SIBLING_BLOCK, exit 3, no advice"

# ── 05: once the sibling's content is on origin/main, the ordinary decision ─
git -C "$E_ROOT" push -q origin main
set +e
OUT05="$(bash "$CLI" "$E_ROOT" --decide-only 2>&1)"
CODE05=$?
set -e
[[ "$CODE05" -eq 0 ]] || fail "05: expected the ordinary decision, got $CODE05: $OUT05"
grep -q 'ENTANGLED_SIBLING_BLOCK' <<<"$OUT05" && fail "05: marker on a clean tip: $OUT05"
grep -q ':purity-action' <<<"$OUT05" || fail "05: no EDN decision printed: $OUT05"
pass "05 nothing unlanded → ordinary decision, no marker"

# ── 06: FAIL OPEN. A detector that cannot run never becomes a refusal ────
# Re-entangle first, so the ONLY thing standing between this run and a
# refusal is the unreadable detector - otherwise the row passes vacuously.
git -C "$E_ORIGIN" update-ref refs/heads/main \
  "$(git -C "$E_ROOT" rev-parse HEAD~2)"
git -C "$E_ROOT" fetch -q --prune --force origin "+refs/heads/main:refs/remotes/origin/main"
# Non-vacuity, asserted rather than assumed: with the detector PRESENT this
# same state must refuse. Otherwise the row below proves only that a clean tip
# stays clean.
set +e
bash "$CLI" "$E_ROOT" --decide-only >/dev/null 2>&1
CODE06PRE=$?
set -e
[[ "$CODE06PRE" -eq 3 ]] \
  || fail "06: the fail-open row is vacuous - this state does not refuse even with the detector present"
FAKE_SCRIPTS="$(cd "$(mktemp -d -t bl1309-nolib-XXXXXX)" && pwd -P)"
cp "$CLI" "$FAKE_SCRIPTS/land_main_publish.sh"
cp "$SCRIPT_DIR/../master_main_reconcile_lib.bb" "$FAKE_SCRIPTS/"
set +e
OUT06="$(bash "$FAKE_SCRIPTS/land_main_publish.sh" "$E_ROOT" --decide-only 2>&1)"
CODE06=$?
set -e
rm -rf "$FAKE_SCRIPTS"
[[ "$CODE06" -eq 0 ]] || fail "06: a blind detector refused, got $CODE06: $OUT06"
grep -q 'ENTANGLED_SIBLING_BLOCK' <<<"$OUT06" && fail "06: blind detector still refused: $OUT06"
grep -q ':purity-action' <<<"$OUT06" || fail "06: no ordinary decision when blind: $OUT06"
pass "06 detector absent → fails OPEN with the ordinary decision"

# ── 07: FAIL OPEN. A tip whose subject names no ticket is an unknown ─────
git -C "$E_ROOT" commit -q --allow-empty -m "housekeeping, naming no ticket"
set +e
OUT07="$(bash "$CLI" "$E_ROOT" --decide-only 2>&1)"
CODE07=$?
set -e
[[ "$CODE07" -eq 0 ]] || fail "07: an unknown ticket refused, got $CODE07: $OUT07"
grep -q 'ENTANGLED_SIBLING_BLOCK' <<<"$OUT07" && fail "07: unknown ticket refused: $OUT07"
pass "07 tip naming no ticket → fails OPEN"

echo "ALL PASS: land_main_publish.sh"
