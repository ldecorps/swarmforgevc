#!/usr/bin/env bash
# BL-1097: the coordinator's router must not ORIGINATE a parcel for a ticket
# whose work is already finished.
#
# Article 1.9 forbids FORWARDING a no-op parcel. Nothing bound the router that
# originates one, and nothing advances a ticket's `status:` while it travels -
# so for the whole window between the work finishing and the coordinator's
# separate bookkeeping step moving it to backlog/done/, finished work is
# indistinguishable from unstarted work to route_backlog_to_coder.sh. Measured
# 2026-08-23: four such routes in about an hour, and on BL-973 the receiving
# coder did not notice and built a second complete rival implementation.
#
# This drives the REAL route_backlog_to_coder.sh against a fixture project
# root - real promotion_gates_cli.bb, real swarm_handoff.sh, real
# dispatch_trail_cli.bb. No tmux: SWARMFORGE_SKIP_SYNC_INJECT=1 keeps the
# outbound path off the live swarm (a shell test that touches tmux killed
# eight live sessions on 2026-08-22).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROUTE_SH="$SCRIPT_DIR/../route_backlog_to_coder.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

mkdir -p "$ROOT/.swarmforge" "$ROOT/backlog/active" "$ROOT/backlog/done" "$ROOT/swarmforge"
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\ncoder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' \
  "$ROOT" "$ROOT" > "$ROOT/.swarmforge/roles.tsv"
printf 'config active_backlog_max_depth 50\n' > "$ROOT/swarmforge/swarmforge.conf"
printf 'id: BL-9097\ntitle: "demo"\nstatus: todo\nassigned_to: coder\n' \
  > "$ROOT/backlog/active/BL-9097-demo.yaml"

# Every parcel this fixture can emit, wherever swarm_handoff.sh parks it.
emitted_count() { find "$ROOT/.swarmforge/handoffs" -name '*.handoff' -type f 2>/dev/null | wc -l | tr -d '[:space:]'; }

route() {
  ( cd "$ROOT" && env -u SWARMFORGE_CONFIG \
      SWARMFORGE_SKIP_SYNC_INJECT=1 SWARMFORGE_ROLE=coordinator \
      "$ROUTE_SH" "$@" 2>&1 )
}

# ── 01: the working path survives - a never-dispatched active ticket routes ─
# This assertion comes first deliberately. A gate that refuses everything would
# "fix" the defect and starve the pipeline, which is the worse failure.
BEFORE="$(emitted_count)"
OUT="$(route BL-9097 "$ROOT")"; RC=$?
AFTER="$(emitted_count)"
(( AFTER > BEFORE )) || fail "01: expected a parcel to be emitted for a never-dispatched ticket; rc=$RC out: $OUT"
grep -q "already has a dispatch trail" <<< "$OUT" && fail "01: the first route must not be refused; out: $OUT"
pass "01: a never-dispatched active ticket is still routed ($((AFTER - BEFORE)) parcel emitted)"

# ── 02: the defect - the SAME ticket, now with a trail, must not route again ─
BEFORE="$(emitted_count)"
OUT="$(route BL-9097 "$ROOT")"; RC=$?
AFTER="$(emitted_count)"
(( RC == 3 )) || fail "02: expected refusal exit 3, got rc=$RC; out: $OUT"
(( AFTER == BEFORE )) || fail "02: a refused route emitted $((AFTER - BEFORE)) parcel(s); out: $OUT"
grep -q "BL-9097 already has a dispatch trail" <<< "$OUT" \
  || fail "02: expected the refusal to name the ticket and the reason; out: $OUT"
pass "02: a ticket that already has a dispatch trail is refused, and nothing is sent"

# ── 03: the window itself - still in backlog/active/, work finished ─────────
# The exact state all four evidence tickets were in. A fix that only checked
# backlog/done/ membership would pass 02 and fail here.
grep -q '^status: todo$' "$ROOT/backlog/active/BL-9097-demo.yaml" \
  || fail "03: fixture drift - the ticket should still carry its mint status"
[[ -f "$ROOT/backlog/active/BL-9097-demo.yaml" ]] \
  || fail "03: fixture drift - the ticket should still be in backlog/active/"
[[ -z "$(ls -A "$ROOT/backlog/done" 2>/dev/null)" ]] \
  || fail "03: fixture drift - backlog/done/ should still be empty"
pass "03: the refusal holds while the ticket is still active and undone - the window the defect lives in"

# ── 04: a refusal leaves the ticket byte-identical ─────────────────────────
# The assigned_to rewrite is a side effect of routing; a route that did not
# happen must not have had it.
cp "$ROOT/backlog/active/BL-9097-demo.yaml" "$ROOT/before.yaml"
route BL-9097 "$ROOT" >/dev/null 2>&1
cmp -s "$ROOT/before.yaml" "$ROOT/backlog/active/BL-9097-demo.yaml" \
  || fail "04: a refused route modified the ticket file"
pass "04: a refused route leaves the ticket file untouched"

# ── 05: --force is the deliberate override ─────────────────────────────────
BEFORE="$(emitted_count)"
OUT="$(route --force BL-9097 "$ROOT")"
AFTER="$(emitted_count)"
(( AFTER > BEFORE )) || fail "05: expected --force to route anyway; out: $OUT"
pass "05: --force re-routes a dispatched ticket on purpose"

# ── 06: a DIFFERENT ticket with no trail is unaffected by its neighbour ────
printf 'id: BL-9098\ntitle: "demo two"\nstatus: todo\nassigned_to: coder\n' \
  > "$ROOT/backlog/active/BL-9098-demo-two.yaml"
BEFORE="$(emitted_count)"
OUT="$(route BL-9098 "$ROOT")"
AFTER="$(emitted_count)"
(( AFTER > BEFORE )) || fail "06: expected a fresh ticket to route; out: $OUT"
pass "06: a fresh ticket beside a dispatched one still routes"

# ── 07: the router and the sweep agree over the whole corpus (invariant 2) ──
# BL-9097 has a trail, BL-9098 now has one too, and BL-9099 has none. The
# sweep's undispatched list and the router's per-ticket answers must partition
# the corpus identically, with no disagreement in either direction.
printf 'id: BL-9099\ntitle: "demo three"\nstatus: todo\nassigned_to: coder\n' \
  > "$ROOT/backlog/active/BL-9099-demo-three.yaml"
SWEEP_SAYS="$(bb "$SCRIPT_DIR/../dispatch_trail_cli.bb" "$ROOT" undispatched-active | sort | tr '\n' ' ')"
ROUTER_SAYS=""
for id in BL-9097 BL-9098 BL-9099; do
  ANS="$(bb "$SCRIPT_DIR/../dispatch_trail_cli.bb" "$ROOT" dispatched "$id")"
  [[ "$ANS" == "UNDISPATCHED" ]] && ROUTER_SAYS="${ROUTER_SAYS}${id} "
done
[[ "$SWEEP_SAYS" == "$ROUTER_SAYS" ]] \
  || fail "07: router said [$ROUTER_SAYS] but the sweep said [$SWEEP_SAYS]"
[[ "$SWEEP_SAYS" == "BL-9099 " ]] \
  || fail "07: the agreement is vacuous - expected exactly BL-9099 undispatched, got [$SWEEP_SAYS]"
pass "07: the router and the dispatch-gap sweep give identical answers over a mixed corpus"

# ── BL-1415: a dispatch the recipient completed long ago, nothing since, ────
# routes WITHOUT --force, naming what it repairs.
CODER_COMPLETED_DIR="$(bb -e "
(require '[babashka.fs :as fs])
(load-file \"$SCRIPT_DIR/../handoff_lib.bb\")
(println (str (handoff-lib/mailbox-dir (handoff-lib/load-role-info \"coder\" \"$ROOT\") :completed)))
")"
mkdir -p "$CODER_COMPLETED_DIR"
LONG_AGO="$(date -u -d '50 minutes ago' +%Y-%m-%dT%H:%M:%S.000000Z 2>/dev/null || date -u -v-50M +%Y-%m-%dT%H:%M:%S.000000Z)"
printf 'from: coordinator\nto: coder\ntype: note\nmessage: Work BL-9100-demo: read file in backlog/active\ncompleted_at: %s\n\nbody\n' \
  "$LONG_AGO" > "$CODER_COMPLETED_DIR/00_bl9100.handoff"
printf 'id: BL-9100\ntitle: "demo four"\nstatus: todo\nassigned_to: coder\n' \
  > "$ROOT/backlog/active/BL-9100-demo-four.yaml"

BEFORE="$(emitted_count)"
OUT="$(route BL-9100 "$ROOT")"
AFTER="$(emitted_count)"
(( AFTER > BEFORE )) || fail "08: expected a parcel to be emitted for a dropped ticket (no --force needed); out: $OUT"
grep -q "already has a dispatch trail" <<< "$OUT" && fail "08: a DROPPED ticket must not be refused as DISPATCHED; out: $OUT"
grep -q "BL-9100" <<< "$OUT" && grep -q "no parcel in flight - possible drop" <<< "$OUT" \
  || fail "08: expected the router to name what it is repairing; out: $OUT"
pass "08: a dispatch completed long ago with nothing after it is DROPPED and routes without --force"

# ── BL-1415: dispatch_trail_cli.bb itself prints DROPPED with the reason ───
# A SEPARATE ticket - test 08's own route just created a fresh dispatch
# trail for BL-9100, which correctly makes it read DISPATCHED again.
mkdir -p "$CODER_COMPLETED_DIR"
printf 'from: coordinator\nto: coder\ntype: note\nmessage: Work BL-9102-demo: read file in backlog/active\ncompleted_at: %s\n\nbody\n' \
  "$LONG_AGO" > "$CODER_COMPLETED_DIR/00_bl9102.handoff"
printf 'id: BL-9102\ntitle: "demo six"\nstatus: todo\nassigned_to: coder\n' \
  > "$ROOT/backlog/active/BL-9102-demo-six.yaml"
CLI_OUT="$(bb "$SCRIPT_DIR/../dispatch_trail_cli.bb" "$ROOT" dispatched BL-9102)"
[[ "$CLI_OUT" == DROPPED* ]] || fail "09: expected DROPPED from the CLI, got: $CLI_OUT"
grep -q "no parcel in flight - possible drop" <<< "$CLI_OUT" \
  || fail "09: expected the CLI's reason to be the sweep's own nudge text; got: $CLI_OUT"
pass "09: dispatch_trail_cli.bb prints DROPPED naming the same reason the sweep uses"

# ── BL-1415: live mail (still unread) is never DROPPED, whatever its age ───
CODER_NEW_DIR="$(bb -e "
(require '[babashka.fs :as fs])
(load-file \"$SCRIPT_DIR/../handoff_lib.bb\")
(println (str (handoff-lib/mailbox-dir (handoff-lib/load-role-info \"coder\" \"$ROOT\") :new)))
")"
mkdir -p "$CODER_NEW_DIR"
printf 'from: coordinator\nto: coder\ntype: note\nmessage: Work BL-9101-demo: read file in backlog/active\ncreated_at: %s\n\nbody\n' \
  "$LONG_AGO" > "$CODER_NEW_DIR/00_bl9101.handoff"
printf 'id: BL-9101\ntitle: "demo five"\nstatus: todo\nassigned_to: coder\n' \
  > "$ROOT/backlog/active/BL-9101-demo-five.yaml"
CLI_OUT="$(bb "$SCRIPT_DIR/../dispatch_trail_cli.bb" "$ROOT" dispatched BL-9101)"
[[ "$CLI_OUT" == "DISPATCHED" ]] || fail "10: a dispatch still unread in new/ must never read DROPPED; got: $CLI_OUT"
pass "10: a dispatch note still unread past the stall threshold is DISPATCHED, never DROPPED"

echo "ALL PASS"
