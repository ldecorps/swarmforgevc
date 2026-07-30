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
export SWARMFORGE_ALLOW_TMP_DAEMON=1  # BL-406: opt in - this ROOT is an intentional throwaway test root
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
# BL-630: push-sweep now refuses to publish a tip that is not a
# swarmforge-QA ancestor - this fixture's unpushed commit represents
# QA-approved work reaching origin, so swarmforge-QA points at the same
# tip (a commit is trivially its own ancestor).
git -C "$ROOT" branch swarmforge-QA main

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
# push-sweep! only runs every chase-sweep-every-cycles (10) poll cycles
# (~10s at poll-ms=1000) - a blind `sleep 6` here can land before the next
# tick ever fires (confirmed: this raced on a plain, unmodified main
# checkout too - a pre-existing flake, not introduced by BL-630). Poll for
# the log line instead of guessing a fixed sleep.
wait_for_log "push-sweep up-to-date" 15 \
  || fail "expected a later sweep to report up-to-date once published, got: $(cat "$LOG_FILE")"
pass "a later sweep sees the published state and pushes nothing further"

# ── BL-630: a commit that is not a swarmforge-QA ancestor is never
#    published, proven against the REAL git adapter (push-sweep-qa-gate-
#    facts! in handoffd.bb), not just the forced-result CLI/lib tests ──────
echo "third" > "$ROOT/seed.txt" && git -C "$ROOT" add seed.txt && git -C "$ROOT" commit -q -m "un-QA'd commit"
NON_QA_SHA="$(git -C "$ROOT" rev-parse HEAD)"

wait_for_log "qa-refused" 15 \
  || fail "the push sweep never refused the non-QA-ancestor commit within 15s; log: $(cat "$LOG_FILE" 2>/dev/null)"
grep -q "qa-refused non-qa-ancestor $NON_QA_SHA" "$LOG_FILE" \
  || fail "expected the refusal to name $NON_QA_SHA, got: $(cat "$LOG_FILE")"
pass "push-sweep! refuses a real commit that is not a swarmforge-QA ancestor, naming its sha"

REMOTE_HEAD_AFTER="$(git -C "$REMOTE" rev-parse main)"
[[ "$REMOTE_HEAD_AFTER" != "$NON_QA_SHA" ]] \
  || fail "the non-QA-ancestor commit must never reach origin, but origin/main is now $REMOTE_HEAD_AFTER"
[[ "$REMOTE_HEAD_AFTER" == "$LOCAL_HEAD" ]] \
  || fail "expected origin/main to stay at the earlier QA-approved tip $LOCAL_HEAD, got $REMOTE_HEAD_AFTER"
pass "origin/main stays at the last QA-approved tip, never advancing to the refused commit"

echo "ALL PASS"
