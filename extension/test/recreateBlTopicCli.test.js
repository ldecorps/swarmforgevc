const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { recreateBlTopic, main } = require('../out/tools/recreate-bl-topic');
const { appendMessage, recordPath } = require('../out/concierge/blTopicStore');

// BL-332: recreate-bl-topic.js's own main() thin wrapper, exercised
// IN-PROCESS (the CLI main()-thin-wrapper rule: main() itself must be
// called in-process by a test, not only spawned as a subprocess, or its
// own argv-dispatch/error-path branches sit uncovered even though the
// underlying recreateBlTopic is thoroughly tested). No real network call
// ever happens here: TELEGRAM_RECREATE_FORCE_RESULT is the same
// established E2E test seam notify-dead-letters.ts's own
// TELEGRAM_NOTIFY_FORCE_RESULT already uses.

const CLI = path.join(__dirname, '..', 'out', 'tools', 'recreate-bl-topic.js');

function mkFixture() {
  const root = mkTmpDir('sfvc-bl332-');
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'topics'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function writeTicketYaml(root, id, title) {
  fs.writeFileSync(path.join(root, 'backlog', 'active', `${id}-fixture.yaml`), `id: ${id}\ntitle: "${title}"\nstatus: todo\n`);
}

function writeBacklogTopicMap(root, map) {
  fs.writeFileSync(path.join(root, '.swarmforge', 'operator', 'backlog-topic-map.json'), JSON.stringify(map));
}

function readBacklogTopicMap(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.swarmforge', 'operator', 'backlog-topic-map.json'), 'utf8'));
}

// An explicit ALLOWLIST of the env keys this CLI actually reads, never
// {...process.env, ...overrides} - this box's own shell exports a REAL
// Telegram bot token globally (a live dogfooding swarm host).
const CLI_ENV_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_RECREATE_FORCE_RESULT'];

// Runs the REAL main() in-process against real argv/env, so in-process
// coverage and mutation tooling can see the branches a subprocess-only
// smoke test cannot (mirrors notifyDeadLettersCli.test.js's own identical
// seam). main() reads its two positional args from process.argv[2]/[3]
// (never process.cwd()), so no cwd stub is needed here - only argv/env
// and the stdout capture.
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

test('recreate-bl-topic-01: main() reopens a still-mapped (closed, not deleted) topic, never recreates', async () => {
  const root = mkFixture();
  writeTicketYaml(root, 'BL-900', 'a fine feature');
  writeBacklogTopicMap(root, { 'BL-900': 42 });

  const output = await runCli([root, 'BL-900'], {
    TELEGRAM_BOT_TOKEN: 'x',
    TELEGRAM_CHAT_ID: 'y',
    TELEGRAM_RECREATE_FORCE_RESULT: JSON.stringify({ success: true }),
  });

  const result = JSON.parse(output);
  assert.equal(result.action, 'reopen');
  assert.equal(result.success, true);
  assert.equal(result.topicId, 42);
  assert.deepEqual(readBacklogTopicMap(root), { 'BL-900': 42 }); // reopen never touches the mapping
});

test('recreate-bl-topic-04: main() recreates a genuinely deleted topic and maps the ticket to the NEW topic id', async () => {
  const root = mkFixture();
  writeTicketYaml(root, 'BL-900', 'a fine feature');
  writeBacklogTopicMap(root, {}); // no mapping at all - the topic is gone
  appendMessage(root, 'BL-900', { author: 'human', type: 'inbound', text: 'the original question' });

  const output = await runCli([root, 'BL-900'], {
    TELEGRAM_BOT_TOKEN: 'x',
    TELEGRAM_CHAT_ID: 'y',
    TELEGRAM_RECREATE_FORCE_RESULT: JSON.stringify({ success: true, messageThreadId: 777 }),
  });

  const result = JSON.parse(output);
  assert.equal(result.action, 'recreate');
  assert.equal(result.success, true);
  assert.equal(result.topicId, 777);
  assert.deepEqual(readBacklogTopicMap(root), { 'BL-900': 777 });
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process main() tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const root = mkFixture();
  writeTicketYaml(root, 'BL-900', 'a fine feature');
  writeBacklogTopicMap(root, { 'BL-900': 42 });

  const env = { PATH: process.env.PATH, TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_CHAT_ID: 'y', TELEGRAM_RECREATE_FORCE_RESULT: JSON.stringify({ success: true }) };
  const output = execFileSync('node', [CLI, root, 'BL-900'], { encoding: 'utf8', env });

  const result = JSON.parse(output);
  assert.equal(result.action, 'reopen');
  assert.equal(result.success, true);
  assert.equal(result.topicId, 42);
});

// ── recreateBlTopic (the underlying, exported function) ───────────────────
// Complements the main()-level tests above with the finer-grained content
// assertions (never mutates the record) that don't need to go through
// argv/stdout at all.

test('recreate-bl-topic-05: recreating never mutates the repo record file itself', async () => {
  const root = mkFixture();
  writeTicketYaml(root, 'BL-900', 'a fine feature');
  writeBacklogTopicMap(root, {});
  appendMessage(root, 'BL-900', { author: 'human', type: 'inbound', text: 'do not touch me' });
  const before = fs.readFileSync(recordPath(root, 'BL-900'), 'utf8');
  const previousEnv = Object.fromEntries(CLI_ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    process.env.TELEGRAM_BOT_TOKEN = 'x';
    process.env.TELEGRAM_CHAT_ID = 'y';
    process.env.TELEGRAM_RECREATE_FORCE_RESULT = JSON.stringify({ success: true, messageThreadId: 777 });
    await recreateBlTopic(root, 'BL-900');
    const after = fs.readFileSync(recordPath(root, 'BL-900'), 'utf8');
    assert.equal(after, before, 'the record must be left byte-identical so it can be rebuilt again');
  } finally {
    for (const key of CLI_ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
});

test('a ticket with no matching backlog entry at all still recreates, using its own id as the title fallback', async () => {
  const root = mkFixture();
  // deliberately no writeTicketYaml call
  writeBacklogTopicMap(root, {});
  const previousEnv = Object.fromEntries(CLI_ENV_KEYS.map((k) => [k, process.env[k]]));
  try {
    process.env.TELEGRAM_BOT_TOKEN = 'x';
    process.env.TELEGRAM_CHAT_ID = 'y';
    process.env.TELEGRAM_RECREATE_FORCE_RESULT = JSON.stringify({ success: true, messageThreadId: 888 });
    const result = await recreateBlTopic(root, 'BL-901');
    assert.equal(result.success, true);
    assert.equal(result.topicId, 888);
  } finally {
    for (const key of CLI_ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
});
