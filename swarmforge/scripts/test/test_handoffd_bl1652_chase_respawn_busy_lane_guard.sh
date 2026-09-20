#!/usr/bin/env bash
# BL-1652: the chase sweep never respawns a role whose own pane shows the
# busy footer or whose worktree runs a verification lane, respawns a role
# at most once per sweep however many stuck inbox items it holds, and logs
# every real respawn with the readings it was decided on.
#
# This is the "handoffd chase wiring shell test" the ticket's own "How"
# section calls for - it drives the REAL handoffd.bb daemon (not just
# chase_sweep_lib.bb's pure decision layer, already exhaustively covered by
# test_chase_sweep.sh) via its own `--chase-sweep-once` one-shot mode
# (a real fixture root, a fake-but-real tmux binary and, for the lane
# scenario, a REAL background process scoped to the role's own worktree),
# proving the process-table integration (handoffd.bb's lane-running-under-
# worktree?/chase-target-busy?) end to end, never a second reimplementation
# of chase_sweep_lib.bb's own decision.

set -euo pipefail

# do-respawn! forwards a real OPENROUTER_API_KEY into its tmux respawn-pane
# call when one is set in the daemon's own environment (openrouter-respawn-
# env-args) - this test never authenticates a real agent, so keep any real
# credential in the ambient dev environment out of this test's tmux-calls.log.
unset OPENROUTER_API_KEY CLAUDE_CODE_MAX_OUTPUT_TOKENS 2>/dev/null || true

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1  # BL-406: opt in - this ROOT is an intentional throwaway test root
LANE_PID=""
cleanup() {
  [[ -n "$LANE_PID" ]] && kill "$LANE_PID" 2>/dev/null || true
  rm -rf "$ROOT"
}
trap cleanup EXIT

# BL-128: mailbox-base-dir resolves a non-master role's mailbox under ITS
# OWN worktree-path, never the daemon's project-root - the inbox fixtures
# below live under $WT_QA, not $ROOT, exactly as a real QA worktree would.
WT_QA="$ROOT/wt-qa"
INBOX_NEW="$WT_QA/.swarmforge/handoffs/inbox/new"
mkdir -p "$INBOX_NEW"

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge" "$ROOT/.swarmforge/heartbeat" "$ROOT/.swarmforge/daemon"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"
printf 'QA\tqa\t%s\tswarmforge-qa\tQA\tclaude\ttask\n' "$WT_QA" > "$ROOT/.swarmforge/roles.tsv"

write_stuck_items() {
  # Five items, already exhausted (chaseCount at the ceiling) and old enough
  # to clear chaseTimeoutSeconds (30s) against real wall-clock time.
  rm -f "$INBOX_NEW"/*.handoff "$INBOX_NEW"/*.chase.json
  for i in 1 2 3 4 5; do
    local f="$INBOX_NEW/0${i}_item.handoff"
    printf 'id: t\nfrom: specifier\nto: QA\npriority: 00\ntype: note\nmessage: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n' > "$f"
    python3 -c "import os,time; os.utime('$f', (time.time()-45, time.time()-45))"
    python3 -c "import json; json.dump({'chaseCount': 3}, open('$f.chase.json','w'))"
  done
}

# A stale heartbeat, 10 minutes old, non-in-flight, with THIS SCRIPT's own
# pid (alive throughout the daemon's run) - liveness classifies "dead" via
# the stale-heartbeat path, matching the 2026-09-19 incident narrative
# (BL-1652 ticket) exactly, never via a missing/dead pid.
write_stale_heartbeat() {
  local ten_min_ago
  ten_min_ago="$(python3 -c "import datetime;print((datetime.datetime.now(datetime.UTC)-datetime.timedelta(minutes=10)).strftime('%Y-%m-%dT%H:%M:%SZ'))")"
  printf 'last_beat: "%s"\nin_flight: false\npid: %s\n' "$ten_min_ago" "$$" > "$ROOT/.swarmforge/heartbeat/QA.yaml"
}

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
TMUX_LOG="$ROOT/tmux-calls.log"
export TMUX_LOG
PANE_BUSY_FLAG="$ROOT/pane-busy-flag"
export PANE_BUSY_FLAG
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$TMUX_LOG"
for a in "$@"; do
  if [[ "$a" == "capture-pane" ]]; then
    if [[ -f "$PANE_BUSY_FLAG" ]]; then
      printf '$ some prior output\n* Cooking… (12s · esc to interrupt)\n'
    else
      printf '$ \n'
    fi
    exit 0
  fi
done
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

run_chase_sweep_once() {
  rm -f "$ROOT/.swarmforge/daemon/respawn-cooldown.json" "$WT_QA/.swarmforge/handoffs/respawn-cooldown.json"
  > "$TMUX_LOG"
  : > "$ROOT/.swarmforge/daemon/handoffd.log"
  PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" --chase-sweep-once
}

# ── 01: five exhausted items, dead liveness (stale heartbeat), busy footer -
#     zero respawns ──────────────────────────────────────────────────────
write_stuck_items
write_stale_heartbeat
touch "$PANE_BUSY_FLAG"
run_chase_sweep_once

grep -q "respawn-pane" "$TMUX_LOG" && fail "01: a busy-footer role must never be respawned; tmux log: $(cat "$TMUX_LOG")"
grep -q "chase-respawn " "$ROOT/.swarmforge/daemon/handoffd.log" 2>/dev/null && fail "01: expected no chase-respawn log line while the pane is busy"
pass "01 (BL-1652 invariant 1): a busy-footer role holding 5 exhausted items is never respawned"

# ── 02: same five items, footer removed, no lane running - exactly one real
#     respawn (tmux respawn-pane -k), exactly one chase-respawn log line
#     naming every reading ──────────────────────────────────────────────
rm -f "$PANE_BUSY_FLAG"
run_chase_sweep_once

RESPAWN_PANE_CALLS="$(grep -c "respawn-pane" "$TMUX_LOG" || true)"
[[ "$RESPAWN_PANE_CALLS" == "1" ]] || fail "02: expected exactly 1 real tmux respawn-pane call for 5 exhausted items in one sweep, got $RESPAWN_PANE_CALLS; tmux log: $(cat "$TMUX_LOG")"
pass "02 (BL-1652 invariant 2): one sweep issues exactly one real respawn for a role holding 5 exhausted items"

RESPAWN_LOG_LINES="$(grep -c "chase-respawn QA " "$ROOT/.swarmforge/daemon/handoffd.log" || true)"
[[ "$RESPAWN_LOG_LINES" == "1" ]] || fail "02: expected exactly 1 chase-respawn log line, got $RESPAWN_LOG_LINES; log: $(cat "$ROOT/.swarmforge/daemon/handoffd.log")"
grep -E "chase-respawn QA .*item=\S+ liveness=dead heartbeat-age-s=[0-9.]+ activity-age-s=[0-9.eE+-]+ busy=false lane=false" \
  "$ROOT/.swarmforge/daemon/handoffd.log" >/dev/null \
  || fail "02: chase-respawn log line is missing/wrong readings; log: $(cat "$ROOT/.swarmforge/daemon/handoffd.log")"
pass "02 (BL-1652 invariant 3): the one respawn log line names item, liveness, heartbeat age, activity age, busy and lane"

# The four items that did NOT trigger the respawn (indeed, all five - the
# "respawned" action never rewrites a sidecar) keep their chase counts.
for i in 1 2 3 4 5; do
  COUNT="$(python3 -c "import json; print(json.load(open('$INBOX_NEW/0${i}_item.handoff.chase.json'))['chaseCount'])")"
  [[ "$COUNT" == "3" ]] || fail "02 (BL-1652 invariant 2): item 0${i} chaseCount changed after the sweep (got $COUNT)"
done
pass "02 (BL-1652 invariant 2): every item, including the one that triggered the respawn, keeps its chase count unchanged"

# ── 03: footer absent, but a REAL verification-lane process is running with
#     the role's own worktree as its cwd - zero respawns. Fresh items and a
#     fresh heartbeat first - otherwise scenario 02's respawn-cooldown
#     sidecar alone (not the lane guard this scenario means to prove) would
#     suppress the respawn, making the assertion pass for the wrong reason. ─
write_stuck_items
write_stale_heartbeat
(cd "$WT_QA" && exec -a vitest sleep 30) &
LANE_PID=$!
sleep 0.3  # let the renamed process actually start before the sweep reads /proc
run_chase_sweep_once
kill "$LANE_PID" 2>/dev/null || true
LANE_PID=""

grep -q "respawn-pane" "$TMUX_LOG" && fail "03: a role with a running verification lane under its own worktree must never be respawned; tmux log: $(cat "$TMUX_LOG")"
pass "03 (BL-1652 invariant 1): a role with a real verification-lane process running under its own worktree is never respawned"

echo "ALL PASS"
