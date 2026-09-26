#!/usr/bin/env bash
# BL-1711 hardening (2026-09-25): the acceptance feature and the property
# test both drive ollama_ancillary_restart_cli.sh directly, never
# handoffd.bb's own ollama-crash-restart-sweep!/send-ollama-restart-alert!
# functions or the run-sweep! "ollama-crash-restart-sweep" wiring line that
# reaches them each cycle - exactly the class of gap BL-1698's own D7 QA
# bounce was about ("the changed production path ... has a test that fails
# when the line is removed / observed: deleting it leaves every suite
# green"). Boots the REAL daemon (same technique as
# test_handoffd_dead_letter_notify_wiring.sh) against a throwaway root
# whose ollama record already names a dead pid and a silent endpoint, with
# a fast-answering stand-in binary so a real end-to-end restart completes
# in seconds, and proves: the sweep reaches the real restart CLI on its
# own cadence, the restart actually happens (a new pid, endpoint answers
# again, record updated), and send-ollama-restart-alert! fires - a real
# Telegram outbox line - never a real network send.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HANDOFFD="$SCRIPT_DIR/../handoffd.bb"
source "$SCRIPT_DIR/../portable_daemon_spawn_lib.sh"

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
  pkill -9 -f "$ROOT/bin/fake-ollama" 2>/dev/null || true
  rm -rf "$ROOT"
}
trap cleanup EXIT

TODAY_DAY_KEY="$(date -u +%Y-%m-%d)"

SOCK="$ROOT/fake.sock"
touch "$SOCK"

mkdir -p "$ROOT/.swarmforge" "$ROOT/.swarmforge/handoffs/inbox/new" "$ROOT/docs/briefings" \
  "$ROOT/backlog/active" "$ROOT/backlog/paused" "$ROOT/backlog/done" \
  "$ROOT/.swarmforge/handoffs/coordinator/inbox/new" \
  "$ROOT/.swarmforge/handoffs/coordinator/inbox/in_process" \
  "$ROOT/.swarmforge/handoffs/coordinator/inbox/completed" \
  "$ROOT/.swarmforge/operator" "$ROOT/.swarmforge/ollama" "$ROOT/bin"
echo "$SOCK" > "$ROOT/.swarmforge/tmux-socket"

cat > "$ROOT/.swarmforge/roles.tsv" <<TSV
coordinator	master	$ROOT	swarmforge-coordinator	Coordinator	claude	task
TSV

# Neutralize the unrelated briefing-generation sweep (already-generated
# today means morning-trigger-due? is false).
printf 'Headline: unrelated\n' > "$ROOT/docs/briefings/${TODAY_DAY_KEY}.md"

# A fast-answering stand-in ollama binary - opens the recorded port the
# instant it is started, so a real end-to-end restart (start, poll,
# confirm answering, write the record) completes in well under a second.
PORT=$((20000 + (RANDOM % 5000)))
ENDPOINT="http://127.0.0.1:${PORT}/v1"
cat > "$ROOT/bin/fake-ollama" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" = "serve" ]; then
  exec node -e 'require("http").createServer((_q,r)=>{r.end("{}")}).listen(${PORT})'
fi
exit 0
EOF
chmod +x "$ROOT/bin/fake-ollama"

# The crashed record: owner swarm-owned, a pid guaranteed not to be a live
# process (same "dead pid" convention as test_handoffd_supervisor.sh),
# pointed at a port nothing is listening on yet.
cat > "$ROOT/.swarmforge/ollama/serve.json" <<EOF
{
  "owner": "swarm-owned",
  "pid": 999999,
  "startedAt": "2026-09-25T00:00:00Z",
  "endpoint": "${ENDPOINT}"
}
EOF

# swarm.env: the sweep's own swarm-env-value reads SWARMFORGE_OLLAMA_BINARY
# from here, exactly as swarmforge.sh's launch-time config does.
printf 'SWARMFORGE_OLLAMA_BINARY=%s\n' "$ROOT/bin/fake-ollama" > "$ROOT/.swarmforge/swarm.env"

FAKE_BIN="$ROOT/fakebin"
mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/tmux" <<TMUX
#!/usr/bin/env bash
exit 0
TMUX
chmod +x "$FAKE_BIN/tmux"

LOG_FILE="$ROOT/.swarmforge/daemon/handoffd.log"

# Fast confirmation window/poll so a real restart completes within this
# test's own patience - inherited by handoffd's child sh! calls to the
# restart CLI, the same env-propagation ollama_ancillary_restart_cli.sh's
# own test fixtures rely on (babashka.process/sh inherits the parent env
# unless :env is overridden, and this call site passes none).
export OLLAMA_ANCILLARY_CRASH_CONFIRM_SECONDS=1
export OLLAMA_ANCILLARY_RESTART_WINDOW_SECONDS=1800
export OLLAMA_ANCILLARY_RESTART_MAX_IN_WINDOW=3

portable_spawn_daemon_or_fail bb \
  env -u TELEGRAM_BOT_TOKEN -u TELEGRAM_CHAT_ID -u RESEND_API_KEY \
  PATH="$FAKE_BIN:$PATH" bb "$HANDOFFD" "$ROOT"
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

wait_for_log "ollama-restart-alert " 30 \
  || fail "the ollama-crash-restart sweep never logged an alert within 30s; log: $(cat "$LOG_FILE" 2>/dev/null)"
pass "ollama-crash-restart-sweep! reached the real restart CLI and raised an alert"

grep -q "ollama-restart-alert RESTARTED 999999" "$LOG_FILE" \
  || fail "expected a RESTARTED action naming the old (dead) pid 999999, got: $(cat "$LOG_FILE")"
pass "the sweep restarted the crashed server end-to-end through the real daemon loop"

# ── send-ollama-restart-alert! actually wrote the Telegram outbox line ───
OUTBOX="$ROOT/.swarmforge/operator/telegram-reply-outbox.jsonl"
[[ -f "$OUTBOX" ]] || fail "expected send-ollama-restart-alert! to write the telegram-reply-outbox.jsonl file"
grep -q '"threadId":"OPERATOR"' "$OUTBOX" || fail "expected an OPERATOR-thread line in the outbox, got: $(cat "$OUTBOX")"
# BL-1711 QA bounce D2 (2026-09-25): the outbox carries the human-readable
# alert text (ollama-restart-alert-text), never the raw CLI token line -
# "RESTARTED 999999 ..." became "ollama crashed and was restarted: pid
# 999999 -> ...".
grep -q 'ollama crashed and was restarted: pid 999999 ->' "$OUTBOX" \
  || fail "expected the outbox line to name the restart, got: $(cat "$OUTBOX")"
pass "send-ollama-restart-alert! wrote a real Telegram outbox line naming the restart"

# ── the record now names the NEW server, not the dead old one ───────────
NEW_PID="$(sed -n 's/^  "pid": \([0-9]*\),\{0,1\}$/\1/p' "$ROOT/.swarmforge/ollama/serve.json")"
[[ -n "$NEW_PID" && "$NEW_PID" != "999999" ]] \
  || fail "expected the record's pid to have changed from the dead 999999, got record: $(cat "$ROOT/.swarmforge/ollama/serve.json")"
pass "the ollama record was updated to the new server's pid"
kill -9 "$NEW_PID" 2>/dev/null || true

# ── the sweep never threw ──────────────────────────────────────────────────
grep -q "ollama-crash-restart-sweep-error" "$LOG_FILE" && fail "the ollama-crash-restart sweep threw an exception; got: $(cat "$LOG_FILE")"
pass "the ollama-crash-restart sweep ran without throwing"

echo "ALL PASS"
