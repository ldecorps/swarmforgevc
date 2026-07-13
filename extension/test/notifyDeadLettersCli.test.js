const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main } = require('../out/tools/notify-dead-letters');

const CLI = path.join(__dirname, '..', 'out', 'tools', 'notify-dead-letters.js');
const STATE_PATH = (root) => path.join(root, '.swarmforge', 'operator', 'dead-letter-notify-state.json');
const TOPIC_MAP_PATH = (root) => path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-notify-dead-letters-'));
}
function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}
function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// Real git root + real roles.tsv + a real .handoff.dead file under the
// role's own inbox/new - the exact shape buildRoleInboxes/listDeadLetters
// (production code, unchanged) reads. bindOperatorTopic controls whether
// BL-346's reserved Operator topic is already bound in the map (the
// notify CLI must degrade gracefully, never crash, when it is not).
function mkFixtureWithDeadLetter(role, deadLetterName, headerLines, bindOperatorTopic) {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);

  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `${role}\tmaster\t${root}\tswarmforge-${role}\t${role}\tclaude\ttask\n`);

  const inboxNewDir = path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new');
  mkdirp(inboxNewDir);
  fs.writeFileSync(path.join(inboxNewDir, deadLetterName), headerLines);

  if (bindOperatorTopic) {
    mkdirp(path.join(root, '.swarmforge', 'operator'));
    fs.writeFileSync(TOPIC_MAP_PATH(root), JSON.stringify({ '777': 'OPERATOR' }));
  }
  return root;
}

// An explicit ALLOWLIST env, never {...process.env, ...overrides} - this
// box's own shell exports the REAL Telegram bot token globally.
function runCliSubprocess(root, overrides = {}) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, ...overrides };
  const output = execFileSync('node', [CLI], { encoding: 'utf8', cwd: root, env });
  return JSON.parse(output);
}

// Runs the REAL main() in-process against a real fixture repo/env, so
// in-process coverage and mutation tooling can see the branches a
// subprocess-only smoke test cannot (the engineering article's CLI
// main()-thin-wrapper rule; mirrors notifyRecertBatchCli.test.js's own
// identical seam). Same allowlist-env posture as runCliSubprocess above -
// never {...process.env, ...overrides}.
const NOTIFY_ENV_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_NOTIFY_FORCE_RESULT'];
async function runCli(root, overrides = {}) {
  const previousCwd = process.cwd();
  const previousEnv = Object.fromEntries(NOTIFY_ENV_KEYS.map((k) => [k, process.env[k]]));
  const writes = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    writes.push(chunk);
    return true;
  };
  try {
    for (const key of NOTIFY_ENV_KEYS) {
      if (overrides[key] === undefined) delete process.env[key];
      else process.env[key] = overrides[key];
    }
    process.chdir(root);
    await main();
  } finally {
    process.stdout.write = originalWrite;
    process.chdir(previousCwd);
    for (const key of NOTIFY_ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
  return JSON.parse(writes.join(''));
}

const FORCE_SUCCESS = JSON.stringify({ success: true, messageId: 1 });
const DELIVER_ENV = { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat', TELEGRAM_NOTIFY_FORCE_RESULT: FORCE_SUCCESS };

test('BL-353: a new dead letter is announced into the reserved Operator topic', async () => {
  const root = mkFixtureWithDeadLetter('coder', '00_a.handoff.dead', 'type: note\nrecipient: coder\ntask: BL-900-demo\n', true);
  const result = await runCli(root, DELIVER_ENV);
  assert.equal(result.sent, true);
  assert.equal(result.newCount, 1);
  const state = JSON.parse(fs.readFileSync(STATE_PATH(root), 'utf8'));
  assert.deepEqual(state.announcedFilePaths, [path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new', '00_a.handoff.dead')]);
});

test('BL-353: the SAME dead letter is never re-announced on the next sweep', async () => {
  const root = mkFixtureWithDeadLetter('coder', '00_a.handoff.dead', 'type: note\nrecipient: coder\ntask: BL-900-demo\n', true);
  const first = await runCli(root, DELIVER_ENV);
  assert.equal(first.sent, true);
  const second = await runCli(root, DELIVER_ENV);
  assert.equal(second.sent, false);
  assert.equal(second.reason, 'no-new-dead-letters');
});

test('BL-353: no dead letters at all never announces', async () => {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `coder\tmaster\t${root}\tswarmforge-coder\tcoder\tclaude\ttask\n`);
  const result = await runCli(root, { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat' });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'no-new-dead-letters');
});

test('BL-353: no crash, and never armed, when the Operator topic has not been created yet - retries once it exists', async () => {
  const root = mkFixtureWithDeadLetter('coder', '00_a.handoff.dead', 'type: note\nrecipient: coder\ntask: BL-900-demo\n', false);
  const result = await runCli(root, { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat' });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'operator-topic-not-yet-created');
  assert.equal(fs.existsSync(STATE_PATH(root)), false);
});

test('BL-353: missing Telegram config never arms - the next sweep retries once configured', async () => {
  const root = mkFixtureWithDeadLetter('coder', '00_a.handoff.dead', 'type: note\nrecipient: coder\ntask: BL-900-demo\n', true);
  const result = await runCli(root, {});
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'missing-telegram-config');
  assert.equal(fs.existsSync(STATE_PATH(root)), false);
});

test('a failed send leaves the state unarmed, so the next sweep retries', async () => {
  const root = mkFixtureWithDeadLetter('coder', '00_a.handoff.dead', 'type: note\nrecipient: coder\ntask: BL-900-demo\n', true);
  const failEnv = { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat', TELEGRAM_NOTIFY_FORCE_RESULT: JSON.stringify({ success: false, error: 'simulated' }) };
  const first = await runCli(root, failEnv);
  assert.equal(first.sent, false);
  assert.equal(fs.existsSync(STATE_PATH(root)), false);
  const second = await runCli(root, DELIVER_ENV);
  assert.equal(second.sent, true);
});

test('BL-353: a SECOND, genuinely new dead letter after the first was announced is announced again', async () => {
  const root = mkFixtureWithDeadLetter('coder', '00_a.handoff.dead', 'type: note\nrecipient: coder\ntask: BL-900-demo\n', true);
  const first = await runCli(root, DELIVER_ENV);
  assert.equal(first.sent, true);
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new', '01_b.handoff.dead'),
    'type: note\nrecipient: coder\ntask: BL-901-demo\n'
  );
  const second = await runCli(root, DELIVER_ENV);
  assert.equal(second.sent, true);
  assert.equal(second.newCount, 1);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const root = mkFixtureWithDeadLetter('coder', '00_a.handoff.dead', 'type: note\nrecipient: coder\ntask: BL-900-demo\n', true);
  const result = runCliSubprocess(root, DELIVER_ENV);
  assert.equal(result.sent, true);
  assert.equal(result.newCount, 1);
});
