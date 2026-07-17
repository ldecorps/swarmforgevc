const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { recreateBlTopic, main } = require('../out/tools/recreate-bl-topic');

// BL-332/BL-495: recreate-bl-topic.js's own main() thin wrapper, exercised
// IN-PROCESS (the CLI main()-thin-wrapper rule). BL-495 (topic-
// consolidation epic): post-BL-493 there is no per-ticket topic anymore -
// the repair path targets a ticket's FOLD target (its epic's topic, or the
// standing Backlog topic), never resurrecting the retired per-ticket
// model. No real network call ever happens here: TELEGRAM_RECREATE_FORCE_RESULT
// is the same established E2E test seam notify-dead-letters.ts's own
// TELEGRAM_NOTIFY_FORCE_RESULT already uses.

const CLI = path.join(__dirname, '..', 'out', 'tools', 'recreate-bl-topic.js');

function mkFixture() {
  const root = mkTmpDir('sfvc-bl495-');
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function writeTicketYaml(root, id, title, extra = '') {
  fs.writeFileSync(path.join(root, 'backlog', 'active', `${id}-fixture.yaml`), `id: ${id}\ntitle: "${title}"\nstatus: todo\n${extra}`);
}

function writeBacklogTopicMap(root, map) {
  fs.writeFileSync(path.join(root, '.swarmforge', 'operator', 'backlog-topic-map.json'), JSON.stringify(map));
}

function readBacklogTopicMap(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.swarmforge', 'operator', 'backlog-topic-map.json'), 'utf8'));
}

function writeOperatorTopicMap(root, map) {
  fs.writeFileSync(path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json'), JSON.stringify(map));
}

function readOperatorTopicMap(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json'), 'utf8'));
}

// An explicit ALLOWLIST of the env keys this CLI actually reads, never
// {...process.env, ...overrides} - this box's own shell exports a REAL
// Telegram bot token globally (a live dogfooding swarm host).
const CLI_ENV_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_RECREATE_FORCE_RESULT'];

async function runCli(args, overrides = {}) {
  const previousArgv = process.argv;
  const previousEnv = Object.fromEntries(CLI_ENV_KEYS.map((k) => [k, process.env[k]]));
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    process.argv = ['node', CLI, ...args];
    for (const key of CLI_ENV_KEYS) {
      if (overrides[key] === undefined) delete process.env[key];
      else process.env[key] = overrides[key];
    }
    await main();
  } finally {
    process.stdout.write = originalWrite;
    process.argv = previousArgv;
    for (const key of CLI_ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
  return writes.join('');
}

test('main() prints usage and exits nonzero when the ticket id is missing', async () => {
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const output = await runCli(['/some/root']); // no ticket id
    assert.equal(output, '');
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = originalExitCode;
  }
});

test('main() prints usage and exits nonzero when the project root is missing', async () => {
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const output = await runCli([]); // no args at all
    assert.equal(output, '');
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = originalExitCode;
  }
});

// ── topic-recreation-epic-aware-01: epic-bound ticket targets its epic's topic ──

test('topic-recreation-epic-aware-01: an epic-bound ticket reopens its epic topic when already mapped', async () => {
  const root = mkFixture();
  writeTicketYaml(root, 'BL-900', 'a fine feature', 'epic: topic-consolidation\n');
  writeBacklogTopicMap(root, { 'topic-consolidation': 42 });

  const output = await runCli([root, 'BL-900'], {
    TELEGRAM_BOT_TOKEN: 'x',
    TELEGRAM_CHAT_ID: 'y',
    TELEGRAM_RECREATE_FORCE_RESULT: JSON.stringify({ success: true }),
  });

  const result = JSON.parse(output);
  assert.equal(result.action, 'reopen');
  assert.equal(result.success, true);
  assert.equal(result.topicId, 42);
  assert.deepEqual(readBacklogTopicMap(root), { 'topic-consolidation': 42 }, 'reopen never touches the mapping');
});

test('topic-recreation-epic-aware-01: an epic-bound ticket recreates its epic topic when it is gone, named after the epic', async () => {
  const root = mkFixture();
  writeTicketYaml(root, 'BL-900', 'a fine feature', 'epic: topic-consolidation\n');
  writeTicketYaml(root, 'BL-491', 'Topic Consolidation', 'epic: topic-consolidation\ntype: epic\n');
  writeBacklogTopicMap(root, {}); // no mapping at all - the epic topic is gone

  const previousEnv = Object.fromEntries(CLI_ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    process.env.TELEGRAM_BOT_TOKEN = 'x';
    process.env.TELEGRAM_CHAT_ID = 'y';
    process.env.TELEGRAM_RECREATE_FORCE_RESULT = JSON.stringify({ success: true, messageThreadId: 777 });
    const result = await recreateBlTopic(root, 'BL-900');
    assert.equal(result.action, 'recreate');
    assert.equal(result.success, true);
    assert.equal(result.topicId, 777);
    assert.deepEqual(readBacklogTopicMap(root), { 'topic-consolidation': 777 }, 'expected the epic id mapped to the new topic, never a per-ticket id');
  } finally {
    for (const key of CLI_ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
});

// ── topic-recreation-epic-aware-02: epic-less ticket targets the standing Backlog topic ──

test('topic-recreation-epic-aware-02: an epic-less ticket reopens the standing Backlog topic when already mapped', async () => {
  const root = mkFixture();
  writeTicketYaml(root, 'BL-901', 'an epic-less feature');
  writeOperatorTopicMap(root, { 55: 'BACKLOG' });

  const output = await runCli([root, 'BL-901'], {
    TELEGRAM_BOT_TOKEN: 'x',
    TELEGRAM_CHAT_ID: 'y',
    TELEGRAM_RECREATE_FORCE_RESULT: JSON.stringify({ success: true }),
  });

  const result = JSON.parse(output);
  assert.equal(result.action, 'reopen');
  assert.equal(result.success, true);
  assert.equal(result.topicId, 55);
});

test('topic-recreation-epic-aware-02: an epic-less ticket recreates the standing Backlog topic when it is gone', async () => {
  const root = mkFixture();
  writeTicketYaml(root, 'BL-901', 'an epic-less feature');
  writeOperatorTopicMap(root, {}); // no Backlog mapping at all

  const previousEnv = Object.fromEntries(CLI_ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    process.env.TELEGRAM_BOT_TOKEN = 'x';
    process.env.TELEGRAM_CHAT_ID = 'y';
    process.env.TELEGRAM_RECREATE_FORCE_RESULT = JSON.stringify({ success: true, messageThreadId: 888 });
    const result = await recreateBlTopic(root, 'BL-901');
    assert.equal(result.action, 'recreate');
    assert.equal(result.success, true);
    assert.equal(result.topicId, 888);
    assert.deepEqual(readOperatorTopicMap(root), { 888: 'BACKLOG' }, 'expected the new topic mapped to the reserved BACKLOG subject');
  } finally {
    for (const key of CLI_ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
});

// ── topic-recreation-epic-aware-03: never resurrects a per-ticket topic ──

test('topic-recreation-epic-aware-03: a ticket that formerly owned a per-ticket topic mapping is unaffected by it - no per-ticket topic is reopened or recreated', async () => {
  const root = mkFixture();
  writeTicketYaml(root, 'BL-900', 'a fine feature', 'epic: topic-consolidation\n');
  // Legacy per-ticket mapping still present (as BL-494 would leave one
  // undropped on a genuine close failure) - the fold-aware repair path
  // must never consult this key at all.
  writeBacklogTopicMap(root, { 'BL-900': 999 });

  const previousEnv = Object.fromEntries(CLI_ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    process.env.TELEGRAM_BOT_TOKEN = 'x';
    process.env.TELEGRAM_CHAT_ID = 'y';
    process.env.TELEGRAM_RECREATE_FORCE_RESULT = JSON.stringify({ success: true, messageThreadId: 777 });
    const result = await recreateBlTopic(root, 'BL-900');
    // The epic id (topic-consolidation) is not mapped, so this recreates
    // the EPIC topic - never reopens topic 999, the stale per-ticket id.
    assert.equal(result.action, 'recreate');
    assert.notEqual(result.topicId, 999);
    const map = readBacklogTopicMap(root);
    assert.equal(map['BL-900'], 999, 'the stale per-ticket key is left untouched, never read or reused');
    assert.equal(map['topic-consolidation'], 777);
  } finally {
    for (const key of CLI_ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
});

test('a ticket with no matching backlog entry at all falls back to the standing Backlog topic (epic-less default)', async () => {
  const root = mkFixture();
  // deliberately no writeTicketYaml call
  writeOperatorTopicMap(root, {});
  const previousEnv = Object.fromEntries(CLI_ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    process.env.TELEGRAM_BOT_TOKEN = 'x';
    process.env.TELEGRAM_CHAT_ID = 'y';
    process.env.TELEGRAM_RECREATE_FORCE_RESULT = JSON.stringify({ success: true, messageThreadId: 888 });
    const result = await recreateBlTopic(root, 'BL-999');
    assert.equal(result.success, true);
    assert.equal(result.topicId, 888);
  } finally {
    for (const key of CLI_ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process main() tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const root = mkFixture();
  writeTicketYaml(root, 'BL-900', 'a fine feature', 'epic: topic-consolidation\n');
  writeBacklogTopicMap(root, { 'topic-consolidation': 42 });

  const env = { PATH: process.env.PATH, TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_CHAT_ID: 'y', TELEGRAM_RECREATE_FORCE_RESULT: JSON.stringify({ success: true }) };
  const output = execFileSync('node', [CLI, root, 'BL-900'], { encoding: 'utf8', env });

  const result = JSON.parse(output);
  assert.equal(result.action, 'reopen');
  assert.equal(result.success, true);
  assert.equal(result.topicId, 42);
});
