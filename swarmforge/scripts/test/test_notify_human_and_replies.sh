#!/usr/bin/env bash
# notify_human.sh / human_replies.sh against a fake Telegram Bot API: a
# fixture swarm (its own swarmforge/scripts copy, swarm-identity and
# role-topic-map) and a fixture fleet home, so nothing reaches the real API or
# the real ~/.swarmforge.
set -euo pipefail

SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/notify-human-test.XXXXXX")"
FAKE_PID=""
cleanup() { [[ -n "$FAKE_PID" ]] && kill "$FAKE_PID" 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

fails=0
check() { # <description> <condition-exit-code>
  if [[ "$2" -eq 0 ]]; then echo "ok - $1"; else echo "FAIL - $1"; fails=$((fails + 1)); fi
}

ROOT="$TMP/target"
mkdir -p "$ROOT/swarmforge/scripts" "$ROOT/.swarmforge/operator" "$TMP/home/.swarmforge/fleet/TestSwarm"
cp "$SCRIPTS/notify_human.sh" "$SCRIPTS/human_replies.sh" "$ROOT/swarmforge/scripts/"
printf 'swarm_name\tTestSwarm\n' > "$ROOT/.swarmforge/swarm-identity"
echo '{"coordinator":5}' > "$ROOT/.swarmforge/operator/role-topic-map.json"
echo '{"botToken":"fleet-token","chatId":"-100777","bridgePort":8799}' > "$TMP/home/.swarmforge/fleet/TestSwarm/telegram.json"

# Fake Bot API: records every call; getUpdates serves a fixed batch, minus
# anything below the requested offset (Telegram's own acknowledgement rule).
cat > "$TMP/fake.js" <<'JS'
const http = require('http');
const fs = require('fs');
const [log, portFile] = process.argv.slice(2);
const updates = [
  { update_id: 10, message: { message_thread_id: 5, from: { id: 42 }, date: 1790000000, text: 'approve option A' } },
  { update_id: 11, message: { message_thread_id: 3, from: { id: 42 }, date: 1790000001, text: 'other topic' } },
  { update_id: 12, message: { message_thread_id: 5, from: { id: 99 }, date: 1790000002, text: 'not the principal' } },
  { update_id: 13, poll_answer: { poll_id: 'P1', user: { id: 42 }, option_ids: [1] } },
];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    fs.appendFileSync(log, JSON.stringify({ path: url.pathname, query: Object.fromEntries(url.searchParams), body: body ? JSON.parse(body) : null }) + '\n');
    let result = true;
    if (url.pathname.endsWith('/sendPoll')) result = { message_id: 1, poll: { id: 'P1' } };
    if (url.pathname.endsWith('/getUpdates')) result = updates.filter((u) => u.update_id >= Number(url.searchParams.get('offset') || 0));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, result }));
  });
});
server.listen(0, '127.0.0.1', () => fs.writeFileSync(portFile, String(server.address().port)));
JS
node "$TMP/fake.js" "$TMP/calls.jsonl" "$TMP/port" &
FAKE_PID=$!
for _ in $(seq 50); do [[ -s "$TMP/port" ]] && break; sleep 0.1; done

export SWARMFORGE_FLEET_HOME="$TMP/home"
export TELEGRAM_API_BASE="http://127.0.0.1:$(cat "$TMP/port")"
export TELEGRAM_PRINCIPAL_USER_ID=42
# The primary swarm's creds leak in through ~/.zshenv in real launches - they must be ignored.
export TELEGRAM_BOT_TOKEN=primary-token TELEGRAM_CHAT_ID=-100111

last_call() { tail -1 "$TMP/calls.jsonl"; }

out="$("$ROOT/swarmforge/scripts/notify_human.sh" "we need you")"
check "a plain message is sent" $([[ "$out" == *"sent to Coordinator topic 5"* ]]; echo $?)
check "it uses the fleet token, not the env token" $([[ "$(last_call)" == *'"/botfleet-token/sendMessage"'* ]]; echo $?)
check "it posts into the coordinator topic of the fleet chat" $([[ "$(last_call)" == *'"chat_id":"-100777","message_thread_id":5,"text":"we need you"'* ]]; echo $?)

set +e
"$ROOT/swarmforge/scripts/notify_human.sh" --poll "Which way?" "only one" 2>/dev/null; rc=$?
set -e
check "a poll with one option is refused (exit 2)" $([[ $rc -eq 2 ]]; echo $?)

out="$("$ROOT/swarmforge/scripts/notify_human.sh" --poll "Which way?" "Option A" "Option B")"
check "a poll is sent" $([[ "$out" == *"poll sent"* ]]; echo $?)
check "the poll is non-anonymous with the given options" $([[ "$(last_call)" == *'"options":[{"text":"Option A"},{"text":"Option B"}],"is_anonymous":false'* ]]; echo $?)
check "the poll's options are remembered by poll id" $(grep -q '"P1"' "$ROOT/.swarmforge/operator/human-polls.json"; echo $?)

peek="$("$ROOT/swarmforge/scripts/human_replies.sh" --peek)"
check "--peek shows the principal's message" $([[ "$peek" == *"approve option A"* ]]; echo $?)
check "--peek marks nothing read" $([[ ! -f "$ROOT/.swarmforge/operator/human-replies-offset.json" ]]; echo $?)

out="$("$ROOT/swarmforge/scripts/human_replies.sh")"
check "a reply in the coordinator topic is printed" $([[ "$out" == *"approve option A"* ]]; echo $?)
check "another topic is skipped" $([[ "$out" != *"other topic"* ]]; echo $?)
check "someone other than the principal is skipped" $([[ "$out" != *"not the principal"* ]]; echo $?)
check "a poll vote comes back as the option text" $([[ "$out" == *"POLL ANSWER: Which way? -> Option B"* ]]; echo $?)
check "poll answers are requested from Telegram" $(grep -q 'poll_answer' <<<"$(last_call)"; echo $?)

out="$("$ROOT/swarmforge/scripts/human_replies.sh")"
check "a second read has nothing new" $([[ "$out" == "no new replies" ]]; echo $?)

sleep 300 & holder=$!
echo "$holder" > "$ROOT/.swarmforge/operator/front-desk-supervisor.pid"
set +e
"$ROOT/swarmforge/scripts/human_replies.sh" >/dev/null 2>&1; rc=$?
set -e
kill "$holder" 2>/dev/null || true
check "the reader refuses while a front desk runs (exit 3)" $([[ $rc -eq 3 ]]; echo $?)

if [[ $fails -gt 0 ]]; then
  echo "$fails failure(s)"
  exit 1
fi
echo "all checks passed"
