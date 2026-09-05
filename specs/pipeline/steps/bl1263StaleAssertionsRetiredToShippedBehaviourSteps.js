'use strict';

// BL-1263: step handlers driving the REAL three test files and the REAL
// compiled sources they exercise - never a reimplementation of either.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');

const SITES = {
  'an unqualified model id': {
    file: 'test/backendSwitch.test.js',
    testName: 'readRoleModelId prefers cursor-agent launch script over stale claude settings file',
    shippedExpectation: 'cursor/auto',
    retiredExpectation: "'auto'",
  },
  'a poll body without the multi-answer key': {
    file: 'test/telegramClient.test.js',
    testName: 'sendTelegramPoll posts a native poll to the Telegram API and reports success with the poll id',
    shippedExpectation: 'allows_multiple_answers',
    retiredExpectation: null,
  },
  'an ambulance engaged from paused': {
    file: 'test/telegramCursorOperatorExec.test.js',
    testName: 'BL-698: ambulance engage and release via execute',
    shippedExpectation: "'backlog', 'active'",
    retiredExpectation: "'backlog', 'paused'",
  },
};

function extractTestBody(text, testName) {
  const marker = `test('${testName}'`;
  const start = text.indexOf(marker);
  if (start === -1) throw new Error(`test "${testName}" not found`);
  const end = text.indexOf("\n});", start);
  if (end === -1) throw new Error(`closing "});" for test "${testName}" not found`);
  return text.slice(start, end);
}

function runVitest(file, testName) {
  const args = ['vitest', 'run', file];
  if (testName) args.push('-t', testName);
  const res = spawnSync('npx', args, { cwd: EXTENSION_DIR, encoding: 'utf8' });
  return { out: `${res.stdout || ''}${res.stderr || ''}`, status: res.status };
}

const FEATURE = 'BL-1263 three assertions are retired to the behaviour that shipped, and none is weakened on the way';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a source behaviour that changed deliberately and is still correct$/, (ctx) => {
    ctx.bl1263 = {};
  });

  // ── Scenario 01 (Outline) ────────────────────────────────────────────
  scoped(/^the assertion that expects (.+)$/, (ctx, retiredExpectation) => {
    const site = SITES[retiredExpectation];
    assert.ok(site, `unknown <retired expectation>: ${retiredExpectation}`);
    ctx.bl1263.site = site;
    const fullText = fs.readFileSync(path.join(EXTENSION_DIR, site.file), 'utf8');
    ctx.bl1263.text = extractTestBody(fullText, site.testName);
  });

  scoped(/^the assertion is retired to the shipped behaviour$/, (ctx) => {
    if (ctx.bl1263.site.retiredExpectation) {
      assert.ok(
        !ctx.bl1263.text.includes(ctx.bl1263.site.retiredExpectation),
        `expected the retired expectation (${ctx.bl1263.site.retiredExpectation}) to no longer be asserted within "${ctx.bl1263.site.testName}"`
      );
    }
  });

  scoped(/^it expects (.+)$/, (ctx, shippedBehaviour) => {
    assert.ok(
      ctx.bl1263.text.includes(ctx.bl1263.site.shippedExpectation),
      `expected ${ctx.bl1263.site.file} to assert the shipped behaviour (${ctx.bl1263.site.shippedExpectation}) for "${shippedBehaviour}"`
    );
  });

  scoped(/^it passes against the current source$/, (ctx) => {
    const result = runVitest(ctx.bl1263.site.file, ctx.bl1263.site.testName);
    assert.equal(result.status, 0, `expected ${ctx.bl1263.site.file} to pass: ${result.out}`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  const TELEGRAM_CLIENT_TS = path.join(EXTENSION_DIR, 'src', 'notify', 'telegramClient.ts');

  scoped(/^the poll assertion compares the entire request body$/, (ctx) => {
    const testSrc = fs.readFileSync(path.join(EXTENSION_DIR, 'test', 'telegramClient.test.js'), 'utf8');
    assert.ok(
      /assert\.deepEqual\(parsed, \{[\s\S]*?allows_multiple_answers: false,/.test(testSrc),
      'expected a whole-body assert.deepEqual over parsed, including allows_multiple_answers'
    );
    ctx.bl1263.tsBackup = fs.readFileSync(TELEGRAM_CLIENT_TS, 'utf8');
  });

  scoped(/^an unexpected field is added to that body$/, (ctx) => {
    const mutated = ctx.bl1263.tsBackup.replace(
      'allows_multiple_answers: allowsMultipleAnswers,',
      'allows_multiple_answers: allowsMultipleAnswers,\n    an_unannounced_field: true,'
    );
    assert.notEqual(mutated, ctx.bl1263.tsBackup, 'expected the mutation to actually change the source');
    fs.writeFileSync(TELEGRAM_CLIENT_TS, mutated, 'utf8');
    const compile = spawnSync('npm', ['run', 'compile'], { cwd: EXTENSION_DIR, encoding: 'utf8' });
    assert.equal(compile.status, 0, `expected the mutated source to compile: ${compile.stdout}${compile.stderr}`);
    ctx.bl1263.mutatedResult = runVitest('test/telegramClient.test.js', 'sendTelegramPoll posts a native poll to the Telegram API and reports success with the poll id');
  });

  scoped(/^the assertion fails$/, (ctx) => {
    try {
      assert.notEqual(ctx.bl1263.mutatedResult.status, 0, 'expected the whole-body assertion to fail against an unannounced field');
    } finally {
      fs.writeFileSync(TELEGRAM_CLIENT_TS, ctx.bl1263.tsBackup, 'utf8');
      const restoredNow = fs.readFileSync(TELEGRAM_CLIENT_TS, 'utf8');
      assert.equal(restoredNow, ctx.bl1263.tsBackup, 'expected the source to be restored byte-identical');
      const recompile = spawnSync('npm', ['run', 'compile'], { cwd: EXTENSION_DIR, encoding: 'utf8' });
      assert.equal(recompile.status, 0, `expected the restored source to compile: ${recompile.stdout}${recompile.stderr}`);
    }
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  const THREE_TEST_FILES = ['test/backendSwitch.test.js', 'test/telegramClient.test.js', 'test/telegramCursorOperatorExec.test.js'];

  scoped(/^the parcel is reviewed$/, (ctx) => {
    ctx.bl1263.reviewResults = THREE_TEST_FILES.map((file) => ({ file, result: runVitest(file) }));
    const diff = spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' });
    ctx.bl1263.changedPaths = diff.stdout.split('\n').filter(Boolean);
  });

  scoped(/^every assertion that was red is present and passing$/, (ctx) => {
    for (const { file, result } of ctx.bl1263.reviewResults) {
      assert.equal(result.status, 0, `expected ${file} to pass: ${result.out}`);
    }
    for (const key of Object.keys(SITES)) {
      const site = SITES[key];
      const text = fs.readFileSync(path.join(EXTENSION_DIR, site.file), 'utf8');
      assert.ok(text.includes(site.testName), `expected ${site.file} to still contain the test "${site.testName}"`);
    }
  });

  scoped(/^no source file outside the three tests is modified$/, (ctx) => {
    const offenders = ctx.bl1263.changedPaths.filter(
      (p) => p.startsWith('extension/src/') || (p.startsWith('extension/test/') && !THREE_TEST_FILES.some((f) => p === `extension/${f}`))
    );
    assert.deepEqual(offenders, [], `expected no source/other-test changes, found: ${JSON.stringify(offenders)}`);
  });
}

module.exports = { registerSteps };
