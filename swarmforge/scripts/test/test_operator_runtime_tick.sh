#!/usr/bin/env bash
# Smoke test for the Operator v2 runtime (operator_runtime.bb) + launcher.
# Runs --tick-once against isolated temp fixtures with no tmux and no real
# LLM launch (OPERATOR_SKIP_LAUNCH / OPERATOR_LAUNCH_DRYRUN). Asserts the
# event loop, status schema, launch gate, cooldown hold, and reap.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/.."
fail=0
note() { printf '%s\n' "$*"; }
check() { if eval "$2"; then note "ok   - $1"; else note "FAIL - $1"; fail=1; fi; }

make_fixture() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/.swarmforge/operator" "$d/swarmforge/scripts" "$d/swarmforge/roles"
  # BL-281: operator_runtime.bb now also load-files telegram_topic_lib.bb
  # (which itself load-files support_lib.bb), support_thread_store.bb, and
  # daemon_alarm_lib.bb (reused only for its parse-conf).
  cp "$SRC/operator_lib.bb" "$SRC/operator_runtime.bb" "$SRC/telegram_topic_lib.bb" \
     "$SRC/support_lib.bb" "$SRC/support_thread_store.bb" "$SRC/daemon_alarm_lib.bb" \
     "$d/swarmforge/scripts/"
  printf '%s' "$d"
}
tick() { OPERATOR_SKIP_LAUNCH=1 bb "$1/swarmforge/scripts/operator_runtime.bb" "$1" --tick-once; }
jget() { bb -e "(require '[cheshire.core :as j]) (println (get (j/parse-string (slurp \"$1\") true) $2))"; }

# ── 1. first tick: timer fires, status published, launch decided ─────────────
F="$(make_fixture)"
OUT="$(tick "$F")"
check "first tick reports launched? true"      '[[ "$OUT" == *"\"launched?\":true"* ]]'
check "status.json written"                    '[[ -f "$F/.swarmforge/operator/status.json" ]]'
check "provider_state available"               '[[ "$(jget "$F/.swarmforge/operator/status.json" ":provider_state")" == available ]]'
check "state dispatching"                      '[[ "$(jget "$F/.swarmforge/operator/status.json" ":state")" == dispatching ]]'
check "pending_events >= 1"                     '[[ "$(jget "$F/.swarmforge/operator/status.json" ":pending_events")" -ge 1 ]]'
check "heartbeat written"                       '[[ -f "$F/.swarmforge/operator/heartbeat" ]]'
check "events moved to inflight"                '[[ -f "$F/.swarmforge/operator/events.inflight.jsonl" ]]'
check "swarm-check timer recorded"              '[[ -f "$F/.swarmforge/operator/last-swarm-check" ]]'

# ── 2. second tick: operator not running -> reap; idle ───────────────────────
OUT2="$(tick "$F")"
check "second tick does not relaunch"          '[[ "$OUT2" == *"\"launched?\":false"* ]]'
check "state back to idle"                      '[[ "$(jget "$F/.swarmforge/operator/status.json" ":state")" == idle ]]'
check "inflight reaped to events-done"          '[[ -n "$(ls "$F/.swarmforge/operator/events-done/" 2>/dev/null)" ]]'
rm -rf "$F"

# ── 3. cooldown: future reset holds the launch, event stays queued ───────────
F="$(make_fixture)"
future=$(( ($(date +%s) + 3600) * 1000 ))
printf '{"reset_ms":%s,"reset_raw":"resets later"}' "$future" > "$F/.swarmforge/operator/cooldown.json"
printf '{"type":"HUMAN_COMMAND","detail":"x"}\n' > "$F/.swarmforge/operator/events.jsonl"
echo "$(( $(date +%s) * 1000 ))" > "$F/.swarmforge/operator/last-swarm-check"
OUT3="$(tick "$F")"
check "cooldown does NOT launch"                '[[ "$OUT3" == *"\"launched?\":false"* ]]'
check "state waiting_for_provider"              '[[ "$(jget "$F/.swarmforge/operator/status.json" ":state")" == waiting_for_provider ]]'
check "event stays queued (no inflight)"        '[[ ! -f "$F/.swarmforge/operator/events.inflight.jsonl" ]]'
rm -rf "$F"

# ── 5. BL-281: a pending Telegram wake dispatches with its OWN reply context,
#      a DIFFERENT subject's event is deferred (not bled into the same wake) ──
F="$(make_fixture)"
mkdir -p "$F/.swarmforge/support/threads"
printf '{"id":"SUP-1","status":"open","messages":[{"channel":"telegram","timestamp":"2026-07-11T09:00:00Z","text":"about A"}]}' \
  > "$F/.swarmforge/support/threads/SUP-1.json"
printf '{"id":"SUP-2","status":"open","messages":[{"channel":"telegram","timestamp":"2026-07-11T09:00:00Z","text":"about B"}]}' \
  > "$F/.swarmforge/support/threads/SUP-2.json"
printf '{"42":"SUP-1","43":"SUP-2"}' > "$F/.swarmforge/operator/telegram-topics.json"
printf '{"type":"TELEGRAM_TOPIC_MESSAGE","subject":"SUP-1"}\n{"type":"TELEGRAM_TOPIC_MESSAGE","subject":"SUP-2"}\n' \
  > "$F/.swarmforge/operator/events.jsonl"
echo "$(( $(date +%s) * 1000 ))" > "$F/.swarmforge/operator/last-swarm-check"
OUT5="$(tick "$F")"
check "BL-281: a pending telegram wake launches"                '[[ "$OUT5" == *"\"launched?\":true"* ]]'
check "BL-281: reply-context file is written"                   '[[ -f "$F/.swarmforge/operator/telegram-reply-context.json" ]]'
check "BL-281: reply-context names the dispatched thread"       '[[ "$(jget "$F/.swarmforge/operator/telegram-reply-context.json" ":thread-id")" == SUP-1 ]]'
check "BL-281: reply-context names that thread's OWN topic"     '[[ "$(jget "$F/.swarmforge/operator/telegram-reply-context.json" ":topic-id")" == 42 ]]'
check "BL-281: reply-context carries SUP-1's transcript"        'jget "$F/.swarmforge/operator/telegram-reply-context.json" ":transcript" | grep -q "about A"'
check "BL-281: reply-context does NOT carry SUP-2's transcript" '! (jget "$F/.swarmforge/operator/telegram-reply-context.json" ":transcript" | grep -q "about B")'
check "BL-281: SUP-1's event is in the inflight batch"          'grep -q "SUP-1" "$F/.swarmforge/operator/events.inflight.jsonl"'
check "BL-281: SUP-2's event is DEFERRED back to events.jsonl, not dropped" \
  'grep -q "SUP-2" "$F/.swarmforge/operator/events.jsonl"'
check "BL-281: SUP-2's event is NOT in the inflight batch"      '! grep -q "SUP-2" "$F/.swarmforge/operator/events.inflight.jsonl"'
rm -rf "$F"

# ── 6. BL-281: Telegram not configured (no bot token) - poll sweep is a
#      silent no-op, never crashes the tick ───────────────────────────────────
F="$(make_fixture)"
OUT6="$(TELEGRAM_BOT_TOKEN= TELEGRAM_CHAT_ID= tick "$F" 2>&1)"
check "BL-281: an unconfigured Telegram poll never crashes the tick" '[[ "$OUT6" == *"\"launched?\":true"* ]]'
rm -rf "$F"

# ── 4. launcher assembles a --remote-control command ─────────────────────────
DRY="$(OPERATOR_LAUNCH_DRYRUN=1 bash "$SRC/launch_operator.sh" "$SRC/.." /tmp/x.jsonl 2>&1 || true)"
check "operator named 'Operator' (not a swarm agent)"          '[[ "$DRY" == *"--remote-control Operator"* ]]'
check "operator NOT named SwarmForge-Operator"                 '[[ "$DRY" != *"SwarmForge-Operator"* ]]'
check "launcher targets the operator system prompt"            '[[ "$DRY" == *"roles/operator.prompt"* ]]'

if [[ "$fail" -eq 0 ]]; then
  echo "operator_runtime smoke: ALL CHECKS PASSED"
else
  echo "operator_runtime smoke: FAILURES"; exit 1
fi
