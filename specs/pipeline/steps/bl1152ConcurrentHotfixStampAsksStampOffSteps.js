'use strict';

// BL-1152: stamp-off of Cursor hotfix 7380d80686. Confirms concurrent
// hotfix stamp Yes/No asks via hotfix-stamp-asks.json and hotfix_ledger_update
// — never reimplements; never writes Hotfix-Certification certified.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'BL-1152 stamp-off of Cursor hotfix 7380d80686';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HOTFIX = '7380d80686';
const BOT_SRC = 'extension/src/tools/telegram-front-desk-bot.ts';
const CLI_TEST = path.join(REPO_ROOT, 'extension', 'test', 'telegramFrontDeskBotCli.test.js');

function gitShow(rev, file) {
  return execFileSync('git', ['show', `${rev}:${file}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
}

function loadBotSrc(ctx) {
  if (ctx.botSrc) {
    return ctx.botSrc;
  }
  const tipType = execFileSync('git', ['cat-file', '-t', HOTFIX], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
  assert.equal(tipType, 'commit', `hotfix ${HOTFIX} must be reachable`);
  ctx.botSrc = gitShow(HOTFIX, BOT_SRC);
  execFileSync(
    'git',
    ['diff', '--quiet', `${HOTFIX}:${BOT_SRC}`, `HEAD:${BOT_SRC}`],
    { cwd: REPO_ROOT }
  );
  return ctx.botSrc;
}

function runBl1152UnitTests() {
  const result = spawnSync(
    'npx',
    ['vitest', 'run', 'test/telegramFrontDeskBotCli.test.js', '-t', 'BL-1152'],
    { encoding: 'utf8', cwd: path.join(REPO_ROOT, 'extension'), timeout: 120000 }
  );
  if (result.status !== 0) {
    throw new Error(
      `BL-1152 unit tests failed (exit ${result.status}):\n${result.stdout}\n${result.stderr}`
    );
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^bl1152ConcurrentHotfixStampAsksStampOffSteps acceptance handler is registered$/, () => {
    const idx = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    assert.ok(
      idx.includes('bl1152ConcurrentHotfixStampAsksStampOffSteps'),
      'expected bl1152ConcurrentHotfixStampAsksStampOffSteps registered in index.js'
    );
  });

  scoped(
    /^the source of extension\/src\/tools\/telegram-front-desk-bot\.ts at commit 7380d80686$/,
    (ctx) => {
      loadBotSrc(ctx);
    }
  );

  scoped(/^a hotfix-stamp-asks\.json entry keyed by threadId "hotfix-<commit>"$/, (ctx) => {
    ctx.hotfixThread = 'hotfix-7380d80686';
    ctx.hotfixOptions = [{ label: 'Yes — certify' }, { label: 'No — waive' }];
    ctx.fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1152-stamp-'));
    const operatorDir = path.join(ctx.fixtureRoot, '.swarmforge', 'operator');
    fs.mkdirSync(operatorDir, { recursive: true });
    fs.writeFileSync(
      path.join(operatorDir, 'hotfix-stamp-asks.json'),
      JSON.stringify({ [ctx.hotfixThread]: { options: ctx.hotfixOptions } })
    );
    // Stale global slot must not match — proves hotfix path is independent.
    fs.writeFileSync(
      path.join(operatorDir, 'awaiting-answer.json'),
      JSON.stringify({
        question: 'other ask',
        thread_id: 'SUP-99',
        options: [{ label: 'wrong' }],
      })
    );
  });

  scoped(/^resolveAskOptions is called with that threadId$/, (ctx) => {
    const { resolveAskOptions } = require(path.join(REPO_ROOT, 'extension', 'out', 'tools', 'telegram-front-desk-bot'));
    ctx.resolvedOptions = resolveAskOptions(ctx.fixtureRoot, ctx.hotfixThread);
    runBl1152UnitTests();
  });

  scoped(/^it returns that entry's options$/, (ctx) => {
    assert.deepEqual(ctx.resolvedOptions, ctx.hotfixOptions);
  });

  scoped(/^it does not require awaiting-answer\.json to match the threadId$/, (ctx) => {
    const src = loadBotSrc(ctx);
    assert.match(src, /hotfix-stamp-asks\.json/);
    assert.match(src, /threadId\.startsWith\('hotfix-'\)/);
    const awaiting = JSON.parse(
      fs.readFileSync(path.join(ctx.fixtureRoot, '.swarmforge', 'operator', 'awaiting-answer.json'), 'utf8')
    );
    assert.notEqual(awaiting.thread_id, ctx.hotfixThread);
    assert.deepEqual(ctx.resolvedOptions, ctx.hotfixOptions);
    try {
      fs.rmSync(ctx.fixtureRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    ctx.fixtureRoot = undefined;
  });

  scoped(/^a poll answer is posted for subjectId "hotfix-<commit>" with label Yes or No$/, (ctx) => {
    const src = loadBotSrc(ctx);
    ctx.botSrc = src;
  });

  scoped(/^applyHotfixStampAnswer runs hotfix_ledger_update --decide for that commit$/, (ctx) => {
    const src = loadBotSrc(ctx);
    assert.match(src, /function applyHotfixStampAnswer/);
    assert.match(src, /hotfix_ledger_update\.bb/);
    assert.match(src, /--decide/);
    assert.match(src, /spawnSync\('bb'/);
  });

  scoped(/^the answer is not forwarded to the bridge as an ordinary ask reply$/, (ctx) => {
    const src = loadBotSrc(ctx);
    assert.match(src, /function postToBridgeOrHotfixStamp/);
    assert.match(src, /subjectId\.startsWith\('hotfix-'\)/);
    assert.match(src, /return applyHotfixStampAnswer/);
    assert.doesNotMatch(
      src.match(/async function postToBridgeOrHotfixStamp[\s\S]*?^}/m)?.[0] || '',
      /postToBridge\([\s\S]*hotfix-/
    );
  });

  scoped(/^resolveAskOptions is called with a non-hotfix threadId$/, (ctx) => {
    ctx.fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl1152-ordinary-'));
    const operatorDir = path.join(ctx.fixtureRoot, '.swarmforge', 'operator');
    fs.mkdirSync(operatorDir, { recursive: true });
    fs.writeFileSync(
      path.join(operatorDir, 'awaiting-answer.json'),
      JSON.stringify({
        question: 'which env?',
        thread_id: 'SUP-1',
        options: [{ label: 'staging' }, { label: 'prod' }],
      })
    );
    const { resolveAskOptions } = require(path.join(REPO_ROOT, 'extension', 'out', 'tools', 'telegram-front-desk-bot'));
    ctx.ordinaryOptions = resolveAskOptions(ctx.fixtureRoot, 'SUP-1');
  });

  scoped(
    /^it still resolves options from awaiting-answer\.json when the thread matches$/,
    (ctx) => {
      assert.deepEqual(ctx.ordinaryOptions, [{ label: 'staging' }, { label: 'prod' }]);
    }
  );

  scoped(/^postToBridge is used for non-hotfix subject ids$/, (ctx) => {
    const src = loadBotSrc(ctx);
    const helper = src.match(/async function postToBridgeOrHotfixStamp[\s\S]*?^}/m)?.[0] || '';
    assert.match(helper, /return postToBridge\(/);
    try {
      if (ctx.fixtureRoot) {
        fs.rmSync(ctx.fixtureRoot, { recursive: true, force: true });
      }
    } catch {
      /* ignore */
    }
  });
}

module.exports = { registerSteps };
