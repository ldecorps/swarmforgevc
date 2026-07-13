const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

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
function runCli(root, overrides = {}) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, ...overrides };
  const output = execFileSync('node', [CLI], { encoding: 'utf8', cwd: root, env });
  return JSON.parse(output);
}

const FORCE_SUCCESS = JSON.stringify({ success: true, messageId: 1 });
const DELIVER_ENV = { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat', TELEGRAM_NOTIFY_FORCE_RESULT: FORCE_SUCCESS };

test('BL-353: a new dead letter is announced into the reserved Operator topic', () => {
  const root = mkFixtureWithDeadLetter('coder', '00_a.handoff.dead', 'type: note\nrecipient: coder\ntask: BL-900-demo\n', true);
  const result = runCli(root, DELIVER_ENV);
  assert.equal(result.sent, true);
  assert.equal(result.newCount, 1);
  const state = JSON.parse(fs.readFileSync(STATE_PATH(root), 'utf8'));
  assert.deepEqual(state.announcedFilePaths, [path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new', '00_a.handoff.dead')]);
});

test('BL-353: the SAME dead letter is never re-announced on the next sweep', () => {
  const root = mkFixtureWithDeadLetter('coder', '00_a.handoff.dead', 'type: note\nrecipient: coder\ntask: BL-900-demo\n', true);
  const first = runCli(root, DELIVER_ENV);
  assert.equal(first.sent, true);
  const second = runCli(root, DELIVER_ENV);
  assert.equal(second.sent, false);
  assert.equal(second.reason, 'no-new-dead-letters');
});

test('BL-353: no dead letters at all never announces', () => {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `coder\tmaster\t${root}\tswarmforge-coder\tcoder\tclaude\ttask\n`);
  const result = runCli(root, { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat' });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'no-new-dead-letters');
});

test('BL-353: no crash, and never armed, when the Operator topic has not been created yet - retries once it exists', () => {
  const root = mkFixtureWithDeadLetter('coder', '00_a.handoff.dead', 'type: note\nrecipient: coder\ntask: BL-900-demo\n', false);
  const result = runCli(root, { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat' });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'operator-topic-not-yet-created');
  assert.equal(fs.existsSync(STATE_PATH(root)), false);
});

test('BL-353: missing Telegram config never arms - the next sweep retries once configured', () => {
  const root = mkFixtureWithDeadLetter('coder', '00_a.handoff.dead', 'type: note\nrecipient: coder\ntask: BL-900-demo\n', true);
  const result = runCli(root, {});
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'missing-telegram-config');
  assert.equal(fs.existsSync(STATE_PATH(root)), false);
});

test('a failed send leaves the state unarmed, so the next sweep retries', () => {
  const root = mkFixtureWithDeadLetter('coder', '00_a.handoff.dead', 'type: note\nrecipient: coder\ntask: BL-900-demo\n', true);
  const failEnv = { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat', TELEGRAM_NOTIFY_FORCE_RESULT: JSON.stringify({ success: false, error: 'simulated' }) };
  const first = runCli(root, failEnv);
  assert.equal(first.sent, false);
  assert.equal(fs.existsSync(STATE_PATH(root)), false);
  const second = runCli(root, DELIVER_ENV);
  assert.equal(second.sent, true);
});

test('BL-353: a SECOND, genuinely new dead letter after the first was announced is announced again', () => {
  const root = mkFixtureWithDeadLetter('coder', '00_a.handoff.dead', 'type: note\nrecipient: coder\ntask: BL-900-demo\n', true);
  const first = runCli(root, DELIVER_ENV);
  assert.equal(first.sent, true);
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'handoffs', 'inbox', 'new', '01_b.handoff.dead'),
    'type: note\nrecipient: coder\ntask: BL-901-demo\n'
  );
  const second = runCli(root, DELIVER_ENV);
  assert.equal(second.sent, true);
  assert.equal(second.newCount, 1);
});
