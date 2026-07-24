const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main } = require('../out/tools/apply-cooldown-pause');
const { controlPauseStatePath, readControlPauseState } = require('../out/tools/telegram-front-desk-bot');
const { cooldownWindowMarkerPath, readCooldownWindowMarker } = require('../out/tools/cooldownWindowState');

const CLI = path.join(__dirname, '..', 'out', 'tools', 'apply-cooldown-pause.js');
const TOPIC_MAP_PATH = (root) => path.join(root, '.swarmforge', 'operator', 'telegram-topic-map.json');

function mkTmp() {
  return mkTmpDir('sfvc-apply-cooldown-pause-');
}
function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}
function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// 2026-07-24 is a Friday; used as a fixed baseline so "local" times resolve
// deterministically regardless of which day the suite runs on.
function localMs(monthDay, hhmm) {
  const [hour, minute] = hhmm.split(':').map(Number);
  return new Date(2026, 6, monthDay, hour, minute, 0, 0).getTime();
}

function mkFixture({ confLines, pauseMarker, windowMarker, bindControlTopic } = {}) {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  mkdirp(path.join(root, '.swarmforge', 'operator'));
  mkdirp(path.join(root, 'swarmforge'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `coder\tmaster\t${root}\tswarmforge-coder\tcoder\tclaude\ttask\n`);
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    confLines ?? 'config cooldown_window_enabled true\nconfig cooldown_start_local 19:00\nconfig cooldown_end_local 07:00\n'
  );
  if (pauseMarker !== undefined) {
    fs.writeFileSync(controlPauseStatePath(root), JSON.stringify(pauseMarker));
  }
  if (windowMarker !== undefined) {
    fs.writeFileSync(cooldownWindowMarkerPath(root), JSON.stringify(windowMarker));
  }
  if (bindControlTopic) {
    fs.writeFileSync(TOPIC_MAP_PATH(root), JSON.stringify({ '900': 'CONTROL' }));
  }
  return root;
}

const NOTIFY_ENV_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_NOTIFY_FORCE_RESULT'];

// Runs the REAL main() in-process against a real fixture repo/env, mirroring
// resumeExpiredPausesCli.test.js's own identical seam (the CLI main()-thin-
// wrapper rule) - never the only cover for the real logic.
async function runCli(root, argv, overrides = {}) {
  const originalCwd = process.cwd;
  const originalArgv = process.argv;
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
    process.argv = ['node', 'apply-cooldown-pause.js', ...argv];
    await main();
  } finally {
    process.stdout.write = originalWrite;
    process.cwd = originalCwd;
    process.argv = originalArgv;
    for (const key of NOTIFY_ENV_KEYS) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  }
  return JSON.parse(writes.join(''));
}

function runCliSubprocess(root, argv, overrides = {}) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, ...overrides };
  const output = execFileSync('node', [CLI, ...argv], { encoding: 'utf8', cwd: root, env });
  return JSON.parse(output);
}

const FORCE_SUCCESS = JSON.stringify({ success: true });
const DELIVER_ENV = { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat', TELEGRAM_NOTIFY_FORCE_RESULT: FORCE_SUCCESS };

test('BL-617 window-open-applies-timed-pause-01: applies a timed pause via the existing pause state file', async () => {
  const root = mkFixture({});
  const result = await runCli(root, ['--now', String(localMs(24, '19:03'))], DELIVER_ENV);
  assert.equal(result.decision, 'apply-pause');
  assert.equal(result.untilMs, localMs(25, '07:00'));
  assert.deepEqual(readControlPauseState(root), { active: true, untilMs: localMs(25, '07:00') });
});

test('BL-617: --dry-run reports the decision without writing any state', async () => {
  const root = mkFixture({});
  const before = readControlPauseState(root);
  const result = await runCli(root, ['--now', String(localMs(24, '19:03')), '--dry-run'], DELIVER_ENV);
  assert.equal(result.decision, 'apply-pause');
  assert.equal(result.dryRun, true);
  assert.deepEqual(readControlPauseState(root), before);
  assert.deepEqual(readCooldownWindowMarker(root), { lastHandledWindowStartMs: undefined });
});

test('BL-617 human-pause-at-window-open-untouched-04: an active human pause is never overridden', async () => {
  const root = mkFixture({ pauseMarker: { active: true, untilMs: localMs(24, '20:00') } });
  const result = await runCli(root, ['--now', String(localMs(24, '19:03'))], DELIVER_ENV);
  assert.equal(result.decision, 'none');
  assert.deepEqual(readControlPauseState(root), { active: true, untilMs: localMs(24, '20:00') });
});

test('BL-617 human-resume-now-during-window-wins-06: a consumed window never re-applies', async () => {
  const root = mkFixture({ windowMarker: { lastHandledWindowStartMs: localMs(24, '19:00') } });
  const result = await runCli(root, ['--now', String(localMs(24, '21:05'))], DELIVER_ENV);
  assert.equal(result.decision, 'none');
});

test('BL-617 disabled-config-no-pause-08: a disabled cooldown window never pauses', async () => {
  const root = mkFixture({ confLines: 'config cooldown_window_enabled false\n' });
  const result = await runCli(root, ['--now', String(localMs(24, '19:30'))], DELIVER_ENV);
  assert.equal(result.decision, 'none');
  assert.deepEqual(readControlPauseState(root), { active: false });
});

test('BL-617 malformed-config-no-pause-loud-09: malformed config disables the window and logs loudly', async () => {
  const root = mkFixture({
    confLines: 'config cooldown_window_enabled true\nconfig cooldown_start_local 25:99\n',
  });
  const originalErrWrite = process.stderr.write.bind(process.stderr);
  const errWrites = [];
  process.stderr.write = (chunk) => {
    errWrites.push(chunk);
    return true;
  };
  let result;
  try {
    result = await runCli(root, ['--now', String(localMs(24, '19:30'))], DELIVER_ENV);
  } finally {
    process.stderr.write = originalErrWrite;
  }
  assert.equal(result.decision, 'none');
  assert.match(result.warning, /malformed/i);
  assert.ok(errWrites.join('').match(/malformed/i), 'expected a loud stderr warning');
});

test('BL-617 default-times-apply-10: enabled with no times configured defaults to 19:00/07:00', async () => {
  const root = mkFixture({ confLines: 'config cooldown_window_enabled true\n' });
  const result = await runCli(root, ['--now', String(localMs(24, '19:03'))], DELIVER_ENV);
  assert.equal(result.decision, 'apply-pause');
  assert.equal(result.untilMs, localMs(25, '07:00'));
});

test('BL-617 pause-announcement-posted-13: applying the pause announces it to the Control topic', async () => {
  const root = mkFixture({ bindControlTopic: true });
  const result = await runCli(root, ['--now', String(localMs(24, '19:03'))], DELIVER_ENV);
  assert.equal(result.decision, 'apply-pause');
  assert.equal(result.announced, true);
});

test('BL-617 pause-applies-without-telegram-14: a missing Telegram configuration never blocks the pause itself', async () => {
  const root = mkFixture({ bindControlTopic: true });
  const result = await runCli(root, ['--now', String(localMs(24, '19:03'))], {});
  assert.equal(result.decision, 'apply-pause');
  assert.equal(result.announced, false);
  assert.equal(result.reason, 'missing-telegram-config');
  assert.deepEqual(readControlPauseState(root), { active: true, untilMs: localMs(25, '07:00') });
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const root = mkFixture({});
  const result = runCliSubprocess(root, ['--now', String(localMs(24, '19:03'))], DELIVER_ENV);
  assert.equal(result.decision, 'apply-pause');
  assert.equal(result.untilMs, localMs(25, '07:00'));
});
