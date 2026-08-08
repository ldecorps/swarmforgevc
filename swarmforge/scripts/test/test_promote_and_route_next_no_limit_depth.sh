#!/usr/bin/env bash
# BL-853: end-to-end regression test for the live incident this ticket
# fixes - active_backlog_max_depth -1 (no limit) with active count already
# at/above the shared library's default (5) used to refuse every
# promotion (measured 2026-08-08: cap resolved to 5, active count 5, exit
# 2 "no open slot"). Proves the real promote_and_route_next.sh, not a
# reimplementation of its cap arithmetic.

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
# promotion_gates (BL-663) and the shared depth library (BL-853's
# depth-refusal fix load-files it) must travel with the copy.
cp "$SCRIPTS/promotion_gates_cli.bb" "$ROOT/swarmforge/scripts/promotion_gates_cli.bb"
cp "$SCRIPTS/promotion_gates_lib.bb" "$ROOT/swarmforge/scripts/promotion_gates_lib.bb"
cp "$SCRIPTS/backlog_depth_lib.bb" "$ROOT/swarmforge/scripts/backlog_depth_lib.bb"
cp "$SCRIPTS/swarm_identity_lib.bb" "$ROOT/swarmforge/scripts/swarm_identity_lib.bb"
cp "$SCRIPTS/backlog_depth_cli.bb" "$ROOT/swarmforge/scripts/backlog_depth_cli.bb"
cp "$SCRIPTS/backlog_depth_conf_path_cli.bb" "$ROOT/swarmforge/scripts/backlog_depth_conf_path_cli.bb"
cp "$SCRIPTS/effective_backlog_depth_cli.bb" "$ROOT/swarmforge/scripts/effective_backlog_depth_cli.bb"

cat > "$ROOT/swarmforge/scripts/route_backlog_to_coder.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1" > "${ROUTE_LOG:?missing ROUTE_LOG}"
EOF
chmod +x "$ROOT/swarmforge/scripts/route_backlog_to_coder.sh"

printf 'config active_backlog_max_depth -1\n' > "$ROOT/swarmforge/swarmforge.conf"

# 5 active tickets - the shared library's own default-max-depth, and
# exactly the count the live incident measured colliding with it.
for n in 1 2 3 4 5; do
  printf 'id: BL-90%s\ntitle: "active filler"\nstatus: active\npriority: 5\nassigned_to: coder\n' "$n" \
    > "$ROOT/backlog/active/BL-90$n-active.yaml"
done

printf 'id: BL-999\ntitle: "candidate"\nstatus: paused\npriority: 5\nassigned_to:\n' \
  > "$ROOT/backlog/paused/BL-999-candidate.yaml"
: > "$ROOT/specs/features/BL-999-candidate.feature"

git -C "$ROOT" add backlog specs swarmforge
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q -m "fixture: -1 cap, 5 active, 1 paused"
git -C "$ROOT" config user.email test@test
git -C "$ROOT" config user.name test

OUT="$(
  cd "$ROOT"
  ROUTE_LOG="$ROOT/route.log" \
    SWARMFORGE_SKIP_DAEMON=1 \
    SWARMFORGE_ROLE=coordinator \
    bash "$ROOT/swarmforge/scripts/promote_and_route_next.sh" 2>&1
)"

grep -q "no open slot" <<< "$OUT" \
  && fail "expected a -1 (no-limit) cap to allow promotion past 5 active tickets; got: $OUT"
grep -q "Promoted BL-999-candidate.yaml" <<< "$OUT" \
  || fail "expected BL-999 to be promoted; got: $OUT"
[[ -f "$ROOT/backlog/active/BL-999-candidate.yaml" ]] \
  || fail "BL-999 did not move into backlog/active/"
grep -q "^BL-999$" "$ROOT/route.log" \
  || fail "expected route helper to receive BL-999; got: $(cat "$ROOT/route.log")"
pass "a -1 (no-limit) cap promotes past 5 active tickets, the exact live-incident shape"

echo "ALL PASS"
