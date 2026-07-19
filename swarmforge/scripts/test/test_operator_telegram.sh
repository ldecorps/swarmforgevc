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

if [[ "$fail" -eq 0 ]]; then
  echo "operator_telegram smoke: ALL CHECKS PASSED"
else
  echo "operator_telegram smoke: FAILURES"; exit 1
fi
