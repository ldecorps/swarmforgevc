#!/usr/bin/env bash
# BL-092 wakeup-bridge-04: the periodic-pull fallback keeps the remote
# checkout fresh via a safe fast-forward-only sync, never a force
# overwrite of local state.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PULL="$SCRIPT_DIR/../remote_wakeup_periodic_pull.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

UPSTREAM="$(mktemp -d)"
git -C "$UPSTREAM" init -q
git -C "$UPSTREAM" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
git -C "$UPSTREAM" branch -m main

CLONE="$(mktemp -d)"
git clone -q "$UPSTREAM" "$CLONE"
trap 'rm -rf "$UPSTREAM" "$CLONE"' EXIT

# ── 01: a fast-forward pull brings in a new upstream commit ────────────────
git -C "$UPSTREAM" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "new assignment"
bash "$PULL" "$CLONE"
[[ "$(git -C "$CLONE" rev-parse HEAD)" == "$(git -C "$UPSTREAM" rev-parse HEAD)" ]] \
  || fail "01: expected the clone to fast-forward to the new upstream commit"
pass "01: a fresh upstream commit is picked up by the periodic pull"

# ── 02: running it again with nothing new is a harmless no-op ─────────────
bash "$PULL" "$CLONE"
[[ "$(git -C "$CLONE" rev-parse HEAD)" == "$(git -C "$UPSTREAM" rev-parse HEAD)" ]] \
  || fail "02: expected the clone to remain at the same commit"
pass "02: running the pull again with nothing new is a harmless no-op"

# ── 03: a diverged local history is never force-overwritten ───────────────
git -C "$CLONE" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "local-only commit"
LOCAL_HEAD="$(git -C "$CLONE" rev-parse HEAD)"
git -C "$UPSTREAM" -c user.email=t@t -c user.name=t commit -q --allow-empty -m "another upstream commit"
set +e
bash "$PULL" "$CLONE" >/dev/null 2>&1
STATUS=$?
set -e
[[ "$STATUS" -ne 0 ]] || fail "03: expected the fast-forward-only merge to refuse a diverged history"
[[ "$(git -C "$CLONE" rev-parse HEAD)" == "$LOCAL_HEAD" ]] \
  || fail "03: the local-only commit must never be force-overwritten"
pass "03: a diverged local history is never force-overwritten (fast-forward-only refuses, does not clobber)"

echo "ALL PASS"
