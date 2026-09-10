#!/usr/bin/env bash
# BL-1497: subprocess-level proof that the REAL commit_integrity_cli.bb (and
# therefore commit_integrity_lib.bb's acquire-lock!) reaps a dead holder's
# checkout lock and only a dead holder's - driven against a real, scratch
# git fixture under mktemp, never the live checkout (BL-1390:
# `git rev-parse --git-common-dir` is confirmed inside the fixture before
# any mutating git call). Property coverage of the two BL-654 invariants
# (reap-decision's pure contract, and reap-stale-lock!'s re-verify-before-
# delete race guard) lives in bl1497_lock_reap_property_runner.bb, run from
# here too so both ride this one registered standing entry.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../commit_integrity_cli.bb"
PROPERTY_RUNNER="$SCRIPT_DIR/bl1497_lock_reap_property_runner.bb"
# BL-874: BSD touch has no -d relative-time form.
# shellcheck source=/dev/null
source "$SCRIPT_DIR/../portable_time_lib.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

git_repo() {
  local d
  d="$(mktemp -d)"
  (cd "$d" && git init -q && git config user.email t@t && git config user.name t && git commit -q -m init --allow-empty)
  printf '%s' "$d"
}

# BL-1390: refuse to run a single mutating git/CLI call against anything
# but a scratch repo this script itself just created under mktemp.
assert_fixture_root() {
  local d="$1" common
  common="$(git -C "$d" rev-parse --git-common-dir 2>/dev/null)" || fail "fixture root '$d' is not a git repo"
  case "$common" in
    /*) [[ "$common" == "$d"/* || "$common" == "$d" ]] || fail "fixture git-common-dir '$common' escapes fixture root '$d'" ;;
  esac
}

now_ms() { echo $(( $(date +%s) * 1000 )); }

# A guaranteed-dead pid: the subshell has already exited by the time this
# command substitution returns its own $$ (the ticket's own qa_e2e_procedure
# names this exact idiom).
dead_pid() { sh -c 'echo $$'; }

echo "== bl1497_lock_reap_property_runner.bb (BL-654 invariants) =="
PROPERTY_OUT="$(mktemp)"
trap 'rm -f "$PROPERTY_OUT"' EXIT
bb "$PROPERTY_RUNNER" | tee "$PROPERTY_OUT" || fail "bl1497_lock_reap_property_runner.bb exited non-zero"
grep -q "^ALL PASS" "$PROPERTY_OUT" || fail "expected ALL PASS from bl1497_lock_reap_property_runner.bb"
rm -f "$PROPERTY_OUT"
trap - EXIT
pass "bl1497_lock_reap_property_runner.bb (invariants 1 and 2)"

# ── scenario 01: a lock whose recorded owner is dead is reaped ─────────
ROOT1="$(git_repo)"
trap 'rm -rf "$ROOT1"' EXIT
assert_fixture_root "$ROOT1"

LOCK1="$ROOT1/.git/swarmforge-commit-integrity.lock"
mkdir -p "$LOCK1"
DEAD_PID="$(dead_pid)"
printf '{"pid":%s,"created_at_ms":%s}' "$DEAD_PID" "$(now_ms)" > "$LOCK1/owner.json"
printf 'human_approval: approved\n' > "$ROOT1/ticket.yaml"

OUT1="$(bb "$CLI" "$ROOT1" --message "Approve BL-1497-fixture-01" --path ticket.yaml)"
echo "$OUT1" | grep -q '"success":true' || fail "scenario 01: expected success:true, got: $OUT1"
echo "$OUT1" | grep -q '"reaped-lock":{' || fail "scenario 01: expected a reaped-lock field, got: $OUT1"
echo "$OUT1" | grep -q '"pid":'"$DEAD_PID" || fail "scenario 01: expected reaped-lock naming dead pid $DEAD_PID, got: $OUT1"
echo "$OUT1" | grep -q '"reason":"dead-owner"' || fail "scenario 01: expected reaped-lock reason dead-owner, got: $OUT1"
[[ ! -d "$LOCK1" ]] || fail "scenario 01: expected the lock directory absent after the commit lands"
pass "scenario 01: a lock whose recorded owner is dead is reaped and the commit lands"

rm -rf "$ROOT1"
trap - EXIT

# ── scenario 02: a lock whose recorded owner is alive is never reaped ──
ROOT2="$(git_repo)"
trap 'kill "$LIVE_PID" 2>/dev/null || true; rm -rf "$ROOT2"' EXIT
assert_fixture_root "$ROOT2"

LOCK2="$ROOT2/.git/swarmforge-commit-integrity.lock"
mkdir -p "$LOCK2"
sleep 300 &
LIVE_PID=$!
printf '{"pid":%s,"created_at_ms":%s}' "$LIVE_PID" "$(now_ms)" > "$LOCK2/owner.json"
printf 'human_approval: approved\n' > "$ROOT2/ticket.yaml"

# This call waits out the real bounded poll (default 100 x 50ms = 5s) since
# a live owner's lock is never touched, whatever its age - the ticket's own
# invariant 1. Slow but deterministic; no shorter path exists through the
# real production CLI, which exposes no attempt/delay override.
set +e
OUT2="$(bb "$CLI" "$ROOT2" --message "Approve BL-1497-fixture-02" --path ticket.yaml 2>&1)"
CODE2=$?
set -e
[[ "$CODE2" -ne 0 ]] || fail "scenario 02: expected a non-zero exit (lock-timeout), got 0: $OUT2"
echo "$OUT2" | grep -q 'lock-timeout' || fail "scenario 02: expected reason lock-timeout, got: $OUT2"
[[ -d "$LOCK2" ]] || fail "scenario 02: expected the lock directory to still exist afterward"
grep -q "\"pid\":$LIVE_PID" "$LOCK2/owner.json" || fail "scenario 02: expected the lock to still name the live pid $LIVE_PID afterward"
pass "scenario 02: a lock whose recorded owner is alive is never reaped"

kill "$LIVE_PID" 2>/dev/null || true
wait "$LIVE_PID" 2>/dev/null || true
rm -rf "$ROOT2"
trap - EXIT

# ── scenario 03: a record-less lock is reaped only past the age bound ──
# Past the bound (>= 5 minutes, the derived floor - commit_integrity_lib.bb
# record-less-lock-age-bound-ms): reaped, the commit lands.
ROOT3A="$(git_repo)"
trap 'rm -rf "$ROOT3A"' EXIT
assert_fixture_root "$ROOT3A"

LOCK3A="$ROOT3A/.git/swarmforge-commit-integrity.lock"
mkdir -p "$LOCK3A"
portable_touch_relative 6 minutes "$LOCK3A"
printf 'human_approval: approved\n' > "$ROOT3A/ticket.yaml"

OUT3A="$(bb "$CLI" "$ROOT3A" --message "Approve BL-1497-fixture-03a" --path ticket.yaml)"
echo "$OUT3A" | grep -q '"success":true' || fail "scenario 03 (past): expected success:true, got: $OUT3A"
echo "$OUT3A" | grep -q '"reason":"record-less-past-bound"' || fail "scenario 03 (past): expected reaped-lock reason record-less-past-bound, got: $OUT3A"
[[ ! -d "$LOCK3A" ]] || fail "scenario 03 (past): expected the lock directory absent after the commit lands"
pass "scenario 03 (past the age bound): a record-less lock is reaped and the commit lands"

rm -rf "$ROOT3A"
trap - EXIT

# Within the bound (a fresh record-less lock - a pre-fix holder still
# inside its own budget, or a not-yet-recorded fresh holder): never
# touched, same real bounded-poll wait as scenario 02.
ROOT3B="$(git_repo)"
trap 'rm -rf "$ROOT3B"' EXIT
assert_fixture_root "$ROOT3B"

LOCK3B="$ROOT3B/.git/swarmforge-commit-integrity.lock"
mkdir -p "$LOCK3B"
printf 'human_approval: approved\n' > "$ROOT3B/ticket.yaml"

set +e
OUT3B="$(bb "$CLI" "$ROOT3B" --message "Approve BL-1497-fixture-03b" --path ticket.yaml 2>&1)"
CODE3B=$?
set -e
[[ "$CODE3B" -ne 0 ]] || fail "scenario 03 (within): expected a non-zero exit (lock-timeout), got 0: $OUT3B"
echo "$OUT3B" | grep -q 'lock-timeout' || fail "scenario 03 (within): expected reason lock-timeout, got: $OUT3B"
[[ -d "$LOCK3B" ]] || fail "scenario 03 (within): expected the lock directory to still exist afterward"
[[ ! -e "$LOCK3B/owner.json" ]] || fail "scenario 03 (within): fixture plants no owner record - a real one appearing means something else raced this fixture"
pass "scenario 03 (within the age bound): a record-less lock is never reaped"

rm -rf "$ROOT3B"
trap - EXIT

echo "PASS: test_commit_integrity_1497_lock_reap.sh - all scenarios and properties held"
