#!/usr/bin/env bash
# BL-057: per-recipient inbox delivery must not collide when roles share an
# inbox directory. The daemon delivers a per-recipient COPY of each handoff,
# but before the fix every copy used the ORIGINAL outbox filename; coordinator
# and specifier share the master worktree, so the copies resolved to the same
# path and one silently clobbered/skipped the other.
#
# Covers acceptance scenarios BL-057 per-recipient-delivery-01..04.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"
READY_TASK="$SCRIPT_DIR/../ready_for_next_task.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

# ── fixture: coordinator+specifier share master; coder has its own worktree ──
ROOT="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$ROOT"' EXIT

SOCK="$ROOT/fake.sock"
touch "$SOCK"
mkdir -p "$ROOT/.swarmforge"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

CODER_WT="$ROOT/.worktrees/coder"
printf 'coordinator\tmaster\t%s\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n' "$ROOT" \
  > "$ROOT/.swarmforge/roles.tsv"
printf 'specifier\tmaster\t%s\tswarmforge-specifier\tSpecifier\tclaude\ttask\n' "$ROOT" \
  >> "$ROOT/.swarmforge/roles.tsv"
printf 'coder\tcoder\t%s\tswarmforge-coder\tCoder\tclaude\ttask\n' "$CODER_WT" \
  >> "$ROOT/.swarmforge/roles.tsv"

CODER_OUTBOX="$CODER_WT/.swarmforge/handoffs/outbox"
SHARED_INBOX_NEW="$ROOT/.swarmforge/handoffs/inbox/new"
CODER_INBOX_NEW="$CODER_WT/.swarmforge/handoffs/inbox/new"
mkdir -p "$CODER_OUTBOX"

outbox_handoff() {
  local name="$1" to="$2" priority="$3" note="$4"
  printf 'id: %s\nfrom: coder\nto: %s\npriority: %s\ntype: note\nmessage: %s\ncreated_at: 2026-07-01T00:00:00Z\n\n%s\n' \
    "$name" "$to" "$priority" "$note" "$note" > "$CODER_OUTBOX/$name.handoff"
}

# 01/02: a broadcast to both shared-inbox roles
outbox_handoff "00_20260701T000001Z_000001_from_coder_to_coordinator_specifier" \
  "coordinator,specifier" "00" "broadcast-to-both"
# 03: single-recipient control (delivered back to the coder itself)
outbox_handoff "50_20260701T000002Z_000002_from_coder_to_coder" \
  "coder" "50" "single-recipient"
# 04: ordering — a LOW-priority item queued for the coordinator; the priority-00
# broadcast copy above must still be dequeued before it
outbox_handoff "70_20260701T000003Z_000003_from_coder_to_coordinator" \
  "coordinator" "70" "low-priority-later"

# ── fake tmux so notify! succeeds without a real session ─────────────────────
FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
NOTIFY_LOG="$ROOT/tmux-calls.log"
export NOTIFY_LOG
cat > "$FAKE_BIN/tmux" <<'TMUX'
#!/usr/bin/env bash
echo "$*" >> "$NOTIFY_LOG"
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

# ── run the daemon until the outbox drains, then stop it ─────────────────────
PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT" &
DAEMON_PID=$!

for _ in $(seq 1 40); do
  remaining="$(find "$CODER_OUTBOX" -maxdepth 1 -name '*.handoff' | wc -l | tr -d ' ')"
  [[ "$remaining" == "0" ]] && break
  sleep 0.25
done
mkdir -p "$ROOT/.swarmforge/daemon"
touch "$ROOT/.swarmforge/daemon/stop"
wait "$DAEMON_PID" 2>/dev/null || true
[[ "$remaining" == "0" ]] || fail "daemon did not drain the outbox (remaining: $remaining)"

# ── 01: two distinct, unclobbered copies in the shared inbox ─────────────────
BROADCAST_COPIES="$(grep -l "broadcast-to-both" "$SHARED_INBOX_NEW"/*.handoff | wc -l | tr -d ' ')"
[[ "$BROADCAST_COPIES" == "2" ]] \
  || fail "01: expected 2 broadcast copies in the shared inbox, found $BROADCAST_COPIES"
grep -q "^recipient: coordinator$" "$SHARED_INBOX_NEW"/*.handoff \
  || fail "01: no delivered copy carries recipient: coordinator"
grep -q "^recipient: specifier$" "$SHARED_INBOX_NEW"/*.handoff \
  || fail "01: no delivered copy carries recipient: specifier"
pass "01: broadcast to shared-inbox roles leaves one unclobbered copy per recipient"

# ── 02 + 04: each role dequeues its own copy, in priority order ──────────────
OUT="$(cd "$ROOT" && SWARMFORGE_ROLE=coordinator bb "$READY_TASK")"
grep -q "broadcast-to-both" <<< "$OUT" \
  || fail "02/04: coordinator did not dequeue its priority-00 broadcast copy first; got: $OUT"
OUT="$(cd "$ROOT" && SWARMFORGE_ROLE=specifier bb "$READY_TASK")"
grep -q "broadcast-to-both" <<< "$OUT" \
  || fail "02: specifier did not dequeue its own broadcast copy; got: $OUT"
pass "02: coordinator and specifier each dequeue their own copy"
pass "04: priority-00 copy dequeued ahead of the priority-70 item"

# ── 03: single-recipient delivery unchanged ──────────────────────────────────
SINGLE_COPIES="$(find "$CODER_INBOX_NEW" -maxdepth 1 -name '*.handoff' | wc -l | tr -d ' ')"
[[ "$SINGLE_COPIES" == "1" ]] \
  || fail "03: expected exactly 1 copy for a single-recipient handoff, found $SINGLE_COPIES"
grep -q "^recipient: coder$" "$CODER_INBOX_NEW"/*.handoff \
  || fail "03: single-recipient copy missing its recipient header"
pass "03: single-recipient delivery still yields exactly one copy"

echo "ALL PASS"
