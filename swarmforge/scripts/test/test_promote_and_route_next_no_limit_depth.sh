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
# BL-1480: DERIVED from the real transitive load-file closure of every bb
# entry point this fixture drives, never a hand-written cp list. Named here:
# promotion_gates_cli.bb (BL-663's chokepoint) plus the three CLIs
# promote_and_route_next.sh SHELLS to directly for cap resolution
# (effective_backlog_depth_cli.bb, backlog_depth_cli.bb,
# backlog_depth_conf_path_cli.bb, lines 107-113 of the real script) - no
# walk from promotion_gates_cli.bb alone reaches those three. The hand list
# this replaces named only four of what's now eight distinct files and sat
# red on main 18 days after BL-966/BL-626/BL-1128/BL-634 each added a load-file
# edge upstream.
copy_bb_closure "$SCRIPTS" "$ROOT/swarmforge/scripts" \
  promotion_gates_cli.bb effective_backlog_depth_cli.bb \
  backlog_depth_cli.bb backlog_depth_conf_path_cli.bb \
  || fail "could not derive the fixture's load-file closure"
# And nothing runs until every one of those entry points can actually load
# (BL-1480 invariant 2).
for entry in promotion_gates_cli.bb effective_backlog_depth_cli.bb \
  backlog_depth_cli.bb backlog_depth_conf_path_cli.bb; do
  assert_bb_closure_present "$SCRIPTS" "$ROOT/swarmforge/scripts" "$entry"
done

cat > "$ROOT/swarmforge/scripts/route_backlog_to_coder.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1" > "${ROUTE_LOG:?missing ROUTE_LOG}"
EOF
chmod +x "$ROOT/swarmforge/scripts/route_backlog_to_coder.sh"
# BL-1173's deprecator freshness gate consults this path; see the stub's own
# header comment for why a real deprecate-check.js can't travel here.
write_deprecate_check_allow_stub "$ROOT"

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

# BL-853 hardener addendum: the test above resolves CAP via the PRIMARY
# effective_backlog_depth_cli.bb path (it succeeds even with no compiled
# extension/out/, degrading its throttle-recommendation refresh and still
# printing the configured -1) - it never actually exercises the FALLBACK
# branch this ticket's diff rewrote (backlog_depth_conf_path_cli.bb ->
# backlog_depth_cli.bb). That fallback branch is precisely where the live
# incident's root cause lived: the pre-fix code passed backlog_depth_cli.bb
# the project ROOT where it expects a CONF-PATH, so slurping it as a file
# failed and silently degraded to the library default (5). Force the
# fallback by omitting effective_backlog_depth_cli.bb entirely (the script's
# own `[[ -f ... ]]` guard treats that identically to "cannot be run at
# all"), and prove it independently against the pre-BL-853
# promote_and_route_next.sh to confirm this is non-vacuous (that old script
# reproduces the exact live incident: exit 2, "active count 5 >= cap 5").

ROOT2="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT" "$ROOT2"' EXIT

git -C "$ROOT2" init -q
git -C "$ROOT2" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

mkdir -p "$ROOT2/backlog/paused" "$ROOT2/backlog/active" "$ROOT2/specs/features" "$ROOT2/swarmforge/scripts"

cp "$HELPER" "$ROOT2/swarmforge/scripts/promote_and_route_next.sh"
chmod +x "$ROOT2/swarmforge/scripts/promote_and_route_next.sh"
# BL-1480: same derivation as ROOT above, but entry points deliberately
# EXCLUDE effective_backlog_depth_cli.bb - the primary
# `[[ -f "$SCRIPT_DIR/effective_backlog_depth_cli.bb" ]]` check then fails,
# forcing the script straight into the fallback branch under test
# (backlog_depth_conf_path_cli.bb -> backlog_depth_cli.bb). Naming fewer
# entry points here is a decision, not an omission: copy_bb_closure only
# ever copies what its given entry points actually reach, so leaving
# effective_backlog_depth_cli.bb out of this call is what forces the
# fallback, exactly as the hand list it replaces did by simply not `cp`-ing
# that one file.
copy_bb_closure "$SCRIPTS" "$ROOT2/swarmforge/scripts" \
  promotion_gates_cli.bb backlog_depth_cli.bb backlog_depth_conf_path_cli.bb \
  || fail "could not derive the fallback fixture's load-file closure"
for entry in promotion_gates_cli.bb backlog_depth_cli.bb backlog_depth_conf_path_cli.bb; do
  assert_bb_closure_present "$SCRIPTS" "$ROOT2/swarmforge/scripts" "$entry"
done
[[ ! -f "$ROOT2/swarmforge/scripts/effective_backlog_depth_cli.bb" ]] \
  || fail "effective_backlog_depth_cli.bb must be ABSENT from ROOT2 to force the fallback branch"

cat > "$ROOT2/swarmforge/scripts/route_backlog_to_coder.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1" > "${ROUTE_LOG:?missing ROUTE_LOG}"
EOF
chmod +x "$ROOT2/swarmforge/scripts/route_backlog_to_coder.sh"
write_deprecate_check_allow_stub "$ROOT2"

printf 'config active_backlog_max_depth -1\n' > "$ROOT2/swarmforge/swarmforge.conf"

for n in 1 2 3 4 5; do
  printf 'id: BL-90%s\ntitle: "active filler"\nstatus: active\npriority: 5\nassigned_to: coder\n' "$n" \
    > "$ROOT2/backlog/active/BL-90$n-active.yaml"
done

printf 'id: BL-999\ntitle: "candidate"\nstatus: paused\npriority: 5\nassigned_to:\n' \
  > "$ROOT2/backlog/paused/BL-999-candidate.yaml"
: > "$ROOT2/specs/features/BL-999-candidate.feature"

git -C "$ROOT2" add backlog specs swarmforge
git -C "$ROOT2" -c user.email=test@test -c user.name=test commit -q -m "fixture: -1 cap via fallback path, 5 active, 1 paused"
git -C "$ROOT2" config user.email test@test
git -C "$ROOT2" config user.name test

OUT2="$(
  cd "$ROOT2"
  ROUTE_LOG="$ROOT2/route.log" \
    SWARMFORGE_SKIP_DAEMON=1 \
    SWARMFORGE_ROLE=coordinator \
    bash "$ROOT2/swarmforge/scripts/promote_and_route_next.sh" 2>&1
)"

grep -q "no open slot" <<< "$OUT2" \
  && fail "fallback path: expected a -1 (no-limit) cap to allow promotion past 5 active tickets; got: $OUT2"
grep -q "Promoted BL-999-candidate.yaml" <<< "$OUT2" \
  || fail "fallback path: expected BL-999 to be promoted; got: $OUT2"
[[ -f "$ROOT2/backlog/active/BL-999-candidate.yaml" ]] \
  || fail "fallback path: BL-999 did not move into backlog/active/"
grep -q "^BL-999$" "$ROOT2/route.log" \
  || fail "fallback path: expected route helper to receive BL-999; got: $(cat "$ROOT2/route.log")"
pass "fallback path (effective_backlog_depth_cli.bb unavailable): a -1 cap still resolves via backlog_depth_conf_path_cli.bb -> backlog_depth_cli.bb and promotes past 5 active tickets"

echo "ALL PASS"
