#!/usr/bin/env bash
# human_replies.sh - the inbound half of notify_human.sh: print the human's
# NEW messages and poll votes from this swarm's Coordinator topic, oldest
# first, then remember they were read.
#
# Usage:
#   swarmforge/scripts/human_replies.sh           # read and mark read
#   swarmforge/scripts/human_replies.sh --peek    # read, mark nothing (for a
#                                                 # person checking by hand -
#                                                 # never consume the coordinator's mail)
#
# Output: one block per item, "--- <UTC time>" then either the message text
# or "POLL ANSWER: <question> -> <option>". Prints "no new replies" when there
# is nothing new. Exit 0 either way; exit 1 when Telegram cannot be read; exit 3
# when a front desk is running.
#
# Only for a swarm WITHOUT a running front desk. Two getUpdates pollers on one
# bot token fight (HTTP 409), and a front desk already delivers the human's
# replies. So this refuses while .swarmforge/operator/front-desk-supervisor.pid
# is alive.
#
# Only the principal's messages in the Coordinator topic are printed.
# Everything else is acknowledged and skipped, so it is never re-read. The
# principal is TELEGRAM_PRINCIPAL_USER_ID; the human is the same person in
# every swarm, so unlike the bot credentials this is safe to take from the env.
# Credentials come from ~/.swarmforge/fleet/<swarm_name>/telegram.json only
# (see notify_human.sh for why never the env).
#
# Env (tests only): SWARMFORGE_FLEET_HOME, TELEGRAM_API_BASE.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PID_FILE="$ROOT/.swarmforge/operator/front-desk-supervisor.pid"
if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null; then
  echo "human_replies: a front desk is running for this swarm - the human's replies reach you through it, not this script" >&2
  exit 3
fi
: "${TELEGRAM_PRINCIPAL_USER_ID:?human_replies: TELEGRAM_PRINCIPAL_USER_ID is not set}"

ROOT="$ROOT" PEEK="$([[ "${1:-}" == "--peek" ]] && echo 1 || echo 0)" node - <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.env.ROOT;
const opDir = path.join(root, '.swarmforge', 'operator');
const api = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';
const principal = process.env.TELEGRAM_PRINCIPAL_USER_ID;
const offsetFile = path.join(opDir, 'human-replies-offset.json');

function fail(message) {
  console.error('human_replies: ' + message);
  process.exit(1);
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
const identity = fs.existsSync(path.join(root, '.swarmforge', 'swarm-identity'))
  ? fs.readFileSync(path.join(root, '.swarmforge', 'swarm-identity'), 'utf8') : '';
const nameRow = identity.split('\n').find((l) => l.startsWith('swarm_name\t'));
const name = nameRow ? nameRow.split('\t')[1].trim() : 'primary';
const creds = readJson(path.join(process.env.SWARMFORGE_FLEET_HOME || process.env.HOME, '.swarmforge', 'fleet', name, 'telegram.json'));
const topic = (readJson(path.join(opDir, 'role-topic-map.json')) || {}).coordinator;
if (!creds || !creds.botToken) fail(`no Telegram creds in ~/.swarmforge/fleet/${name}/telegram.json`);
if (!topic) fail('no coordinator topic in .swarmforge/operator/role-topic-map.json');

const polls = readJson(path.join(opDir, 'human-polls.json')) || {};
let offset = (readJson(offsetFile) || {}).offset || 0;
// poll_answer is only delivered when asked for, and Telegram remembers the
// allowed_updates list, so every read passes the full list.
const allowed = encodeURIComponent(JSON.stringify(['message', 'edited_message', 'poll_answer']));

fetch(`${api}/bot${creds.botToken}/getUpdates?timeout=0&offset=${offset}&allowed_updates=${allowed}`)
  .then((r) => r.json())
  .then((r) => {
    if (!r.ok) fail(r.description);
    let printed = 0;
    for (const u of r.result) {
      offset = Math.max(offset, u.update_id + 1);
      const vote = u.poll_answer;
      if (vote) {
        const poll = polls[vote.poll_id];
        if (poll && String(vote.user && vote.user.id) === principal) {
          const picked = vote.option_ids.map((i) => poll.options[i]).join(', ');
          console.log(`--- ${new Date().toISOString()}\nPOLL ANSWER: ${poll.question} -> ${picked || '(vote retracted)'}`);
          printed++;
        }
        continue;
      }
      const m = u.message || u.edited_message;
      if (!m || !m.text || m.message_thread_id !== topic || String(m.from && m.from.id) !== principal) continue;
      console.log(`--- ${new Date(m.date * 1000).toISOString()}\n${m.text}`);
      printed++;
    }
    if (process.env.PEEK !== '1') {
      fs.mkdirSync(opDir, { recursive: true });
      fs.writeFileSync(offsetFile, JSON.stringify({ offset }));
    }
    if (printed === 0) console.log('no new replies');
  })
  .catch((e) => fail(e.message));
NODE
