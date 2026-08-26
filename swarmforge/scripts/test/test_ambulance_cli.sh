#!/usr/bin/env bash
# BL-655: end-to-end coverage of ambulance_cli.bb against the real script -
# engage/release/status, the invalid-ticket and no-file refusals, and the
# ambulance-hold-09 idempotency contract (a repeated engage of the same
# ticket must not disturb engagedAtMs).

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp_cleanup.sh"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AMBULANCE_CLI="$SCRIPT_DIR/../ambulance_cli.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

mk_fixture() {
  local root
  root="$(cd "$(mktemp -d)" && pwd -P)"
  register_tmp_dir "$root"
  mkdir -p "$root/backlog/active"
  printf 'id: BL-654\ntitle: "demo"\nstatus: active\n' > "$root/backlog/active/BL-654-demo.yaml"
  echo "$root"
}

ROOT="$(mk_fixture)"

OUT="$(bb "$AMBULANCE_CLI" "$ROOT" status)"
echo "$OUT" | grep -q '"active":false' || fail "status-01: a fresh fixture must read inactive; got: $OUT"
pass "status-01: no marker -> inactive"

OUT="$(bb "$AMBULANCE_CLI" "$ROOT" engage BL-654)"
echo "$OUT" | grep -q '"active":true' || fail "engage-01: expected active:true; got: $OUT"
echo "$OUT" | grep -q '"ticket":"BL-654"' || fail "engage-01: expected ticket BL-654; got: $OUT"
pass "engage-01: engage writes an active marker naming the ticket"

FIRST_AT_MS="$(bb "$AMBULANCE_CLI" "$ROOT" status | grep -o '"engagedAtMs":[0-9]*')"
sleep 1
SECOND="$(bb "$AMBULANCE_CLI" "$ROOT" engage BL-654)"
SECOND_AT_MS="$(echo "$SECOND" | grep -o '"engagedAtMs":[0-9]*')"
[[ "$FIRST_AT_MS" == "$SECOND_AT_MS" ]] \
  || fail "ambulance-hold-09: a repeated engage of the same ticket must not bump engagedAtMs; first=$FIRST_AT_MS second=$SECOND_AT_MS"
pass "ambulance-hold-09: repeated engage of the same ticket is a true no-op"

set +e
OUT="$(bb "$AMBULANCE_CLI" "$ROOT" engage BL-999 2>&1)"
STATUS=$?
set -e
[[ "$STATUS" -ne 0 ]] || fail "engage-02: engaging a nonexistent ticket must refuse (nonzero exit); got exit 0: $OUT"
echo "$OUT" | grep -qi "no YAML file" || fail "engage-02: expected a no-file refusal message; got: $OUT"
pass "engage-02: engaging a ticket with no backlog file anywhere refuses instead of locking the swarm"

# The refused engage above must not have disturbed the live BL-654 marker.
OUT="$(bb "$AMBULANCE_CLI" "$ROOT" status)"
echo "$OUT" | grep -q '"ticket":"BL-654"' || fail "engage-02: a refused engage must leave the existing marker untouched; got: $OUT"
pass "engage-02b: a refused engage leaves the existing marker untouched"

set +e
OUT="$(bb "$AMBULANCE_CLI" "$ROOT" engage not-a-ticket 2>&1)"
STATUS=$?
set -e
[[ "$STATUS" -ne 0 ]] || fail "engage-03: engaging a syntactically invalid id must refuse; got exit 0: $OUT"
pass "engage-03: a syntactically invalid ticket id refuses"

OUT="$(bb "$AMBULANCE_CLI" "$ROOT" release)"
echo "$OUT" | grep -q '"active":false' || fail "release-01: expected active:false; got: $OUT"
pass "release-01: release clears an active marker"

OUT="$(bb "$AMBULANCE_CLI" "$ROOT" status)"
echo "$OUT" | grep -q '"active":false' || fail "release-01b: status after release must read inactive; got: $OUT"
pass "release-01b: status after release reads inactive"

# ambulance-hold-09: a release with no mode set is a true no-op.
OUT="$(bb "$AMBULANCE_CLI" "$ROOT" release)"
echo "$OUT" | grep -q '"active":false' || fail "release-02: releasing an already-released marker must still read inactive; got: $OUT"
pass "release-02: releasing with no mode set is a no-op"

rm -rf "$ROOT"
echo "ALL PASS"
