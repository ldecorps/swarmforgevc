#!/usr/bin/env bash
# BL-617: while ANY pause is active (human-applied or the nightly cooldown -
# both converge on the same .swarmforge/operator/control-pause.json, so ONE
# gate covers both, per backlog_depth_lib.bb's read-pause-state/pause-active?),
# handoffd.bb's outbound-wake sweeps are frozen: no inbox delivery (poll-once!'s
# deliver! loop), no chase nudges (chase-sweep!), no dispatch-gap/unassigned-
# active/open-slot nudges. Enqueue always succeeds (a parcel written to
# outbox/ stays there, untouched); nothing is ever killed. The pause clears
# and normal delivery/chase resumes within one sweep cadence.
#
# Covers acceptance scenarios BL-617 delivery-frozen-not-killed-11 and
# chase-nudges-suppressed-12. This is a wiring smoke test - the underlying
# chase decision logic is exhaustively covered by test_chase_sweep.sh and
# test_handoffd_chase_sweep_wiring.sh; this test only proves the PAUSE gate
# itself actually suppresses the real daemon's delivery + chase sweeps, and
# that both resume once the pause clears.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
export SWARMFORGE_ALLOW_TMP_DAEMON=1  # BL-406: opt in - this ROOT is an intentional throwaway test root
DAEMON_PID=""
cleanup() {
  if [[ -n "$DAEMON_PID" ]]; then
    mkdir -p "$ROOT/.swarmforge/daemon" 2>/dev/null || true
    touch "$ROOT/.swarmforge/daemon/stop" 2>/dev/null || true
    wait "$DAEMON_PID" 2>/dev/null || true
    kill "$DAEMON_PID" 2>/dev/null || true
  fi
  rm -rf "$ROOT"
}
trap cleanup EXIT

TODAY_DAY_KEY="$(date -u +%Y-%m-%d)"

SOCK="$ROOT/fake.sock"
touch "$SOCK"
# Both roles are worktree-name "master" sharing this one physical checkout,
# so handoff_lib.bb's mailbox-base-dir gives each its OWN <role>/ subdir
# under .swarmforge/handoffs/ (mailbox-base-dir: "the <role> subdirectory
# only for master-resident roles, since only they share one physical
# checkout") - never the flat top-level layout a dedicated-worktree role
# uses.
mkdir -p "$ROOT/.swarmforge" "$ROOT/.swarmforge/handoffs/coder/inbox/new" \
  "$ROOT/.swarmforge/handoffs/specifier/outbox" "$ROOT/docs/briefings" \
  "$ROOT/backlog/active" "$ROOT/backlog/paused" "$ROOT/backlog/done" \
  "$ROOT/.swarmforge/operator"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

# Two roles sharing this one physical checkout (both "master"), so a plain
# outbox->inbox delivery between them needs no separate worktree dirs.
cat > "$ROOT/.swarmforge/roles.tsv" <<TSV
specifier	master	$ROOT	swarmforge-specifier	Specifier	claude	task
coder	master	$ROOT	swarmforge-coder	Coder	claude	task
TSV

# Neutralize the unrelated briefing-generation sweep.
printf 'Headline: unrelated\n' > "$ROOT/docs/briefings/${TODAY_DAY_KEY}.md"

# Stub the pause-auto-resume/cooldown CLIs as clean no-ops - this test drives
# the pause marker directly, it is not exercising either sweep's own decision.
mkdir -p "$ROOT/extension/out/tools"
cat > "$ROOT/extension/out/tools/resume-expired-pauses.js" <<'EOF'
console.log(JSON.stringify({ resumed: false, reason: 'not-due' }));
EOF
cat > "$ROOT/extension/out/tools/apply-cooldown-pause.js" <<'EOF'
console.log(JSON.stringify({ decision: 'none' }));
EOF

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
TMUX_LOG="$ROOT/tmux-calls.log"
export TMUX_LOG
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$TMUX_LOG"
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

# ── an aged, already-delivered note in coder's inbox - old enough to clear
# chaseTimeoutSeconds against real wall-clock time, so an unpaused daemon
# would definitely chase it ──────────────────────────────────────────────
CODER_INBOX_NEW="$ROOT/.swarmforge/handoffs/coder/inbox/new"
STUCK_FILE="$CODER_INBOX_NEW/00_20260701T000000Z_000001_from_specifier_to_coder.handoff"
printf 'id: t\nfrom: specifier\nto: coder\npriority: 00\ntype: note\nmessage: hi\ncreated_at: 2026-07-01T00:00:00Z\n\nhi\n' \
  > "$STUCK_FILE"
python3 -c "import os,time; os.utime('$STUCK_FILE', (time.time()-45, time.time()-45))" 2>/dev/null \
  || python3 -c "import os,time; os.utime('$STUCK_FILE', (__import__('time').time()-45, __import__('time').time()-45))"

# ── a fresh parcel sitting in specifier's OUTBOX, ready for delivery to
# coder - proves the DELIVERY freeze (scenario 11), distinct from the
# already-delivered stuck note above (which proves the CHASE freeze,
# scenario 12) ────────────────────────────────────────────────────────────
SPECIFIER_OUTBOX="$ROOT/.swarmforge/handoffs/specifier/outbox"
mkdir -p "$SPECIFIER_OUTBOX"
OUTBOX_FILE="$SPECIFIER_OUTBOX/00_20260724T190000Z_000002_from_specifier_to_coder.handoff"
printf 'id: p1\nfrom: specifier\nto: coder\npriority: 50\ntype: note\nmessage: fresh parcel\ncreated_at: 2026-07-24T19:00:00Z\n\nfresh parcel\n' \
  > "$OUTBOX_FILE"

# ── the pause marker - active, no timer, exactly the shape either a human
# pause or a cooldown-applied pause writes ───────────────────────────────
cat > "$ROOT/.swarmforge/operator/control-pause.json" <<'EOF'
{"active":true}
EOF

PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" &
DAEMON_PID=$!

# Let several poll cycles (1s each) and at least one chase-cadence tick
# (10 cycles) pass while the pause stays active.
sleep 12

CODER_NEW_COUNT_PAUSED="$(find "$CODER_INBOX_NEW" -maxdepth 1 -name '*.handoff' | wc -l)"
[[ "$CODER_NEW_COUNT_PAUSED" -eq 1 ]] \
  || fail "delivery-frozen-11: expected coder's inbox/new to still hold only the pre-existing stuck note while paused, found $CODER_NEW_COUNT_PAUSED"
[[ -f "$OUTBOX_FILE" ]] \
  || fail "delivery-frozen-11: expected the outbox parcel to remain un-delivered (still in outbox/) while paused"
pass "delivery-frozen-not-killed-11: a fresh parcel is accepted into the outbound queue but not delivered while the pause is active"

grep -q "send-keys" "$TMUX_LOG" 2>/dev/null \
  && fail "chase-nudges-suppressed-12: expected NO wake (send-keys) while paused, got: $(cat "$TMUX_LOG")"
pass "chase-nudges-suppressed-12: no chase nudge or wake is sent while the pause is active"

[[ -f "$STUCK_FILE.chase.json" ]] \
  && fail "chase-nudges-suppressed-12: expected chase-sweep! never to have run at all while paused (chase sidecar should not exist)"
pass "chase-nudges-suppressed-12: chase-sweep! itself never ran while the pause is active (not merely a suppressed wake)"

grep -q "poll-skip-paused" "$ROOT/.swarmforge/daemon/handoffd.log" \
  || fail "expected the daemon to log poll-skip-paused while frozen; log: $(cat "$ROOT/.swarmforge/daemon/handoffd.log" 2>/dev/null)"
pass "the daemon logs its own delivery-freeze decision, not a silent skip"

# ── the pane itself is never touched - only wakes (send-keys) are gated,
# never a kill/terminate of any kind ─────────────────────────────────────
grep -qi "kill" "$TMUX_LOG" 2>/dev/null \
  && fail "no agent pane is killed by the cooldown: unexpected kill-* tmux call, got: $(cat "$TMUX_LOG")"
pass "no agent pane is killed by the cooldown"

# ── clear the pause - both delivery and chase resume within one cadence ──
cat > "$ROOT/.swarmforge/operator/control-pause.json" <<'EOF'
{"active":false}
EOF

for _ in $(seq 1 120); do
  [[ ! -f "$OUTBOX_FILE" ]] && break
  sleep 0.5
done

mkdir -p "$ROOT/.swarmforge/daemon"
touch "$ROOT/.swarmforge/daemon/stop"
wait "$DAEMON_PID" 2>/dev/null || true
DAEMON_PID=""

[[ -f "$OUTBOX_FILE" ]] \
  && fail "expected the parcel to be delivered within one sweep cadence once the pause cleared"
DELIVERED="$(find "$CODER_INBOX_NEW" -maxdepth 1 -name '*from_specifier_to_coder.handoff' | wc -l)"
[[ "$DELIVERED" -ge 1 ]] \
  || fail "expected the parcel to land in coder's inbox/new once the pause cleared"
pass "the parcel is delivered within one sweep cadence once the pause clears"

grep -q "send-keys" "$TMUX_LOG" \
  || fail "expected the stale stuck note to be chased normally again once the pause cleared"
pass "the stale parcel is chased normally again once the pause clears"

echo "ALL PASS"
