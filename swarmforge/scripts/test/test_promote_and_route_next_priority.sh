#!/usr/bin/env bash
# Proves promote_and_route_next.sh picks the next buildable paused ticket by
# priority ascending, then id ascending, instead of filename order.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPTS="$(cd "$SCRIPT_DIR/.." && pwd)"
HELPER="$SCRIPTS/promote_and_route_next.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

mkdir -p "$ROOT/backlog/paused" "$ROOT/backlog/active" "$ROOT/specs/features" "$ROOT/swarmforge/scripts"

cp "$HELPER" "$ROOT/swarmforge/scripts/promote_and_route_next.sh"
chmod +x "$ROOT/swarmforge/scripts/promote_and_route_next.sh"

cat > "$ROOT/swarmforge/scripts/route_backlog_to_coder.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1" > "${ROUTE_LOG:?missing ROUTE_LOG}"
EOF
chmod +x "$ROOT/swarmforge/scripts/route_backlog_to_coder.sh"

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
