#!/usr/bin/env bash
# BL-356: handoffd.bb's consolidated poll loop now also sweeps for unpushed
# work on local `main`, sharing the same cadence as every other *-sweep!
# above it. The DECISION/STATE logic itself (ahead/behind classification,
# bounded push-retry backoff, delivery-based alarm arming) is exhaustively
# covered by push_sweep_lib_test_runner.bb (pure unit tests) and the
# BL-356 acceptance suite (push_sweep_cli.bb, forced results, no real git/
# network); this test only proves the real daemon reaches and fires
# push-sweep! against a REAL git repo and a REAL local remote, on its own
# cadence, each poll cycle - same "one real wiring proof, not re-run per
# scenario" posture as test_handoffd_resource_sample_wiring.sh.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

ROOT="$(cd "$(mktemp -d)" && pwd -P)"
REMOTE="$(cd "$(mktemp -d)" && pwd -P)"
DAEMON_PID=""
cleanup() {
  if [[ -n "$DAEMON_PID" ]]; then
    mkdir -p "$ROOT/.swarmforge/daemon" 2>/dev/null || true
    touch "$ROOT/.swarmforge/daemon/stop" 2>/dev/null || true
    wait "$DAEMON_PID" 2>/dev/null || true
    kill "$DAEMON_PID" 2>/dev/null || true
  fi
  rm -rf "$ROOT" "$REMOTE"
}
trap cleanup EXIT

TODAY_DAY_KEY="$(date -u +%Y-%m-%d)"

# ── a real bare remote, and a real project-root with one unpushed commit ──
git init --quiet --bare "$REMOTE"

git init --quiet "$ROOT"
git -C "$ROOT" config user.email "test@example.com"
git -C "$ROOT" config user.name "Test"
git -C "$ROOT" checkout -q -b main
echo "first" > "$ROOT/seed.txt" && git -C "$ROOT" add seed.txt && git -C "$ROOT" commit -q -m "seed commit"
git -C "$ROOT" remote add origin "$REMOTE"
git -C "$ROOT" push -q origin main
# One unpublished commit - this is what push-sweep! must reach origin.
echo "second" > "$ROOT/seed.txt" && git -C "$ROOT" add seed.txt && git -C "$ROOT" commit -q -m "unpushed commit"

SOCK="$ROOT/fake.sock"
touch "$SOCK"

mkdir -p "$ROOT/.swarmforge" "$ROOT/.swarmforge/handoffs/inbox/new" "$ROOT/docs/briefings" \
  "$ROOT/backlog/active" "$ROOT/backlog/paused" "$ROOT/backlog/done" \
  "$ROOT/.swarmforge/handoffs/coordinator/inbox/new" \
  "$ROOT/.swarmforge/handoffs/coordinator/inbox/in_process" \
  "$ROOT/.swarmforge/handoffs/coordinator/inbox/completed"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

cat > "$ROOT/.swarmforge/roles.tsv" <<TSV
coordinator	master	$ROOT	swarmforge-coordinator	Coordinator	claude	task
TSV

# Neutralize the unrelated briefing-generation sweep (already-generated
# today means morning-trigger-due? is false) - same technique
# test_handoffd_resource_sample_wiring.sh already uses.
printf 'Headline: unrelated\n' > "$ROOT/docs/briefings/${TODAY_DAY_KEY}.md"

FAKE_BIN="$ROOT/bin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/tmux" <<TMUX
#!/usr/bin/env bash
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

LOG_FILE="$ROOT/.swarmforge/daemon/handoffd.log"
env -u TELEGRAM_BOT_TOKEN -u TELEGRAM_CHAT_ID -u RESEND_API_KEY \
  PATH="$FAKE_BIN:$PATH" setsid bb "$HANDOFFD" "$ROOT" &
DAEMON_PID=$!

wait_for_log() {
  local pattern="$1" timeout_s="$2" waited=0
  while (( waited < timeout_s * 4 )); do
    [[ -f "$LOG_FILE" ]] && grep -q "$pattern" "$LOG_FILE" 2>/dev/null && return 0
    sleep 0.25
    waited=$((waited + 1))
  done
  return 1
}

wait_for_log "push-sweep pushed" 30 \
  || fail "the push sweep never logged a successful push within 30s; log: $(cat "$LOG_FILE" 2>/dev/null)"

# ── origin actually received the unpushed commit (real git, real remote) ──
LOCAL_HEAD="$(git -C "$ROOT" rev-parse main)"
REMOTE_HEAD="$(git -C "$REMOTE" rev-parse main)"
[[ "$LOCAL_HEAD" == "$REMOTE_HEAD" ]] \
  || fail "expected origin's main to match local main after the sweep, got local=$LOCAL_HEAD remote=$REMOTE_HEAD"
pass "push-sweep! shells to real git and lands local main's unpushed commit on origin"

# ── the sweep never threw ──────────────────────────────────────────────────
grep -q "push-sweep-error" "$LOG_FILE" && fail "the push sweep threw an exception; got: $(cat "$LOG_FILE")"
pass "the push sweep ran without throwing"

# ── an already-published main stays quiet on a later cycle ────────────────
sleep 6
UP_TO_DATE_COUNT="$(grep -c "push-sweep up-to-date" "$LOG_FILE" || true)"
[[ "$UP_TO_DATE_COUNT" -ge 1 ]] || fail "expected a later sweep to report up-to-date once published, got: $(cat "$LOG_FILE")"
pass "a later sweep sees the published state and pushes nothing further"

echo "ALL PASS"
