#!/usr/bin/env bash
# BL-711: the shared commit-msg hook refuses a bare "BL-<n>:" subject when
# staged paths include backlog/evidence/. Scoped prefixes stay allowed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUARD="$SCRIPT_DIR/../check_parcel_subject_evidence.sh"
COMMIT_MSG_HOOK="$SCRIPT_DIR/../../git-hooks/commit-msg"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
MSGDIR="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT" "$MSGDIR"' EXIT
MSG="$MSGDIR/msg.txt"

mkdir -p "$ROOT/backlog/evidence"
git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test add -A
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m init

run_guard() {
  (cd "$ROOT" && bash "$GUARD" "$@")
}

# ── 1: bare parcel subject + evidence path -> refused ─────────────────────
echo "pass evidence" > "$ROOT/backlog/evidence/BL-711-documenter-pass-20260827.md"
git -C "$ROOT" add backlog/evidence/BL-711-documenter-pass-20260827.md
echo "BL-711: documenter pass — Last Updated + evidence. By documenter." > "$MSG"
set +e
OUT1="$(run_guard "$MSG" 2>&1)"
STATUS1=$?
set -e
[[ "$STATUS1" -ne 0 ]] || fail "01: expected refusal for bare BL-711: subject on evidence"
echo "$OUT1" | grep -q "BL-711" || fail "01: refusal must name the ticket id, got: $OUT1"
echo "$OUT1" | grep -q "backlog/evidence/" || fail "01: refusal must name evidence paths, got: $OUT1"
pass "01: bare BL-711: subject touching backlog/evidence/ is refused"

git -C "$ROOT" reset -q

# ── 2: scoped docs(BL-711): subject + evidence path -> allowed ────────────
git -C "$ROOT" add backlog/evidence/BL-711-documenter-pass-20260827.md
echo "docs(BL-711): Last Updated + documenter evidence. By documenter." > "$MSG"
run_guard "$MSG" || fail "02: docs(BL-711): on evidence must be allowed"
pass "02: docs(BL-711): subject on evidence is allowed"

git -C "$ROOT" reset -q

# ── 3: bare parcel subject + prose only -> allowed ────────────────────────
mkdir -p "$ROOT/docs/reference"
echo "prose" >> "$ROOT/docs/reference/Specification.MD"
git -C "$ROOT" add docs/reference/Specification.MD
echo "BL-711: add interface-vs-incarnation glossary. By coder." > "$MSG"
run_guard "$MSG" || fail "03: bare BL-711: on prose-only commit must be allowed"
pass "03: bare BL-711: subject without evidence paths is allowed"

git -C "$ROOT" reset -q
git -C "$ROOT" checkout -q -- docs/reference/Specification.MD 2>/dev/null || rm -f "$ROOT/docs/reference/Specification.MD"

# ── 4: chore(BL-711): hardener delta + evidence -> allowed ────────────────
echo "pass evidence" > "$ROOT/backlog/evidence/BL-711-hardener-pass-20260827.md"
git -C "$ROOT" add backlog/evidence/BL-711-hardener-pass-20260827.md
echo "chore(BL-711): materialize hardener delta + register step handler. By documenter." > "$MSG"
run_guard "$MSG" || fail "04: chore(BL-711): on evidence must be allowed"
pass "04: chore(BL-711): subject on evidence is allowed"

git -C "$ROOT" reset -q

# ── 5: wired commit-msg hook blocks a real git commit ─────────────────────
mkdir -p "$ROOT/swarmforge/scripts" "$ROOT/swarmforge/git-hooks"
cp "$GUARD" "$ROOT/swarmforge/scripts/check_parcel_subject_evidence.sh"
cp "$SCRIPT_DIR/../check_ticket_deletion.sh" "$ROOT/swarmforge/scripts/check_ticket_deletion.sh"
cp "$COMMIT_MSG_HOOK" "$ROOT/swarmforge/git-hooks/commit-msg"
chmod +x "$ROOT/swarmforge/scripts/"*.sh "$ROOT/swarmforge/git-hooks/"*
git -C "$ROOT" add -A
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m "install hooks fixture"
git -C "$ROOT" config core.hooksPath swarmforge/git-hooks

git -C "$ROOT" add backlog/evidence/BL-711-documenter-pass-20260827.md
set +e
OUT5="$(cd "$ROOT" && git -c user.email=test@test -c user.name=test commit -q -m "BL-711: documenter pass. By documenter." 2>&1)"
STATUS5=$?
set -e
[[ "$STATUS5" -ne 0 ]] || fail "05: expected real git commit to be blocked by commit-msg hook"
echo "$OUT5" | grep -q "BL-711" || fail "05: hook output must name ticket id, got: $OUT5"
pass "05: installed commit-msg hook blocks bare BL-711: on evidence"

# ── 6: hook allows scoped subject on evidence ─────────────────────────────
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m "evidence(BL-711): QA bounce fix. By documenter." \
  || fail "06: evidence(BL-711): must commit through the hook"
pass "06: installed commit-msg hook allows evidence(BL-711): on evidence"

echo "ALL PASS"
