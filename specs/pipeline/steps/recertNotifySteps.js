'use strict';

// BL-339: step handlers for "Telegram tells the human a recert batch is
// waiting, and takes him to it". Drives the REAL compiled CLI
// (extension/out/tools/notify-recert-batch.js) against real git fixtures,
// mirroring notifyRecertBatchCli.test.js's own mkFixtureWithWaitingBatch/
// mkEmptyFixture pattern (same fixture shape, reused rather than
// reinvented) - TELEGRAM_NOTIFY_FORCE_RESULT means no real network call
// ever happens (BL-326: this project has already sent 136 real
// notifications by accident from a test run).
//
// Scenario 02's "following the link lands on the recert work" and
// scenario 07's "a verdict is still not accepted through Telegram" are
// scope-boundary checks against the real SOURCE (pwa/app.js's own
// #recert=1 hash-route wiring, and confirmScenario's own call sites) -
// there is no live PWA/Telegram round trip to drive here, so the real
// wiring itself is the evidence, matching mergedCodeReachesDaemonsSteps.js's
// own "grep the real output/source" posture.
//
// Scenario 03 ("one message, not one per scenario") drives the real
// buildRecertAnnouncementText directly with a 17-scenario count:
// production batch size is hardcoded to 1 everywhere
// (DEFAULT_RECERT_BATCH_SIZE, no config override), so a true 17-scenario
// CLI-level fixture is out of reach - the collapsing-to-one-message
// behavior is a pure property of this one function, and this is that
// function's real, compiled output.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'extension', 'out', 'tools', 'notify-recert-batch.js');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl339-acceptance-'));
}
function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}
function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

const SCENARIO_ONE = 'id: BL-900\ntitle: t\nstatus: active\nmilestone: M1\nacceptance: |\n  # BL-900 scen-01\n  Scenario: first\n    Given a\n';
const SCENARIO_ONE_AND_TWO =
  'id: BL-900\ntitle: t\nstatus: active\nmilestone: M1\nacceptance: |\n  # BL-900 scen-01\n  Scenario: first\n    Given a\n\n  # BL-900 scen-02\n  Scenario: second\n    Given b\n';

function mkFixtureWithWaitingBatch(pwaBaseUrl) {
  const root = mkTmp();
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 't@t']);
  git(root, ['config', 'user.name', 't']);
  mkdirp(path.join(root, 'backlog', 'active'));
  fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-900.yaml'), SCENARIO_ONE);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  mkdirp(path.join(root, '.swarmforge'));
  fs.writeFileSync(path.join(root, '.swarmforge', 'roles.tsv'), `specifier\tmaster\t${root}\tswarmforge-specifier\tSpecifier\tclaude\ttask\n`);
  mkdirp(path.join(root, 'swarmforge'));
  fs.writeFileSync(path.join(root, 'swarmforge', 'swarmforge.conf'), `config pwa_base_url ${pwaBaseUrl}\n`);
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

// Explicit ALLOWLIST env - this box's own shell exports the REAL Telegram
// bot token globally; TELEGRAM_NOTIFY_FORCE_RESULT means no real network
// call ever happens regardless, but the token must still never leak into a
// subprocess's environment (mirrors notifyRecertBatchCli.test.js's own
// runCli, and mergedCodeReachesDaemonsSteps.js's fixtureEnv()).
function runCli(root, overrides = {}) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, ...overrides };
  const output = execFileSync('node', [CLI], { encoding: 'utf8', cwd: root, env });
  return JSON.parse(output);
}

const FORCE_SUCCESS = JSON.stringify({ success: true, messageId: 1 });
const PWA_BASE_URL = 'https://example.github.io/dashboard/';
const DELIVER_ENV = { TELEGRAM_BOT_TOKEN: 'fake-token', TELEGRAM_CHAT_ID: 'fake-chat', TELEGRAM_NOTIFY_FORCE_RESULT: FORCE_SUCCESS };

// The same real, compiled modules the CLI itself calls - never a
// reimplementation - so the text asserted on here can never disagree with
// what the CLI would actually send.
function realAnnouncementText(root, batchSize) {
  const { readPwaBaseUrl, buildRecertDeepLink } = require(path.join(REPO_ROOT, 'extension', 'out', 'metrics', 'pwaDeepLinks'));
  const { buildRecertAnnouncementText } = require(path.join(REPO_ROOT, 'extension', 'out', 'notify', 'recertBatchNotifier'));
  const deepLink = buildRecertDeepLink(readPwaBaseUrl(root));
  return buildRecertAnnouncementText(batchSize, deepLink);
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^recertification verdicts are given in the PWA$/, () => {
    // Narrative only - the scope this whole ticket holds to (see
    // recert-notify-deep-link-07 below for the actual proof).
  });

  // ── recert-notify-deep-link-01 / -02 / -06 (shared Given/When/Then) ──
  registry.define(/^a recert batch is waiting on the human$/, (ctx) => {
    ctx.root = ctx.root || mkFixtureWithWaitingBatch(PWA_BASE_URL);
  });

  registry.define(/^the human is notified$/, (ctx) => {
    ctx.result = runCli(ctx.root, DELIVER_ENV);
  });

  registry.define(/^a message about the waiting batch is sent to Telegram$/, (ctx) => {
    assert.equal(ctx.result.sent, true, `expected the batch to be announced, got: ${JSON.stringify(ctx.result)}`);
  });

  // ── recert-notify-deep-link-02 ────────────────────────────────────────
  registry.define(/^the message links to the recert work in the PWA$/, (ctx) => {
    const text = realAnnouncementText(ctx.root, ctx.result.batchSize);
    assert.match(text, /#recert=1/, `expected the announcement to carry a #recert=1 deep link, got: ${text}`);
  });

  registry.define(/^following the link lands on the recert work$/, () => {
    // The link's own shape (a batch-level #recert=1 fragment) is covered
    // directly by pwaDeepLinks.test.js's buildRecertDeepLink tests - what
    // THIS proves is that the PWA side actually wired that fragment to
    // something real, by reading pwa/app.js's own real source (never
    // re-implemented here): the hash-route parse and the scroll-into-view
    // it drives, so a stale/decorative link would fail this check even
    // though the string itself still looked right.
    const appJs = fs.readFileSync(path.join(REPO_ROOT, 'pwa', 'app.js'), 'utf8');
    assert.match(appJs, /params\.get\('recert'\)/, "expected pwa/app.js to parse a #recert= hash param");
    assert.match(appJs, /getElementById\('recertSection'\)/, 'expected pwa/app.js to resolve the real recertSection element');
    assert.match(appJs, /section\.scrollIntoView\(\)/, 'expected pwa/app.js to scroll the recert section into view on a #recert= deep link');
  });

  // ── recert-notify-deep-link-03 ────────────────────────────────────────
  registry.define(/^a recert batch of many scenarios is waiting on the human$/, (ctx) => {
    ctx.root = mkFixtureWithWaitingBatch(PWA_BASE_URL);
    ctx.manyCount = 17;
  });

  registry.define(/^one message is sent$/, (ctx) => {
    const text = realAnnouncementText(ctx.root, ctx.manyCount);
    assert.equal(typeof text, 'string');
    assert.ok(text.split('\n').length <= 2, `expected a ${ctx.manyCount}-scenario batch to still be ONE short message, got: ${text}`);
    assert.match(text, new RegExp(`${ctx.manyCount} recert scenarios`), `expected the message to name the batch COUNT, not enumerate each scenario, got: ${text}`);
  });

  // ── recert-notify-deep-link-04 ────────────────────────────────────────
  registry.define(/^the batch has already been announced$/, (ctx) => {
    const first = runCli(ctx.root, DELIVER_ENV);
    assert.equal(first.sent, true, `setup: expected the first announcement to succeed, got: ${JSON.stringify(first)}`);
  });

  registry.define(/^the human is notified again$/, (ctx) => {
    ctx.result = runCli(ctx.root, DELIVER_ENV);
  });

  registry.define(/^no message is sent$/, (ctx) => {
    assert.equal(ctx.result.sent, false, `expected no announcement, got: ${JSON.stringify(ctx.result)}`);
  });

  // ── recert-notify-deep-link-05 ────────────────────────────────────────
  registry.define(/^no recert batch is waiting on the human$/, (ctx) => {
    ctx.root = mkEmptyFixture();
  });

  // ── recert-notify-deep-link-06 ────────────────────────────────────────
  registry.define(/^a recert batch has been announced and answered$/, (ctx) => {
    // Two recertifiable scenarios so the pool never truly empties -
    // answering scen-01 (simulated directly on the durable store, the
    // exact shape confirmScenario itself writes, mirroring
    // recertificationStore.test.js's own fixtures) just rotates scen-02 to
    // the front. Same batch SIZE, a genuinely different scenario identity.
    ctx.root = mkFixtureWithWaitingBatch(PWA_BASE_URL);
    fs.writeFileSync(path.join(ctx.root, 'backlog', 'active', 'BL-900.yaml'), SCENARIO_ONE_AND_TWO);
    const first = runCli(ctx.root, DELIVER_ENV);
    assert.equal(first.sent, true, `setup: expected the first announcement to succeed, got: ${JSON.stringify(first)}`);
    fs.writeFileSync(
      path.join(ctx.root, '.swarmforge', 'recert-state.json'),
      JSON.stringify({ schemaVersion: 1, scenarios: { 'BL-900/scen-01': { lastReviewedIso: '2026-07-01T00:00:00Z' } } })
    );
  });
  // ("a recert batch is waiting on the human" above is reused here as a
  // pure narrative continuation: ctx.root already exists by this point, so
  // it is a no-op - the rotated scen-02 batch this Given just armed IS the
  // "waiting" batch the Then step below proves gets announced again.)

  // ── recert-notify-deep-link-07 ────────────────────────────────────────
  registry.define(/^the human replies to the announcement with a verdict$/, () => {
    // Narrative only - there is no code path anywhere that reads an
    // inbound Telegram reply into a recert verdict (proved as an absence
    // below, not asserted against invented API surface).
  });

  registry.define(/^the verdict is not recorded from Telegram$/, () => {
    const callers = execFileSync('grep', ['-rln', 'confirmScenario(', path.join(REPO_ROOT, 'extension', 'src')], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((p) => path.basename(p));
    assert.deepEqual(
      callers,
      ['recertification.ts'],
      `expected confirmScenario's only caller to be recertification.ts itself (the email-verdict pipeline BL-223 built), got: ${callers.join(', ')}`
    );
    const cliSrc = fs.readFileSync(path.join(REPO_ROOT, 'extension', 'src', 'tools', 'notify-recert-batch.ts'), 'utf8');
    assert.ok(!/confirmScenario/.test(cliSrc), 'expected the Telegram notify CLI itself to never record a verdict - it only ever sends');
  });
}

module.exports = { registerSteps };
