const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { recreateBlTopic } = require('../out/tools/recreate-bl-topic');
const { appendMessage, recordPath } = require('../out/concierge/blTopicStore');

// BL-332: recreate-bl-topic.js's own main() thin wrapper, exercised
// in-process via its exported recreateBlTopic (never a subprocess spawn
// for THIS test - the CLI main() thin-wrapper rule). No real network call
// ever happens here: TELEGRAM_RECREATE_FORCE_RESULT is the same
// established E2E test seam notify-dead-letters.ts's own
// TELEGRAM_NOTIFY_FORCE_RESULT already uses.

function mkFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl332-'));
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'topics'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function writeTicketYaml(root, id, title) {
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', `${id}-fixture.yaml`),
    `id: ${id}\ntitle: "${title}"\nstatus: todo\n`
  );
}

function writeBacklogTopicMap(root, map) {
  fs.writeFileSync(path.join(root, '.swarmforge', 'operator', 'backlog-topic-map.json'), JSON.stringify(map));
}

function readBacklogTopicMap(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.swarmforge', 'operator', 'backlog-topic-map.json'), 'utf8'));
}

const OLD_ENV = { ...process.env };
function restoreEnv() {
  process.env = { ...OLD_ENV };
}

test('recreate-bl-topic-01: a still-mapped (closed, not deleted) topic is REOPENED, never recreated', async () => {
  const root = mkFixture();
  writeTicketYaml(root, 'BL-900', 'a fine feature');
  writeBacklogTopicMap(root, { 'BL-900': 42 });
  process.env.TELEGRAM_BOT_TOKEN = 'x';
  process.env.TELEGRAM_CHAT_ID = 'y';
  process.env.TELEGRAM_RECREATE_FORCE_RESULT = JSON.stringify({ success: true });
  try {
    const result = await recreateBlTopic(root, 'BL-900');
    assert.equal(result.action, 'reopen');
    assert.equal(result.success, true);
    assert.equal(result.topicId, 42);
    // reopen never touches the mapping - it is the SAME thread id
    assert.deepEqual(readBacklogTopicMap(root), { 'BL-900': 42 });
  } finally {
    restoreEnv();
  }
});

test('recreate-bl-topic-04: a genuinely deleted topic is RECREATED and the ticket maps to the NEW topic id', async () => {
  const root = mkFixture();
  writeTicketYaml(root, 'BL-900', 'a fine feature');
  writeBacklogTopicMap(root, {}); // no mapping at all - the topic is gone
  appendMessage(root, 'BL-900', { author: 'human', type: 'inbound', text: 'the original question' });
  process.env.TELEGRAM_BOT_TOKEN = 'x';
  process.env.TELEGRAM_CHAT_ID = 'y';
  process.env.TELEGRAM_RECREATE_FORCE_RESULT = JSON.stringify({ success: true, messageThreadId: 777 });
  try {
    const result = await recreateBlTopic(root, 'BL-900');
    assert.equal(result.action, 'recreate');
    assert.equal(result.success, true);
    assert.equal(result.topicId, 777);
    assert.deepEqual(readBacklogTopicMap(root), { 'BL-900': 777 });
  } finally {
    restoreEnv();
  }
});

test('recreate-bl-topic-05: recreating never mutates the repo record file itself', async () => {
  const root = mkFixture();
  writeTicketYaml(root, 'BL-900', 'a fine feature');
  writeBacklogTopicMap(root, {});
  appendMessage(root, 'BL-900', { author: 'human', type: 'inbound', text: 'do not touch me' });
  const before = fs.readFileSync(recordPath(root, 'BL-900'), 'utf8');
  process.env.TELEGRAM_BOT_TOKEN = 'x';
  process.env.TELEGRAM_CHAT_ID = 'y';
  process.env.TELEGRAM_RECREATE_FORCE_RESULT = JSON.stringify({ success: true, messageThreadId: 777 });
  try {
    await recreateBlTopic(root, 'BL-900');
    const after = fs.readFileSync(recordPath(root, 'BL-900'), 'utf8');
    assert.equal(after, before, 'the record must be left byte-identical so it can be rebuilt again');
  } finally {
    restoreEnv();
  }
});

test('a ticket with no matching backlog entry at all still recreates, using its own id as the title fallback', async () => {
  const root = mkFixture();
  // deliberately no writeTicketYaml call
  writeBacklogTopicMap(root, {});
  process.env.TELEGRAM_BOT_TOKEN = 'x';
  process.env.TELEGRAM_CHAT_ID = 'y';
  process.env.TELEGRAM_RECREATE_FORCE_RESULT = JSON.stringify({ success: true, messageThreadId: 888 });
  try {
    const result = await recreateBlTopic(root, 'BL-901');
    assert.equal(result.success, true);
    assert.equal(result.topicId, 888);
  } finally {
    restoreEnv();
  }
});
