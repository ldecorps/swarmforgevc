#!/usr/bin/env bash
# Soft shift-close: wait_in_flight_drain.sh reports drained when only inbox/new
# remains, and forced when in_process outruns the timeout.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DRAIN="$ROOT/swarmforge/scripts/wait_in_flight_drain.sh"
PASS=0
fail() { echo "FAIL: $*"; exit 1; }
pass() { echo "PASS: $*"; PASS=$((PASS + 1)); }

FIX="$(mktemp -d "${TMPDIR:-/tmp}/wait-in-flight-drain.XXXXXX")"
cleanup() { rm -rf "$FIX"; }
trap cleanup EXIT

mkdir -p "$FIX/.swarmforge/handoffs/inbox/new" \
         "$FIX/.swarmforge/handoffs/inbox/in_process" \
         "$FIX/extension/out/tools" \
         "$FIX/extension/out/watchdog" \
         "$FIX/extension/out/swarm" \
         "$FIX/.swarmforge/operator"

# Point the drain helper at the real compiled modules via a thin project that
# copies roles.tsv + mailboxes but resolves require() under FIX by symlinking out/.
ln -s "$ROOT/extension/out/tools/telegramPipelineDrain.js" "$FIX/extension/out/tools/telegramPipelineDrain.js"
# telegramPipelineDrain requires siblings relative to its real path once node
# resolves the symlink target — keep a real copy of the compiled tree entry
# by using NODE_PATH instead.
rm -f "$FIX/extension/out/tools/telegramPipelineDrain.js"
# Simpler: run against ROOT with a swapped roles.tsv in a sub-fixture is hard
# because resolveLiveRoles reads ROOT/.swarmforge/roles.tsv. Build a self-
# contained FIX that has the compiled JS copied with rewritten... too heavy.
# Instead invoke the pure predicate via node against FIX with roles + mailboxes,
# and drive the shell wrapper with SWARMFORGE_* + a stub helper.

# Unit-style: exercise isInFlightEmpty on FIX through the compiled module by
# temporarily writing FIX's roles and calling node -e (same predicate the
# wrapper uses).
printf 'coder\tcoder\t%s\t_\tcoder\tclaude\n' "$FIX" >"$FIX/.swarmforge/roles.tsv"
# Copy compiled drain module tree into FIX so require(path.join(FIX,...)) works:
cp -a "$ROOT/extension/out/." "$FIX/extension/out/"

node -e "
const d=require(process.argv[1]+'/extension/out/tools/telegramPipelineDrain');
const fs=require('fs'); const path=require('path');
const root=process.argv[1];
fs.writeFileSync(path.join(root,'.swarmforge/handoffs/inbox/new/BL-1.handoff'),'type: note\nto: coder\npriority: 50\n\nhi\n');
if (!d.isInFlightEmpty(root)) process.exit(2);
if (d.isPipelineEmpty(root)) process.exit(3);
fs.writeFileSync(path.join(root,'.swarmforge/handoffs/inbox/in_process/BL-1.handoff'),'type: note\nto: coder\npriority: 50\n\nhi\n');
if (d.isInFlightEmpty(root)) process.exit(4);
" "$FIX" || fail "isInFlightEmpty predicate fixtures"
pass "isInFlightEmpty true with only new/; false with in_process"

# Shell wrapper: empty in_process -> drained immediately
rm -f "$FIX/.swarmforge/handoffs/inbox/in_process/"*.handoff
export WAIT_IN_FLIGHT_DRAIN_LOG="$FIX/drain.log"
export SWARMFORGE_SHIFT_CLOSE_DRAIN_TIMEOUT_MS=5000
export SWARMFORGE_SHIFT_CLOSE_DRAIN_POLL_MS=200
out="$(bash "$DRAIN" "$FIX")"
[[ "$out" == "drained" ]] || fail "expected drained, got '$out'"
pass "wait_in_flight_drain.sh prints drained when in_process empty"

# Shell wrapper: stuck in_process -> forced at timeout
printf 'type: note\nto: coder\npriority: 50\n\nstuck\n' \
  >"$FIX/.swarmforge/handoffs/inbox/in_process/BL-stuck.handoff"
export SWARMFORGE_SHIFT_CLOSE_DRAIN_TIMEOUT_MS=800
out="$(bash "$DRAIN" "$FIX")"
[[ "$out" == "forced" ]] || fail "expected forced, got '$out'"
pass "wait_in_flight_drain.sh prints forced when in_process outruns timeout"

echo "OK $PASS checks"
