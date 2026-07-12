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
  # (per-launch dispatch/reply-context only, bridge-client architecture)
  # and support_thread_store.bb (the SAME unified SUP-### thread store the
  # bridge's inbound-message route and support_thread.bb both write to).
  # BL-282: + operator_memory_lib.bb/operator_memory_store.bb (long-term
  # memory, reloaded alongside the transcript on every wake).
  # BL-283: + ticket_status_lib.bb (linked-ticket-status-sweep!'s own live
  # backlog-status reader).
  # BL-306: + operator_ask.bb (the disposable LLM's own one-shot ask CLI).
  # BL-307: + handoff_lib.bb (the shared mailbox-path resolver
  # closing-pass-sweep! uses for per-role inbox/in-process counts).
  cp "$SRC/operator_lib.bb" "$SRC/operator_runtime.bb" "$SRC/telegram_topic_lib.bb" \
     "$SRC/support_lib.bb" "$SRC/support_thread_store.bb" \
     "$SRC/operator_memory_lib.bb" "$SRC/operator_memory_store.bb" \
     "$SRC/ticket_status_lib.bb" "$SRC/operator_ask.bb" "$SRC/handoff_lib.bb" \
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

# ── 5. BL-281 (bridge-client architecture): a pending Telegram wake (event
#      already enqueued - as the bridge's inbound-message route would do)
#      dispatches with its OWN reply context; a DIFFERENT subject's event is
#      deferred (not bled into the same wake); the runtime never touches
#      Telegram or a topic mapping - SUP-### only ─────────────────────────────
F="$(make_fixture)"
mkdir -p "$F/.swarmforge/support/threads"
printf '{"id":"SUP-1","status":"open","messages":[{"channel":"telegram","timestamp":"2026-07-11T09:00:00Z","text":"about A"}]}' \
  > "$F/.swarmforge/support/threads/SUP-1.json"
printf '{"id":"SUP-2","status":"open","messages":[{"channel":"telegram","timestamp":"2026-07-11T09:00:00Z","text":"about B"}]}' \
  > "$F/.swarmforge/support/threads/SUP-2.json"
printf '{"type":"TELEGRAM_TOPIC_MESSAGE","subject":"SUP-1"}\n{"type":"TELEGRAM_TOPIC_MESSAGE","subject":"SUP-2"}\n' \
  > "$F/.swarmforge/operator/events.jsonl"
echo "$(( $(date +%s) * 1000 ))" > "$F/.swarmforge/operator/last-swarm-check"
OUT5="$(tick "$F")"
check "BL-281: a pending telegram wake launches"                '[[ "$OUT5" == *"\"launched?\":true"* ]]'
check "BL-281: reply-context file is written"                   '[[ -f "$F/.swarmforge/operator/telegram-reply-context.json" ]]'
check "BL-281: reply-context names the dispatched thread"       '[[ "$(jget "$F/.swarmforge/operator/telegram-reply-context.json" ":thread-id")" == SUP-1 ]]'
check "BL-281: reply-context carries SUP-1's transcript"        'jget "$F/.swarmforge/operator/telegram-reply-context.json" ":transcript" | grep -q "about A"'
check "BL-281: reply-context does NOT carry SUP-2's transcript" '! (jget "$F/.swarmforge/operator/telegram-reply-context.json" ":transcript" | grep -q "about B")'
check "BL-281: SUP-1's event is in the inflight batch"          'grep -q "SUP-1" "$F/.swarmforge/operator/events.inflight.jsonl"'
check "BL-281: SUP-2's event is DEFERRED back to events.jsonl, not dropped" \
  'grep -q "SUP-2" "$F/.swarmforge/operator/events.jsonl"'
check "BL-281: SUP-2's event is NOT in the inflight batch"      '! grep -q "SUP-2" "$F/.swarmforge/operator/events.inflight.jsonl"'
rm -rf "$F"

# ── 7. BL-276: an idle OPEN thread gets a gentle nudge (transcript + reply
#      outbox); a resolved thread is skipped entirely; a recently-active
#      thread is not nudged yet. Real-clock-tolerant (like section 3's own
#      cooldown fixture above): a fixture timestamp far in the past is
#      always "idle" relative to whenever this test actually runs, no
#      clock injection needed for this coarse a check - exact boundary
#      timing is exhaustively covered by support_lib_test_runner.bb's own
#      injected-clock idle-nudge-decision tests ─────────────────────────────
F="$(make_fixture)"
mkdir -p "$F/.swarmforge/support/threads"
printf '{"id":"SUP-1","status":"open","messages":[{"channel":"telegram","timestamp":"2020-01-01T00:00:00Z","text":"long idle"}]}' \
  > "$F/.swarmforge/support/threads/SUP-1.json"
printf '{"id":"SUP-2","status":"resolved","messages":[{"channel":"telegram","timestamp":"2020-01-01T00:00:00Z","text":"already resolved"}]}' \
  > "$F/.swarmforge/support/threads/SUP-2.json"
recent="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"id":"SUP-3","status":"open","messages":[{"channel":"telegram","timestamp":"%s","text":"just now"}]}' "$recent" \
  > "$F/.swarmforge/support/threads/SUP-3.json"
tick "$F" > /dev/null
check "BL-276: an idle OPEN thread gets a nudge appended to its transcript" \
  'grep -q "checking in" "$F/.swarmforge/support/threads/SUP-1.json" && grep -q "\"channel\":\"operator\"" "$F/.swarmforge/support/threads/SUP-1.json"'
check "BL-276: the nudge is posted to the reply outbox (the SAME SSE relay path as any Operator reply)" \
  'grep -q "SUP-1" "$F/.swarmforge/operator/telegram-reply-outbox.jsonl"'
check "BL-276: a RESOLVED thread is never nudged, even long idle" \
  '! grep -q "SUP-2" "$F/.swarmforge/operator/telegram-reply-outbox.jsonl"'
check "BL-276: a recently-active thread is not nudged yet" \
  '! grep -q "SUP-3" "$F/.swarmforge/operator/telegram-reply-outbox.jsonl"'
rm -rf "$F"

# ── 8. BL-282: a wake's reply-context carries the long-term memory facts
#      ALONGSIDE the dispatched subject's own transcript, and never a
#      different subject's private transcript detail (operator-memory-02/03) ──
F="$(make_fixture)"
mkdir -p "$F/.swarmforge/support/threads" "$F/.swarmforge/support/memory"
printf '{"facts":["the human prefers terse replies"]}' > "$F/.swarmforge/support/memory/facts.json"
printf '{"id":"SUP-1","status":"open","messages":[{"channel":"telegram","timestamp":"2026-07-11T09:00:00Z","text":"about A"}]}' \
  > "$F/.swarmforge/support/threads/SUP-1.json"
printf '{"id":"SUP-2","status":"open","messages":[{"channel":"telegram","timestamp":"2026-07-11T09:00:00Z","text":"private detail about B, never distilled"}]}' \
  > "$F/.swarmforge/support/threads/SUP-2.json"
printf '{"type":"TELEGRAM_TOPIC_MESSAGE","subject":"SUP-1"}\n' > "$F/.swarmforge/operator/events.jsonl"
echo "$(( $(date +%s) * 1000 ))" > "$F/.swarmforge/operator/last-swarm-check"
tick "$F" > /dev/null
check "BL-282: the reply-context carries the long-term memory fact" \
  'grep -q "the human prefers terse replies" "$F/.swarmforge/operator/telegram-reply-context.json"'
check "BL-282: the reply-context still carries the dispatched subject's OWN transcript" \
  'grep -q "about A" "$F/.swarmforge/operator/telegram-reply-context.json"'
check "BL-282: the reply-context NEVER carries a different subject's private transcript detail" \
  '! grep -q "private detail about B" "$F/.swarmforge/operator/telegram-reply-context.json"'
rm -rf "$F"

# ── 9. BL-283: linked-ticket status-back - a moved-on linked ticket posts a
#      status notice into ITS OWN subject's topic only; an unchanged linked
#      ticket posts nothing; a thread with no linked ticket at all is
#      untouched (coordinator-handoff-03/04/05). Recent timestamps (like
#      section 8's own SUP-3 "just now" fixture) so BL-276's idle-nudge
#      sweep never ALSO fires and pollutes the same reply outbox this
#      section asserts against ───────────────────────────────────────────────
F="$(make_fixture)"
mkdir -p "$F/.swarmforge/support/threads" "$F/backlog/done" "$F/backlog/active"
printf 'id: BL-300\ntitle: shipped thing\nstatus: done\n' > "$F/backlog/done/BL-300.yaml"
printf 'id: BL-301\ntitle: still building\nstatus: active\n' > "$F/backlog/active/BL-301.yaml"
recent="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"id":"SUP-1","status":"open","messages":[{"channel":"telegram","timestamp":"%s","text":"about A"}],"linked-tickets":[{"id":"BL-300","last-reported-status":"active"}]}' "$recent" \
  > "$F/.swarmforge/support/threads/SUP-1.json"
printf '{"id":"SUP-2","status":"open","messages":[{"channel":"telegram","timestamp":"%s","text":"about B"}],"linked-tickets":[{"id":"BL-301","last-reported-status":"active"}]}' "$recent" \
  > "$F/.swarmforge/support/threads/SUP-2.json"
printf '{"id":"SUP-3","status":"open","messages":[{"channel":"telegram","timestamp":"%s","text":"about C, no linked ticket"}]}' "$recent" \
  > "$F/.swarmforge/support/threads/SUP-3.json"
tick "$F" > /dev/null
check "coordinator-handoff-03: a moved-on linked ticket (active -> done) posts a status notice" \
  'grep -q "SUP-1" "$F/.swarmforge/operator/telegram-reply-outbox.jsonl" && grep -q "BL-300 is now done" "$F/.swarmforge/operator/telegram-reply-outbox.jsonl"'
check "coordinator-handoff-03: the notice is appended to the linked thread's own transcript too" \
  'grep -q "BL-300 is now done" "$F/.swarmforge/support/threads/SUP-1.json"'
check "coordinator-handoff-04: an unchanged linked ticket (still active) posts no status notice" \
  '! grep -q "SUP-2" "$F/.swarmforge/operator/telegram-reply-outbox.jsonl"'
check "coordinator-handoff-05: a thread with no linked ticket at all is never touched by the sweep" \
  '! grep -q "SUP-3" "$F/.swarmforge/operator/telegram-reply-outbox.jsonl"'
# a second tick must not re-post the same already-reported status
tick "$F" > /dev/null
check "coordinator-handoff-03: the same status is never reported twice" \
  '[[ "$(grep -c "SUP-1" "$F/.swarmforge/operator/telegram-reply-outbox.jsonl")" -eq 1 ]]'
rm -rf "$F"

# ── 10. BL-306 operator-ask-01: the disposable LLM asks a clarifying
#       question - it is posted into the SUP thread + reply outbox, and the
#       runtime records an awaiting-answer state (the DEDUP guard: a second
#       ask while one is pending is refused, not silently overwritten) ─────
F="$(make_fixture)"
mkdir -p "$F/.swarmforge/support/threads"
ASK_OUT="$(bb "$F/swarmforge/scripts/operator_ask.bb" "$F" --thread SUP-1 --question "which environment?")"
check "operator-ask-01: the ask CLI reports success" '[[ "$ASK_OUT" == *"\"asked\":true"* ]]'
check "operator-ask-01: the question is posted into the SUP thread" \
  'grep -q "which environment?" "$F/.swarmforge/support/threads/SUP-1.json"'
check "operator-ask-01: the question is posted into the reply outbox" \
  'grep -q "which environment?" "$F/.swarmforge/operator/telegram-reply-outbox.jsonl"'
check "operator-ask-01: awaiting-answer.json records the question/thread" \
  '[[ "$(jget "$F/.swarmforge/operator/awaiting-answer.json" ":question")" == "which environment?" ]] && [[ "$(jget "$F/.swarmforge/operator/awaiting-answer.json" ":thread_id")" == SUP-1 ]]'
ASK_OUT2="$(bb "$F/swarmforge/scripts/operator_ask.bb" "$F" --thread SUP-1 --question "a second one?")"
check "operator-ask-01: a second ask while one is pending is refused (never silently overwritten)" \
  '[[ "$ASK_OUT2" == *"\"asked\":false"* ]] && ! grep -q "a second one?" "$F/.swarmforge/operator/telegram-reply-outbox.jsonl"'
rm -rf "$F"

# ── 11. BL-306 operator-ask-02: a human reply in the awaited thread is
#       delivered to the woken Operator as that question's answer, and the
#       awaiting-answer state is cleared ────────────────────────────────────
F="$(make_fixture)"
mkdir -p "$F/.swarmforge/support/threads"
printf '{"question":"which environment?","thread_id":"SUP-1","asked_at_ms":%s}' "$(( $(date +%s) * 1000 ))" \
  > "$F/.swarmforge/operator/awaiting-answer.json"
printf '{"id":"SUP-1","status":"open","messages":[{"channel":"operator","timestamp":"2026-07-11T09:00:00Z","text":"which environment?"},{"channel":"telegram","timestamp":"2026-07-11T09:05:00Z","text":"use staging"}]}' \
  > "$F/.swarmforge/support/threads/SUP-1.json"
printf '{"type":"TELEGRAM_TOPIC_MESSAGE","subject":"SUP-1"}\n' > "$F/.swarmforge/operator/events.jsonl"
echo "$(( $(date +%s) * 1000 ))" > "$F/.swarmforge/operator/last-swarm-check"
tick "$F" > /dev/null
check "operator-ask-02: the reply-context pairs the pending question" \
  'grep -q "which environment?" "$F/.swarmforge/operator/telegram-reply-context.json"'
check "operator-ask-02: the reply-context pairs the human's own answer text" \
  'grep -q "\"answer\":\"use staging\"" "$F/.swarmforge/operator/telegram-reply-context.json"'
check "operator-ask-02: awaiting-answer.json is cleared once the reply is delivered" \
  '[[ ! -f "$F/.swarmforge/operator/awaiting-answer.json" ]]'
rm -rf "$F"

# ── 12. BL-306 operator-ask-03: an unanswered question escalates EXACTLY
#       once past the bounded window, then the wait clears - never an
#       endless re-ask, never a guess ───────────────────────────────────────
F="$(make_fixture)"
mkdir -p "$F/.swarmforge/support/threads"
printf '{"id":"SUP-1","status":"open","messages":[{"channel":"operator","timestamp":"2020-01-01T00:00:00Z","text":"which environment?"}]}' \
  > "$F/.swarmforge/support/threads/SUP-1.json"
printf '{"question":"which environment?","thread_id":"SUP-1","asked_at_ms":0}' \
  > "$F/.swarmforge/operator/awaiting-answer.json"
OPERATOR_AWAIT_TIMEOUT_MS=1 tick "$F" > /dev/null
check "operator-ask-03: exactly one escalation is posted to the reply outbox" \
  '[[ "$(grep -c "still needed" "$F/.swarmforge/operator/telegram-reply-outbox.jsonl")" -eq 1 ]]'
check "operator-ask-03: the escalation names the original question" \
  'grep -q "which environment?" "$F/.swarmforge/operator/telegram-reply-outbox.jsonl"'
check "operator-ask-03: the escalation is appended to the thread transcript too" \
  'grep -q "still needed" "$F/.swarmforge/support/threads/SUP-1.json"'
check "operator-ask-03: awaiting-answer.json clears - never a permanent wait" \
  '[[ ! -f "$F/.swarmforge/operator/awaiting-answer.json" ]]'
# a further tick must never re-escalate the same (now-cleared) question.
OPERATOR_AWAIT_TIMEOUT_MS=1 tick "$F" > /dev/null
check "operator-ask-03: a later tick never re-escalates (exactly once, not endlessly)" \
  '[[ "$(grep -c "still needed" "$F/.swarmforge/operator/telegram-reply-outbox.jsonl")" -eq 1 ]]'
rm -rf "$F"

# ── 13. BL-306 operator-ask-04: a swarm emergency is handled normally while
#       a question is pending - awaiting an answer never blocks recovery ────
F="$(make_fixture)"
printf '{"question":"which environment?","thread_id":"SUP-1","asked_at_ms":%s}' "$(( $(date +%s) * 1000 ))" \
  > "$F/.swarmforge/operator/awaiting-answer.json"
printf '{"type":"HUMAN_COMMAND","detail":"emergency"}\n' > "$F/.swarmforge/operator/events.jsonl"
echo "$(( $(date +%s) * 1000 ))" > "$F/.swarmforge/operator/last-swarm-check"
OUT13="$(tick "$F")"
check "operator-ask-04: the emergency event still dispatches while a question is pending" \
  '[[ "$OUT13" == *"\"launched?\":true"* ]]'
check "operator-ask-04: the still-unanswered (not yet due) question is left untouched" \
  '[[ -f "$F/.swarmforge/operator/awaiting-answer.json" ]] && [[ "$(jget "$F/.swarmforge/operator/awaiting-answer.json" ":thread_id")" == SUP-1 ]]'
rm -rf "$F"

# ── 14-20. BL-307: auto-hibernate on drain + mandatory closing pass. Every
#          scenario gives the roster one REAL role ("coder", its own
#          worktree) so closing-pass-sweep!'s eligible? guard (never
#          hibernate a roster that never existed) is satisfied - matching
#          every one of the ticket's own scenarios, which all describe an
#          actual roster in play. No real tmux socket is ever created, so
#          kill-swarm-tmux!/relaunch-tmux! (gated by OPERATOR_SKIP_LAUNCH,
#          same seam launch-operator! already uses) never shell out for
#          real - the "injectable seam...without a real tmux socket" the
#          ticket asks for ─────────────────────────────────────────────────
make_roster_fixture() {
  local d; d="$(make_fixture)"
  mkdir -p "$d/.worktrees/coder/.swarmforge/handoffs/inbox/new" \
           "$d/.worktrees/coder/.swarmforge/handoffs/inbox/in_process" \
           "$d/backlog/active" "$d/backlog/paused"
  printf 'coder\tcoder\t%s/.worktrees/coder\tswarmforge-coder\tCoder\tclaude\ttask\n' "$d" \
    > "$d/.swarmforge/roles.tsv"
  # Pre-seed the swarm-check timer (like section 3's cooldown fixture) so a
  # fresh SWARM_CHECK_TIMER event never masks a fully-idle tick's own state.
  echo "$(( $(date +%s) * 1000 ))" > "$d/.swarmforge/operator/last-swarm-check"
  printf '%s' "$d"
}

# ── 14: fully drained + idle roster -> hibernates ─────────────────────────
F="$(make_roster_fixture)"
OUT14="$(OPERATOR_SKIP_LAUNCH=1 tick "$F")"
check "BL-307/swarm-auto-hibernate-01: hibernation.json records hibernated=true" \
  '[[ -f "$F/.swarmforge/operator/hibernation.json" ]] && [[ "$(jget "$F/.swarmforge/operator/hibernation.json" ":hibernated")" == true ]]'
check "BL-307/swarm-auto-hibernate-01: roles.tsv is emptied" \
  '[[ ! -s "$F/.swarmforge/roles.tsv" ]]'
check "BL-307/swarm-auto-hibernate-01: the pre-hibernate roster is backed up" \
  'grep -q "^coder" "$F/.swarmforge/roles.tsv.hibernate-backup"'
# The FIRST tick's own dead-agent-events (real roster row, no live tmux
# session backing it - unrelated to closing-pass-sweep!) still dispatches a
# pending event, so :state legitimately reads "dispatching" that tick (like
# section 1's own first-tick assertion). By the SECOND tick roles.tsv is
# already empty (nothing left to report dead) and the dispatched event has
# been reaped, so :state settles on "hibernated" - BL-307/swarm-auto-
# hibernate-06's own "recorded in the runtime's status output" assertion.
OUT14b="$(OPERATOR_SKIP_LAUNCH=1 tick "$F")"
check "BL-307/swarm-auto-hibernate-06: status.json records the hibernated state" \
  '[[ "$(jget "$F/.swarmforge/operator/status.json" ":state")" == hibernated ]]'
rm -rf "$F"

# ── 15: an in-process task blocks hibernation ─────────────────────────────
F="$(make_roster_fixture)"
printf 'from: coder\nto: cleaner\npriority: 50\ntype: git_handoff\ntask: t\ncommit: abc\n\nbody\n' \
  > "$F/.worktrees/coder/.swarmforge/handoffs/inbox/in_process/00_x_from_coder_to_cleaner.handoff"
OUT15="$(OPERATOR_SKIP_LAUNCH=1 tick "$F")"
check "BL-307/swarm-auto-hibernate-02: an in-process task blocks hibernation" \
  '[[ ! -f "$F/.swarmforge/operator/hibernation.json" ]] && [[ -s "$F/.swarmforge/roles.tsv" ]]'
rm -rf "$F"

# ── 16: a pending inbox item blocks hibernation ───────────────────────────
F="$(make_roster_fixture)"
printf 'from: coder\nto: cleaner\npriority: 50\ntype: git_handoff\ntask: t\ncommit: abc\n\nbody\n' \
  > "$F/.worktrees/coder/.swarmforge/handoffs/inbox/new/00_x_from_coder_to_cleaner.handoff"
OUT16="$(OPERATOR_SKIP_LAUNCH=1 tick "$F")"
check "BL-307/swarm-auto-hibernate-03: a pending inbox item blocks hibernation" \
  '[[ ! -f "$F/.swarmforge/operator/hibernation.json" ]] && [[ -s "$F/.swarmforge/roles.tsv" ]]'
rm -rf "$F"

# ── 17: a blocked paused ticket never blocks hibernation ─────────────────
F="$(make_roster_fixture)"
printf 'id: BL-101\nstatus: blocked\n' > "$F/backlog/paused/BL-101.yaml"
OUT17="$(OPERATOR_SKIP_LAUNCH=1 tick "$F")"
check "BL-307/swarm-auto-hibernate-04: a blocked-only paused backlog still hibernates" \
  '[[ -f "$F/.swarmforge/operator/hibernation.json" ]] && [[ ! -s "$F/.swarmforge/roles.tsv" ]]'
rm -rf "$F"

# ── 18: a pull-eligible paused ticket blocks hibernation (control for 17) ─
F="$(make_roster_fixture)"
printf 'id: BL-200\nstatus: todo\n' > "$F/backlog/paused/BL-200.yaml"
OUT18="$(OPERATOR_SKIP_LAUNCH=1 tick "$F")"
check "a pull-eligible (non-blocked) paused ticket blocks hibernation" \
  '[[ ! -f "$F/.swarmforge/operator/hibernation.json" ]] && [[ -s "$F/.swarmforge/roles.tsv" ]]'
rm -rf "$F"

# ── 19: an active backlog item blocks hibernation ─────────────────────────
F="$(make_roster_fixture)"
printf 'id: BL-300\nstatus: active\n' > "$F/backlog/active/BL-300.yaml"
OUT19="$(OPERATOR_SKIP_LAUNCH=1 tick "$F")"
check "an active backlog item blocks hibernation" \
  '[[ ! -f "$F/.swarmforge/operator/hibernation.json" ]] && [[ -s "$F/.swarmforge/roles.tsv" ]]'
rm -rf "$F"

# ── 20: new promotable work arriving while hibernated triggers relaunch ──
F="$(make_roster_fixture)"
: > "$F/.swarmforge/roles.tsv"
printf 'coder\tcoder\t%s/.worktrees/coder\tswarmforge-coder\tCoder\tclaude\ttask\n' "$F" \
  > "$F/.swarmforge/roles.tsv.hibernate-backup"
printf '{"hibernated":true,"hibernated_at_ms":1,"config_path":""}' \
  > "$F/.swarmforge/operator/hibernation.json"
printf 'id: BL-400\nstatus: active\n' > "$F/backlog/active/BL-400.yaml"
OUT20="$(OPERATOR_SKIP_LAUNCH=1 tick "$F")"
check "BL-307/swarm-auto-hibernate-07: hibernation state clears on relaunch" \
  '[[ ! -f "$F/.swarmforge/operator/hibernation.json" ]]'
check "BL-307/swarm-auto-hibernate-07: the backed-up roster is restored" \
  'grep -q "^coder" "$F/.swarmforge/roles.tsv"'
rm -rf "$F"

# ── 21-24. BL-310: seed-race launch grace. runtime-started-at-ms reuses the
#          pid-file's own mtime (only ever written by the real -main
#          while-loop, never by --tick-once) - these fixtures seed that same
#          file by hand to simulate "the runtime started N ago" without a
#          real long-running process ─────────────────────────────────────

# ── 21: within the 2-minute grace window -> never hibernates, even drained+idle
F="$(make_roster_fixture)"
: > "$F/.swarmforge/operator/runtime.pid"
OUT21="$(OPERATOR_SKIP_LAUNCH=1 tick "$F")"
check "swarm-seed-race-01: does not hibernate within the launch grace window" \
  '[[ ! -f "$F/.swarmforge/operator/hibernation.json" ]] && [[ -s "$F/.swarmforge/roles.tsv" ]]'
rm -rf "$F"

# ── 22: grace window elapsed (pid-file mtime backdated) -> hibernates as before
F="$(make_roster_fixture)"
: > "$F/.swarmforge/operator/runtime.pid"
touch -d "-5 minutes" "$F/.swarmforge/operator/runtime.pid"
OUT22="$(OPERATOR_SKIP_LAUNCH=1 tick "$F")"
check "swarm-seed-race-02: hibernates once the grace window has elapsed" \
  '[[ -f "$F/.swarmforge/operator/hibernation.json" ]] && [[ ! -s "$F/.swarmforge/roles.tsv" ]]'
rm -rf "$F"

# ── 23: hibernated, no promotable backlog work, fresh coordinator mail arrives
#        -> relaunches (the mail-triggered up-trigger, not the backlog one) ──
F="$(make_roster_fixture)"
: > "$F/.swarmforge/roles.tsv"
printf 'coder\tcoder\t%s/.worktrees/coder\tswarmforge-coder\tCoder\tclaude\ttask\n' "$F" \
  > "$F/.swarmforge/roles.tsv.hibernate-backup"
printf '{"hibernated":true,"hibernated_at_ms":1,"config_path":""}' \
  > "$F/.swarmforge/operator/hibernation.json"
mkdir -p "$F/.swarmforge/handoffs/coordinator/inbox/new"
printf 'from: specifier\nto: coordinator\npriority: 00\ntype: note\n\nbody\n' \
  > "$F/.swarmforge/handoffs/coordinator/inbox/new/00_x_from_specifier_to_coordinator.handoff"
OUT23="$(OPERATOR_SKIP_LAUNCH=1 tick "$F")"
check "swarm-seed-race-03: fresh coordinator mail relaunches a hibernated swarm with no promotable ticket yet" \
  '[[ ! -f "$F/.swarmforge/operator/hibernation.json" ]]'
check "swarm-seed-race-03: the backed-up roster is restored" \
  'grep -q "^coder" "$F/.swarmforge/roles.tsv"'
rm -rf "$F"

# ── 24: hibernated, no promotable backlog work, no fresh mail -> stays hibernated
F="$(make_roster_fixture)"
: > "$F/.swarmforge/roles.tsv"
printf 'coder\tcoder\t%s/.worktrees/coder\tswarmforge-coder\tCoder\tclaude\ttask\n' "$F" \
  > "$F/.swarmforge/roles.tsv.hibernate-backup"
printf '{"hibernated":true,"hibernated_at_ms":1,"config_path":""}' \
  > "$F/.swarmforge/operator/hibernation.json"
OUT24="$(OPERATOR_SKIP_LAUNCH=1 tick "$F")"
check "swarm-seed-race-04: stays hibernated with no fresh mail and no promotable work" \
  '[[ -f "$F/.swarmforge/operator/hibernation.json" ]]'
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
