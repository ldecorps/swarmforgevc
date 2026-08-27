#!/usr/bin/env bash
# Smoke test for operator_telegram.bb, the supervised allowlisted operator
# Telegram console. Uses isolated fixtures and no real Telegram/network calls.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
ROOT_TMP="$SCRIPT_DIR/../../tmp/operator-telegram-tests"
CONSOLE="$SRC/operator_telegram.bb"
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

rm -rf "$ROOT_TMP"
mkdir -p "$ROOT_TMP"
trap 'rm -rf "$ROOT_TMP"' EXIT

make_fixture() {
  local name="$1"
  local d="$ROOT_TMP/$name"
  rm -rf "$d"
  mkdir -p "$d/.swarmforge/operator" "$d/swarmforge/scripts"
  cp "$SRC/operator_telegram.bb" "$SRC/operator_telegram_lib.bb" "$d/swarmforge/scripts/"
  printf '%s' "$d"
}

jget() { bb -e "(require '[cheshire.core :as j]) (println (get (j/parse-string (slurp \"$1\") true) $2))"; }

# ── disabled via skip env ───────────────────────────────────────────────────
F="$(make_fixture skip)"
SWARMFORGE_SKIP_TELEGRAM=1 bb "$F/swarmforge/scripts/operator_telegram.bb" ensure "$F" >/dev/null
check "SKIP_TELEGRAM -> disabled" \
  '[[ "$(jget "$F/.swarmforge/operator/telegram-console.status.json" ":state")" == disabled ]]'
check "SKIP_TELEGRAM starts no poller" '[[ ! -f "$F/.swarmforge/operator/telegram-console.pid" ]]'

# ── disabled via missing token ──────────────────────────────────────────────
F="$(make_fixture missing-token)"
OPERATOR_TELEGRAM_ALLOWED_USER_ID=123 bb "$F/swarmforge/scripts/operator_telegram.bb" ensure "$F" >/dev/null
check "missing token -> disabled" \
  '[[ "$(jget "$F/.swarmforge/operator/telegram-console.status.json" ":state")" == disabled ]]'

# ── live poller launch + idempotent ensure ──────────────────────────────────
F="$(make_fixture launch)"
OPERATOR_TELEGRAM_BOT_TOKEN=TOKEN OPERATOR_TELEGRAM_ALLOWED_USER_ID=123 \
  OPERATOR_TELEGRAM_FAKE_POLL=1 bb "$F/swarmforge/scripts/operator_telegram.bb" ensure "$F" >/dev/null
check "valid config starts poller" '[[ -f "$F/.swarmforge/operator/telegram-console.pid" ]]'
PID1="$(cat "$F/.swarmforge/operator/telegram-console.pid")"
check "started poller pid is alive" 'kill -0 "$PID1" 2>/dev/null'
check "status is ok" \
  '[[ "$(jget "$F/.swarmforge/operator/telegram-console.status.json" ":state")" == ok ]]'
OPERATOR_TELEGRAM_BOT_TOKEN=TOKEN OPERATOR_TELEGRAM_ALLOWED_USER_ID=123 \
  OPERATOR_TELEGRAM_FAKE_POLL=1 bb "$F/swarmforge/scripts/operator_telegram.bb" ensure "$F" >/dev/null
check "idempotent ensure keeps same pid" '[[ "$(cat "$F/.swarmforge/operator/telegram-console.pid")" == "$PID1" ]]'
bb "$F/swarmforge/scripts/operator_telegram.bb" stop "$F" >/dev/null
check "stop marks stopped" \
  '[[ "$(jget "$F/.swarmforge/operator/telegram-console.status.json" ":state")" == stopped ]]'
check "stop kills poller" '! kill -0 "$PID1" 2>/dev/null'

# ── auth lost backoff suppresses relaunch ───────────────────────────────────
F="$(make_fixture auth-lost)"
cat > "$F/.swarmforge/operator/telegram-console.status.json" <<EOF
{"state":"auth_lost","attempts":1,"backoff_until_ms":9999999999999}
EOF
OPERATOR_TELEGRAM_BOT_TOKEN=TOKEN OPERATOR_TELEGRAM_ALLOWED_USER_ID=123 \
  OPERATOR_TELEGRAM_FAKE_POLL=1 bb "$F/swarmforge/scripts/operator_telegram.bb" ensure "$F" >/dev/null
check "auth_lost in backoff does not start poller" '[[ ! -f "$F/.swarmforge/operator/telegram-console.pid" ]]'
check "auth_lost state is preserved" \
  '[[ "$(jget "$F/.swarmforge/operator/telegram-console.status.json" ":state")" == auth_lost ]]'

# ── /ensure confirmation runs once and clears running state ────────────────
F="$(make_fixture ensure-confirm)"
OUTBOX="$F/.swarmforge/operator/outbox.jsonl"
COUNT="$F/.swarmforge/operator/ensure-count.txt"
UPDATE_ENSURE='{"message":{"chat":{"id":9},"from":{"id":123},"text":"/ensure"}}'
OPERATOR_TELEGRAM_BOT_TOKEN=TOKEN OPERATOR_TELEGRAM_ALLOWED_USER_ID=123 \
  OPERATOR_TELEGRAM_SEND_OUTBOX="$OUTBOX" OPERATOR_TELEGRAM_FAKE_UPDATE="$UPDATE_ENSURE" \
  bb "$F/swarmforge/scripts/operator_telegram.bb" poll-once "$F" >/dev/null
check "/ensure prompt does not run ensure" '[[ ! -f "$COUNT" ]]'
check "/ensure records pending state" \
  '[[ "$(jget "$F/.swarmforge/operator/telegram-console.state.json" ":ensure-pending?")" == true ]]'

UPDATE_CONFIRM='{"message":{"chat":{"id":9},"from":{"id":123},"text":"confirm"}}'
OPERATOR_TELEGRAM_BOT_TOKEN=TOKEN OPERATOR_TELEGRAM_ALLOWED_USER_ID=123 \
  OPERATOR_TELEGRAM_SEND_OUTBOX="$OUTBOX" OPERATOR_TELEGRAM_ENSURE_COUNT_FILE="$COUNT" \
  OPERATOR_TELEGRAM_FAKE_ENSURE_RESULT='{"exit":0,"tail":"ok"}' OPERATOR_TELEGRAM_FAKE_UPDATE="$UPDATE_CONFIRM" \
  bb "$F/swarmforge/scripts/operator_telegram.bb" poll-once "$F" >/dev/null
check "confirm runs ensure once" '[[ "$(wc -l < "$COUNT")" == 1 ]]'
check "confirm clears pending state" \
  '[[ "$(jget "$F/.swarmforge/operator/telegram-console.state.json" ":ensure-pending?")" == false ]]'
check "confirm clears running state after result" \
  '[[ "$(jget "$F/.swarmforge/operator/telegram-console.state.json" ":ensure-running?")" == false ]]'
check "confirm reports ensure result" 'grep -q "./swarm ensure exit 0" "$OUTBOX"'

# ── live getUpdates branch: no fake update shortcut ────────────────────────
F="$(make_fixture live-getupdates)"
cat > "$F/.swarmforge/operator/status.json" <<'EOF'
{"state":"idle","provider_state":"available","agents_running":7,"pending_events":2,"updated_at":"2026-07-19T20:00:00Z","tunnel":{"state":"running","url":"https://vscode.dev/tunnel/swarmforge/abc"}}
EOF
printf 'coder\tworking\nQA\tidle\n' > "$F/.swarmforge/roles.tsv"
FAKEBIN="$F/bin"
mkdir -p "$FAKEBIN"
cat > "$FAKEBIN/curl" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$OPERATOR_TELEGRAM_CURL_LOG"
if [[ "$*" == *"offset=42"* ]]; then
  printf '{"ok":true,"result":[]}\n200'
else
  printf '{"ok":true,"result":[{"update_id":41,"message":{"chat":{"id":9},"from":{"id":123},"text":"/status@operator_bot"}}]}\n200'
fi
EOF
chmod +x "$FAKEBIN/curl"
OUTBOX="$F/.swarmforge/operator/outbox.jsonl"
CURL_LOG="$F/.swarmforge/operator/curl.log"
PATH="$FAKEBIN:$PATH" OPERATOR_TELEGRAM_CURL_LOG="$CURL_LOG" \
  OPERATOR_TELEGRAM_BOT_TOKEN=TOKEN OPERATOR_TELEGRAM_ALLOWED_USER_ID=123 \
  OPERATOR_TELEGRAM_SEND_OUTBOX="$OUTBOX" \
  bb "$F/swarmforge/scripts/operator_telegram.bb" poll-once "$F" >/dev/null
check "live getUpdates branch replies to allowlisted /status@bot" 'grep -q "state: idle" "$OUTBOX"'
check "live getUpdates branch persists next offset" \
  '[[ "$(jget "$F/.swarmforge/operator/telegram-console.state.json" ":offset")" == 42 ]]'
PATH="$FAKEBIN:$PATH" OPERATOR_TELEGRAM_CURL_LOG="$CURL_LOG" \
  OPERATOR_TELEGRAM_BOT_TOKEN=TOKEN OPERATOR_TELEGRAM_ALLOWED_USER_ID=123 \
  OPERATOR_TELEGRAM_SEND_OUTBOX="$OUTBOX" \
  bb "$F/swarmforge/scripts/operator_telegram.bb" poll-once "$F" >/dev/null
check "subsequent getUpdates call passes persisted offset" 'grep -q "offset=42" "$CURL_LOG"'

if [[ "$fail" -eq 0 ]]; then
  echo "operator_telegram smoke: ALL CHECKS PASSED"
else
  echo "operator_telegram smoke: FAILURES"; exit 1
fi
