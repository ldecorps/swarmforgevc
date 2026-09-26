#!/usr/bin/env bash
# notify_human.sh - post to the human in this swarm's own Telegram Coordinator
# topic: a plain message, or a poll for a multiple-choice ruling.
#
# Usage:
#   swarmforge/scripts/notify_human.sh "<message>"
#   swarmforge/scripts/notify_human.sh --poll "<question>" "<option 1>" "<option 2>" [... up to 10]
#
# Built for a swarm that has no Telegram front desk yet (a freshly onboarded
# target): its coordinator's only line to the human. It works beside a front
# desk too, since it only sends.
#
# --poll: Telegram limits the question to 300 characters and each option to
# 100, so send the context first as a plain message (each option's pros/cons
# and your recommendation), then the poll. The poll is non-anonymous so the
# vote can be tied to the human, and human_replies.sh reports it as
# "POLL ANSWER: <question> -> <option>".
#
# Where it posts: the `coordinator` entry of
# .swarmforge/operator/role-topic-map.json (onboarding opens that topic),
# using ~/.swarmforge/fleet/<swarm_name>/telegram.json (botToken, chatId).
# <swarm_name> comes from .swarmforge/swarm-identity. Credentials are NEVER read
# from the environment: agents are launched through zsh, and ~/.zshenv exports
# the PRIMARY swarm's TELEGRAM_* - an env read would post a second swarm's
# asks into the primary swarm's group.
#
# Env (tests only): SWARMFORGE_FLEET_HOME (default $HOME), TELEGRAM_API_BASE
# (default https://api.telegram.org).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[[ $# -ge 1 ]] || { echo 'usage: notify_human.sh "<message>" | --poll "<question>" "<opt>" "<opt>" ...' >&2; exit 2; }

ROOT="$ROOT" node - "$@" <<'NODE'
const fs = require('fs');
const path = require('path');
const root = process.env.ROOT;
const opDir = path.join(root, '.swarmforge', 'operator');
const api = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org';

function fail(message, code = 1) {
  console.error('notify_human: ' + message);
  process.exit(code);
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function swarmName() {
  const identity = fs.existsSync(path.join(root, '.swarmforge', 'swarm-identity'))
    ? fs.readFileSync(path.join(root, '.swarmforge', 'swarm-identity'), 'utf8') : '';
  const row = identity.split('\n').find((l) => l.startsWith('swarm_name\t'));
  return row ? row.split('\t')[1].trim() : 'primary';
}

const name = swarmName();
const creds = readJson(path.join(process.env.SWARMFORGE_FLEET_HOME || process.env.HOME, '.swarmforge', 'fleet', name, 'telegram.json'));
const topic = (readJson(path.join(opDir, 'role-topic-map.json')) || {}).coordinator;
if (!creds || !creds.botToken || !creds.chatId) fail(`no Telegram creds in ~/.swarmforge/fleet/${name}/telegram.json`);
if (!topic) fail('no coordinator topic in .swarmforge/operator/role-topic-map.json');

const args = process.argv.slice(2);
const isPoll = args[0] === '--poll';
let method = 'sendMessage';
let payload = { chat_id: creds.chatId, message_thread_id: topic, text: args[0] };
if (isPoll) {
  const [question, ...options] = args.slice(1);
  const problem =
    !question ? 'a poll needs a question'
    : question.length > 300 ? 'the poll question is over 300 characters - put the context in a plain message first'
    : options.length < 2 || options.length > 10 ? 'a poll needs 2 to 10 options'
    : options.find((o) => o.length > 100) ? 'a poll option is over 100 characters'
    : null;
  if (problem) fail(problem, 2);
  method = 'sendPoll';
  payload = {
    chat_id: creds.chatId,
    message_thread_id: topic,
    question,
    options: options.map((text) => ({ text })),
    is_anonymous: false,
    allows_multiple_answers: false,
  };
}

fetch(`${api}/bot${creds.botToken}/${method}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
})
  .then((r) => r.json())
  .then((r) => {
    if (!r.ok) fail('send failed: ' + r.description);
    if (isPoll) {
      // A poll answer carries only option indexes; keep the text to map them back.
      const file = path.join(opDir, 'human-polls.json');
      const polls = readJson(file) || {};
      polls[r.result.poll.id] = { question: payload.question, options: payload.options.map((o) => o.text), sentAt: new Date().toISOString() };
      fs.mkdirSync(opDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(polls, null, 1));
      console.log(`notify_human: poll sent to Coordinator topic ${topic}`);
    } else {
      console.log(`notify_human: sent to Coordinator topic ${topic}`);
    }
  })
  .catch((e) => fail(e.message));
NODE
