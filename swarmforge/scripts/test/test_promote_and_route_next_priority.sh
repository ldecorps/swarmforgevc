#!/usr/bin/env bash
# Proves promote_and_route_next.sh picks the next buildable paused ticket by
# priority ascending, then id ascending, instead of filename order.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPTS="$(cd "$SCRIPT_DIR/.." && pwd)"
HELPER="$SCRIPTS/promote_and_route_next.sh"
source "$SCRIPT_DIR/lib/bb_closure_copy.sh"
source "$SCRIPT_DIR/lib/bb_fixture_load_guard.sh"
source "$SCRIPT_DIR/lib/deprecate_check_allow_stub.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

mkdir -p "$ROOT/backlog/paused" "$ROOT/backlog/active" "$ROOT/specs/features" "$ROOT/swarmforge/scripts"

cp "$HELPER" "$ROOT/swarmforge/scripts/promote_and_route_next.sh"
chmod +x "$ROOT/swarmforge/scripts/promote_and_route_next.sh"
# BL-1480: DERIVED from promotion_gates_cli.bb's real transitive load-file
# closure, never a hand-written cp list. The hand list this replaces went
# stale twice after BL-853 (BL-966's daemon_cycle_guard_lib.bb edge, then
# BL-626/BL-1128/BL-634's three more edges) and this test sat red on main
# for 18 days, unowned, because no standing gate ran it.
copy_bb_closure "$SCRIPTS" "$ROOT/swarmforge/scripts" promotion_gates_cli.bb \
  || fail "could not derive promotion_gates_cli.bb's load-file closure"
# And nothing runs until that root can actually load (BL-1480 invariant 2).
assert_bb_closure_present "$SCRIPTS" "$ROOT/swarmforge/scripts" promotion_gates_cli.bb

cat > "$ROOT/swarmforge/scripts/route_backlog_to_coder.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1" > "${ROUTE_LOG:?missing ROUTE_LOG}"
EOF
chmod +x "$ROOT/swarmforge/scripts/route_backlog_to_coder.sh"
# BL-1173's deprecator freshness gate consults this path; see the stub's own
# header comment for why a real deprecate-check.js can't travel here.
write_deprecate_check_allow_stub "$ROOT"

printf 'id: BL-516\ntitle: "higher priority number"\nstatus: paused\npriority: 8\nassigned_to:\n' \
  > "$ROOT/backlog/paused/BL-516-higher-priority-number.yaml"
printf 'id: BL-101\ntitle: "blocked item"\nstatus: blocked\npriority: 1\nassigned_to:\n' \
  > "$ROOT/backlog/paused/BL-101-blocked-item.yaml"
printf 'id: BL-536\ntitle: "lower priority number"\nstatus: paused\npriority: 2\nassigned_to:\n' \
  > "$ROOT/backlog/paused/BL-536-lower-priority-number.yaml"

: > "$ROOT/specs/features/BL-516-higher-priority-number.feature"
: > "$ROOT/specs/features/BL-101-blocked-item.feature"
: > "$ROOT/specs/features/BL-536-lower-priority-number.feature"

git -C "$ROOT" add backlog specs
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m "fixture paused backlog"
git -C "$ROOT" config user.email test@test
git -C "$ROOT" config user.name test

OUT="$(
  cd "$ROOT"
  ROUTE_LOG="$ROOT/route.log" \
    SWARMFORGE_SKIP_DAEMON=1 \
    SWARMFORGE_ROLE=coordinator \
    bash "$ROOT/swarmforge/scripts/promote_and_route_next.sh" 2>&1
)"

grep -q "Promoted BL-536-lower-priority-number.yaml" <<< "$OUT" \
  || fail "expected BL-536 to be promoted first, skipping the blocked BL-101; got: $OUT"
grep -q "^BL-536$" "$ROOT/route.log" \
  || fail "expected route helper to receive BL-536; got: $(cat "$ROOT/route.log")"
[[ -f "$ROOT/backlog/active/BL-536-lower-priority-number.yaml" ]] \
  || fail "BL-536 did not move into backlog/active/"
[[ -f "$ROOT/backlog/paused/BL-516-higher-priority-number.yaml" ]] \
  || fail "BL-516 should have stayed in backlog/paused/"
[[ -f "$ROOT/backlog/paused/BL-101-blocked-item.yaml" ]] \
  || fail "BL-101 blocked item should not have been promoted"

pass "promote_and_route_next prioritizes by priority then id and skips blocked tickets"
echo "ALL PASS"
