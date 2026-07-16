const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main } = require('../out/tools/resume-expired-pauses');
const { controlPauseStatePath, readControlPauseState } = require('../out/tools/telegram-front-desk-bot');

const CLI = path.join(__dirname, '..', 'out', 'tools', 'resume-expired-pauses.js');
const TOPIC_MAP_PATH = (root) => path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json');

function mkTmp() {
  return mkTmpDir('sfvc-resume-expired-pauses-');
}
function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}
function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function mkFixture(pauseMarker, bindControlTopic) {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  mkdirp(path.join(root, '.swarmforge', 'operator'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `coder\tmaster\t${root}\tswarmforge-coder\tcoder\tclaude\ttask\n`);
  if (pauseMarker !== undefined) {
    fs.writeFileSync(controlPauseStatePath(root), JSON.stringify(pauseMarker));
  }
  if (bindControlTopic) {
    fs.writeFileSync(TOPIC_MAP_PATH(root), JSON.stringify({ '900': 'CONTROL' }));
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

// Runs the REAL main() in-process against a real fixture repo/env, mirroring
// notifyDeadLettersCli.test.js's own identical seam (the CLI main()-thin-
// wrapper rule) - never the only cover for the real logic.
const NOTIFY_ENV_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_NOTIFY_FORCE_RESULT'];
async function runCli(root, overrides = {}) {
  const originalCwd = process.cwd;
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
    process.cwd = () => root;
    await main();
  } finally {
    process.stdout.write = originalWrite;
    process.cwd = originalCwd;
    for (const key of NOTIFY_ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
  return JSON.parse(writes.join(''));
}

const FORCE_SUCCESS = JSON.stringify({ success: true });
const DELIVER_ENV = { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat', TELEGRAM_NOTIFY_FORCE_RESULT: FORCE_SUCCESS };

test('BL-423: an expired timed pause auto-resumes - the marker clears and the resume is announced', async () => {
  const root = mkFixture({ active: true, untilMs: Date.now() - 1000 }, true);
  const result = await runCli(root, DELIVER_ENV);
  assert.equal(result.resumed, true);
  assert.equal(result.announced, true);
  assert.deepEqual(readControlPauseState(root), { active: false });
});

test('BL-423: a timed pause not yet due is left completely untouched', async () => {
  const root = mkFixture({ active: true, untilMs: Date.now() + 60_000 }, true);
  const result = await runCli(root, DELIVER_ENV);
  assert.equal(result.resumed, false);
  assert.equal(result.reason, 'not-due');
  assert.deepEqual(readControlPauseState(root), { active: true, untilMs: readControlPauseState(root).untilMs });
});

test('BL-423: an "until I resume" pause (no untilMs) never auto-expires, however long it has been paused', async () => {
  const root = mkFixture({ active: true }, true);
  const result = await runCli(root, DELIVER_ENV);
  assert.equal(result.resumed, false);
  assert.equal(result.reason, 'not-due');
  assert.deepEqual(readControlPauseState(root), { active: true, untilMs: undefined });
});

test('BL-423: no pause marker at all is a safe no-op', async () => {
  const root = mkFixture(undefined, true);
  const result = await runCli(root, DELIVER_ENV);
  assert.equal(result.resumed, false);
  assert.equal(result.reason, 'not-due');
});

test('BL-423: an already-resumed (inactive) marker is a safe no-op', async () => {
  const root = mkFixture({ active: false }, true);
  const result = await runCli(root, DELIVER_ENV);
  assert.equal(result.resumed, false);
  assert.equal(result.reason, 'not-due');
});

test('BL-423: an expired pause still clears the marker even with no Telegram config - never leaves the swarm frozen on a config gap', async () => {
  const root = mkFixture({ active: true, untilMs: Date.now() - 1000 }, true);
  const result = await runCli(root, {});
  assert.equal(result.resumed, true);
  assert.equal(result.announced, false);
  assert.equal(result.reason, 'missing-telegram-config');
  assert.deepEqual(readControlPauseState(root), { active: false });
});

test('BL-423: an expired pause still clears the marker even before the Control topic has ever been created', async () => {
  const root = mkFixture({ active: true, untilMs: Date.now() - 1000 }, false);
  const result = await runCli(root, DELIVER_ENV);
  assert.equal(result.resumed, true);
  assert.equal(result.announced, false);
  assert.deepEqual(readControlPauseState(root), { active: false });
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const root = mkFixture({ active: true, untilMs: Date.now() - 1000 }, true);
  const result = runCliSubprocess(root, DELIVER_ENV);
  assert.equal(result.resumed, true);
  assert.equal(result.announced, true);
});
