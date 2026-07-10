#!/usr/bin/env bash
# BL-222: proves the auto-route SEND mechanism end-to-end against the real
# swarm_handoff.bb (the "normal outbound handoff path" the ticket requires,
# not a hand-written inbox file) - mirrors exactly what handoffd.bb's
# auto-route! does: construct the draft via chase_sweep_lib.bb's
# dispatch-gap-draft-lines, then shell out via the SAME vector-form
# process/sh call (cmd as a vector, options as a trailing map) confirmed
# empirically to be the only form that actually applies :dir/:env
# overrides - the varargs form silently drops them, which would have sent
# the auto-route note "from" whatever role happened to be ambient instead
# of the coordinator.
#
# Delivery-to-inbox itself (the tmux-dependent half of swarm_handoff.bb) is
# already covered by that script's own test suite
# (test_swarm_handoff_sync_deliver.sh etc.); this file scopes to what BL-222
# adds: the auto-route note is correctly attributed to the coordinator, and
# a still-queued (undelivered) auto-route note is enough to satisfy the
# idempotency guard on the next sweep.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHASE_SWEEP_LIB="$SCRIPT_DIR/../chase_sweep_lib.bb"
SWARM_HANDOFF="$SCRIPT_DIR/../swarm_handoff.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

git -C "$ROOT" init -q
git -C "$ROOT" -c user.email=test@test -c user.name=test commit -q --allow-empty -m init

mkdir -p "$ROOT/.swarmforge"
ROLES="coordinator\tmaster\t$ROOT\tswarmforge-coordinator\tCoordinator\tclaude\ttask
coder\tcoder\t$ROOT\tswarmforge-coder\tCoder\tclaude\ttask
"
printf "$ROLES" > "$ROOT/.swarmforge/roles.tsv"

mkdir -p "$ROOT/backlog/active"
printf 'id: BL-217\ntitle: "demo"\nstatus: todo\nassigned_to: coder\n' > "$ROOT/backlog/active/BL-217-demo.yaml"

CODER_NEW="$ROOT/.swarmforge/handoffs/inbox/new"
COORDINATOR_OUTBOX="$ROOT/.swarmforge/handoffs/coordinator/outbox"

# ── 1: dispatch-gap-items detects the gap before any dispatch exists ───────
bb -e "
(load-file \"$CHASE_SWEEP_LIB\")
(let [gaps (chase-sweep-lib/dispatch-gap-items \"$ROOT/backlog/active\" [\"$CODER_NEW\" \"$COORDINATOR_OUTBOX\"])]
  (assert (= [{:id \"BL-217\" :assigned-to \"coder\"}] gaps) (str \"unexpected gaps: \" (pr-str gaps))))
" || fail "01: expected dispatch-gap-items to detect BL-217 as an undispatched gap"
pass "01: dispatch-gap-items detects the undispatched active item"

# ── 2: auto-route! mirrors exactly - construct the draft via
#       dispatch-gap-draft-lines, shell to the real swarm_handoff.bb with
#       SWARMFORGE_ROLE=coordinator via the vector process/sh form ────────
OUT="$(bb -e "
(require '[babashka.fs :as fs] '[babashka.process :as process])
(load-file \"$CHASE_SWEEP_LIB\")
(let [draft (fs/path \"$ROOT\" \"dispatch-gap-draft.txt\")]
  (spit (str draft) (str (clojure.string/join \"\n\" (chase-sweep-lib/dispatch-gap-draft-lines {:id \"BL-217\" :assigned-to \"coder\"})) \"\n\"))
  (let [env (merge (into {} (System/getenv)) {\"SWARMFORGE_ROLE\" \"coordinator\" \"SWARMFORGE_SKIP_SYNC_INJECT\" \"1\"})
        result (process/sh [\"bb\" \"$SWARM_HANDOFF\" (str draft)] {:dir \"$ROOT\" :env env})]
    (println \"EXIT:\" (:exit result))
    (println \"OUT:\" (:out result))
    (println \"ERR:\" (:err result))))
")"
grep -q "^EXIT: 0" <<< "$OUT" || fail "02: expected the auto-route send to exit 0; got: $OUT"
grep -qi "HANDOFF QUEUED" <<< "$OUT" || fail "02: expected the handoff to be queued (daemon backup delivers); got: $OUT"
pass "02: auto-route!'s exact mechanism (dispatch-gap-draft-lines + vector-form process/sh) sends successfully"

# ── 3: the queued file is correctly attributed to the coordinator (proves
#       the :env override actually took effect - the risk this whole test
#       exists to guard against) ────────────────────────────────────────────
QUEUED_FILE="$(find "$COORDINATOR_OUTBOX" -name '*.handoff' | head -1)"
[[ -n "$QUEUED_FILE" ]] || fail "03: expected a queued handoff file in the coordinator's own outbox"
grep -q "^from: coordinator$" "$QUEUED_FILE" || fail "03: expected from: coordinator (env override), got: $(cat "$QUEUED_FILE")"
grep -q "^to: coder$" "$QUEUED_FILE" || fail "03: expected to: coder, got: $(cat "$QUEUED_FILE")"
grep -q "^message: BL-217 is active with no dispatch" "$QUEUED_FILE" || fail "03: expected the dispatch-gap message, got: $(cat "$QUEUED_FILE")"
pass "03: the queued note is correctly attributed to the coordinator and addressed to the assignee"

# ── 4: a second dispatch-gap-items pass (scanning the coordinator's own
#       outbox too) no longer flags the item - idempotent even before real
#       delivery completes (a route already in flight must not double-send) ─
bb -e "
(load-file \"$CHASE_SWEEP_LIB\")
(let [gaps (chase-sweep-lib/dispatch-gap-items \"$ROOT/backlog/active\" [\"$CODER_NEW\" \"$COORDINATOR_OUTBOX\"])]
  (assert (empty? gaps) (str \"expected no gaps once the auto-route note is queued, got: \" (pr-str gaps))))
" || fail "04: expected the second sweep not to re-detect a gap while the route is in flight"
pass "04: a still-in-flight (queued but undelivered) auto-route note satisfies the idempotency guard"

echo "ALL PASS"
