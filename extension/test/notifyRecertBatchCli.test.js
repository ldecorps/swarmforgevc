const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { main } = require('../out/tools/notify-recert-batch');

const CLI = path.join(__dirname, '..', 'out', 'tools', 'notify-recert-batch.js');
const STATE_PATH = (root) => path.join(root, '.swarmforge', 'operator', 'recert-notify-state.json');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-notify-recert-'));
}
function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}
function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// Mirrors recertificationStore.test.js's own fixture exactly - a real git
// repo with a real backlog ticket carrying two Gherkin scenarios, one of
// which was never reviewed (so computeRecertBatch finds a real, non-empty
// batch of size 1, the same shape QA's own E2E procedure asks for).
function mkFixtureWithWaitingBatch(pwaBaseUrl) {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);

  mkdirp(path.join(root, 'backlog', 'active'));
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', 'BL-900.yaml'),
    'id: BL-900\ntitle: t\nstatus: active\nmilestone: M1\nacceptance: |\n  # BL-900 scen-01\n  Scenario: first\n    Given a\n'
  );
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n`);
  if (pwaBaseUrl) {
    mkdirp(path.join(root, 'swarmforge'));
    fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), `config pwa_base_url ${pwaBaseUrl}\n`);
  }
  return root;
}

function mkEmptyFixture() {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  mkdirp(path.join(root, 'backlog', 'active'));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n`);
  return root;
}

// An explicit ALLOWLIST env, never {...process.env, ...overrides} - this
// box's own shell exports the REAL Telegram bot token globally (see
// mergedCodeReachesDaemonsSteps.js's own identical fixtureEnv() posture),
// and TELEGRAM_NOTIFY_FORCE_RESULT means no real network call ever
// happens anyway, but the token itself must still never leak into a test
// subprocess's environment.
function runCliSubprocess(root, overrides = {}) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, ...overrides };
  const output = execFileSync('node', [CLI], { encoding: 'utf8', cwd: root, env });
  return JSON.parse(output);
}

// Runs the REAL main() in-process against a real fixture repo/env, so
// in-process coverage and mutation tooling can see the branches a
// subprocess-only smoke test cannot (the engineering article's CLI
// main()-thin-wrapper rule). Same allowlist-env posture as
// runCliSubprocess above - never {...process.env, ...overrides}.
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
const FORCE_FAILURE = JSON.stringify({ success: false, error: 'simulated network failure' });

// ── BL-339: a waiting batch is announced, once ────────────────────────────

test('BL-339-01/02: a waiting batch is announced with a deep link straight into the recert work', async () => {
  const root = mkFixtureWithWaitingBatch('https://example.github.io/dashboard/');
  const result = await runCli(root, {
    TELEGRAM_BOT_TOKEN: 'fake-token',
    TELEGRAM_CHAT_ID: 'fake-chat',
    TELEGRAM_NOTIFY_FORCE_RESULT: FORCE_SUCCESS,
  });
  assert.equal(result.sent, true);
  assert.equal(result.batchSize, 1);
});

test('BL-339-03: an outstanding batch is not re-announced on the next tick', async () => {
  const root = mkFixtureWithWaitingBatch('https://example.github.io/dashboard/');
  const env = { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat', TELEGRAM_NOTIFY_FORCE_RESULT: FORCE_SUCCESS };
  const first = await runCli(root, env);
  assert.equal(first.sent, true);
  const second = await runCli(root, env);
  assert.equal(second.sent, false);
  assert.equal(second.reason, 'already-announced');
});

test('BL-339-05: nothing is announced when no recert batch is waiting', async () => {
  const root = mkEmptyFixture();
  const result = await runCli(root, { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat' });
  assert.equal(result.sent, false);
  assert.equal(result.batchSize, 0);
  assert.equal(result.reason, 'no-batch-waiting');
});

test('a cleared-then-returned batch is announced again (re-arms on the next edge)', async () => {
  // selectForRecertification (recertification.ts) ALWAYS returns up to
  // batchSize from whatever recertifiable pool exists, oldest-reviewed-
  // first - marking a scenario "reviewed" only reorders it, it never
  // empties the pool. The pool only genuinely empties when there are no
  // recertifiable (tagged) scenarios left at all - simulated here by
  // rewriting the ticket to drop its Gherkin scenario entirely, the real
  // mechanism that produces batchSize: 0.
  const root = mkFixtureWithWaitingBatch('https://example.github.io/dashboard/');
  const env = { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat', TELEGRAM_NOTIFY_FORCE_RESULT: FORCE_SUCCESS };
  await runCli(root, env); // announces, arms

  fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-900.yaml'), 'id: BL-900\ntitle: t\nstatus: active\nmilestone: M1\n');
  const cleared = await runCli(root, env);
  assert.equal(cleared.batchSize, 0);
  assert.equal(cleared.sent, false);
  const state = JSON.parse(fs.readFileSync(STATE_PATH(root), 'utf8'));
  assert.deepEqual(state.announcedIds, []);

  fs.writeFileSync(
    path.join(root, 'backlog', 'active', 'BL-900.yaml'),
    'id: BL-900\ntitle: t\nstatus: active\nmilestone: M1\nacceptance: |\n  # BL-900 scen-01\n  Scenario: first\n    Given a\n'
  );
  const returned = await runCli(root, env);
  assert.equal(returned.batchSize, 1);
  assert.equal(returned.sent, true);
});

test('recert-notify-deep-link-06: a genuinely new batch (different scenario, same size) after the prior one is answered is announced again', async () => {
  // The pool never empties via review-marking (selectForRecertification
  // always returns up to batchSize from the whole pool, oldest-reviewed-
  // first) - answering scen-01 through the PWA just rotates scen-02 to the
  // front. Same batch SIZE, different scenario identity - still a real
  // "new batch" the human hasn't seen yet.
  const root = mkFixtureWithWaitingBatch('https://example.github.io/dashboard/');
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', 'BL-900.yaml'),
    'id: BL-900\ntitle: t\nstatus: active\nmilestone: M1\nacceptance: |\n  # BL-900 scen-01\n  Scenario: first\n    Given a\n\n  # BL-900 scen-02\n  Scenario: second\n    Given b\n'
  );
  const env = { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat', TELEGRAM_NOTIFY_FORCE_RESULT: FORCE_SUCCESS };
  const first = await runCli(root, env);
  assert.equal(first.sent, true);
  assert.equal(first.batchSize, 1);

  fs.writeFileSync(
    path.join(root, '.swarmforge', 'recert-state.json'),
    JSON.stringify({ schemaVersion: 1, scenarios: { 'BL-900/scen-01': { lastReviewedIso: '2026-07-01T00:00:00Z' } } })
  );

  const second = await runCli(root, env);
  assert.equal(second.sent, true);
  assert.equal(second.batchSize, 1);
});

// ── BL-345's own lesson, reapplied: arm on delivery, never on attempt ─────

test('a failed send leaves the state UNARMED, so the next tick retries', async () => {
  const root = mkFixtureWithWaitingBatch('https://example.github.io/dashboard/');
  const env = { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat', TELEGRAM_NOTIFY_FORCE_RESULT: FORCE_FAILURE };
  const first = await runCli(root, env);
  assert.equal(first.sent, false);
  const state = fs.existsSync(STATE_PATH(root)) ? JSON.parse(fs.readFileSync(STATE_PATH(root), 'utf8')) : { announcedIds: [] };
  assert.deepEqual(state.announcedIds, []);
  // The next tick retries - it must attempt again, not treat the failed send as delivered.
  const retryEnv = { ...env, TELEGRAM_NOTIFY_FORCE_RESULT: FORCE_SUCCESS };
  const second = await runCli(root, retryEnv);
  assert.equal(second.sent, true);
});

test('missing Telegram config never arms - the next tick retries once configured', async () => {
  const root = mkFixtureWithWaitingBatch('https://example.github.io/dashboard/');
  const result = await runCli(root, {});
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'missing-telegram-config');
  const state = fs.existsSync(STATE_PATH(root)) ? JSON.parse(fs.readFileSync(STATE_PATH(root), 'utf8')) : { announcedIds: [] };
  assert.deepEqual(state.announcedIds, []);
});

test('with no pwa_base_url configured, the announcement still sends, just without a deep link', async () => {
  const root = mkFixtureWithWaitingBatch(undefined);
  const result = await runCli(root, { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat', TELEGRAM_NOTIFY_FORCE_RESULT: FORCE_SUCCESS });
  assert.equal(result.sent, true);
});

// A single subprocess smoke test locks the compiled CLI's own wiring
// (require.main === module, real argv/env boundary) - an ADDITION to the
// in-process tests above, never the only cover for the real logic.
test('the compiled CLI runs standalone as a subprocess and produces the same result', () => {
  const root = mkFixtureWithWaitingBatch('https://example.github.io/dashboard/');
  const result = runCliSubprocess(root, {
    TELEGRAM_BOT_TOKEN: 'fake-token',
    TELEGRAM_CHAT_ID: 'fake-chat',
    TELEGRAM_NOTIFY_FORCE_RESULT: FORCE_SUCCESS,
  });
  assert.equal(result.sent, true);
  assert.equal(result.batchSize, 1);
});
