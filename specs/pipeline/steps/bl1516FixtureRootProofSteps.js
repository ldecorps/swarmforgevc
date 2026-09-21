'use strict';

// BL-1516: step handlers for "a test fixture never reaches the live
// checkout". Drives the REAL test_bl1378_expedite_close_guard.sh's own
// prove_root/mk_fixture/unlanded_commit functions (via
// lib/bl1516FixtureRootProofCli.sh, which extracts them by source position,
// never retypes them), the REAL handoffd.bb probe placeholder (via
// lib/bl1516HandoffdProbePlaceholderCli.bb), and the REAL, edited
// run_bb_suite.sh (via lib/bl1516RunBbSuiteCensusCli.sh, against an isolated
// fixture checkout, never the live repository - BL-1390).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'BL-1516 a test fixture never reaches the live checkout';

const LIB_DIR = path.join(__dirname, 'lib');
const ROOT_PROOF_CLI = path.join(LIB_DIR, 'bl1516FixtureRootProofCli.sh');
const HANDOFFD_PROBE_CLI = path.join(LIB_DIR, 'bl1516HandoffdProbePlaceholderCli.bb');
const SUITE_CENSUS_CLI = path.join(LIB_DIR, 'bl1516RunBbSuiteCensusCli.sh');

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function initEnclosingRepo(root) {
  fs.mkdirSync(root, { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'seed');
}

function snapshotRepo(root) {
  return {
    head: git(root, 'rev-parse', 'HEAD'),
    branches: git(root, 'branch', '--list'),
    status: git(root, 'status', '--porcelain'),
  };
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(
    /^the BL-1378 fixture builder is given a root whose git common dir does not resolve under its TMPROOT$/,
    (ctx) => {
      const work = mkSocketFixtureRoot('bl1516-proof-');
      ctx.tmproot = path.join(work, 'tmproot');
      fs.mkdirSync(ctx.tmproot, { recursive: true });
      ctx.enclosing = path.join(work, 'enclosing');
      initEnclosingRepo(ctx.enclosing);
      ctx.before = snapshotRepo(ctx.enclosing);
      ctx.badRoot = true;
    },
  );

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^the BL-1378 fixture builder is given a fresh mkdtemp root$/, (ctx) => {
    const work = mkSocketFixtureRoot('bl1516-proof-');
    ctx.tmproot = path.join(work, 'tmproot');
    fs.mkdirSync(ctx.tmproot, { recursive: true });
    ctx.enclosing = path.join(work, 'enclosing');
    initEnclosingRepo(ctx.enclosing);
    ctx.before = snapshotRepo(ctx.enclosing);
    ctx.badRoot = false;
  });

  scoped(/^the fixture builder runs$/, (ctx) => {
    if (ctx.badRoot) {
      const result = spawnSync('bash', [ROOT_PROOF_CLI, 'bad-root', ctx.tmproot, ctx.enclosing], { encoding: 'utf8' });
      ctx.result = result;
    } else {
      const result = spawnSync('bash', [ROOT_PROOF_CLI, 'good-root', ctx.tmproot], { encoding: 'utf8' });
      ctx.result = result;
      ctx.fixtureRoot = (result.stdout || '').trim();
    }
  });

  scoped(/^it exits non-zero with one line naming that root$/, (ctx) => {
    assert.notEqual(ctx.result.status, 0, `expected a non-zero exit, got 0: ${ctx.result.stdout}${ctx.result.stderr}`);
    const combined = `${ctx.result.stdout}${ctx.result.stderr}`;
    const lines = combined.trim().split('\n');
    assert.equal(lines.length, 1, `expected exactly one line, got:\n${combined}`);
    assert.ok(lines[0].includes(ctx.enclosing), `expected the line to name ${ctx.enclosing}, got: ${lines[0]}`);
  });

  scoped(/^no branch, commit or index change exists in the enclosing repository$/, (ctx) => {
    const after = snapshotRepo(ctx.enclosing);
    assert.deepEqual(after, ctx.before, `expected the enclosing repository untouched, before=${JSON.stringify(ctx.before)} after=${JSON.stringify(after)}`);
  });

  scoped(/^the fixture repository is initialised under that root$/, (ctx) => {
    assert.equal(ctx.result.status, 0, `expected a clean exit, got ${ctx.result.status}: ${ctx.result.stderr}`);
    assert.ok(ctx.fixtureRoot, `expected a fixture root path printed, got: ${JSON.stringify(ctx.result)}`);
    assert.ok(ctx.fixtureRoot.startsWith(ctx.tmproot), `expected ${ctx.fixtureRoot} to sit under ${ctx.tmproot}`);
    const common = git(ctx.fixtureRoot, 'rev-parse', '--git-common-dir');
    assert.ok(common, `expected ${ctx.fixtureRoot} to be a real git repository`);
  });

  scoped(/^the enclosing repository is unchanged$/, (ctx) => {
    const after = snapshotRepo(ctx.enclosing);
    assert.deepEqual(after, ctx.before, `expected the enclosing repository untouched, before=${JSON.stringify(ctx.before)} after=${JSON.stringify(after)}`);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^handoffd\.bb is loaded under a probe with no root argument$/, (ctx) => {
    ctx.isolatedCwd = mkSocketFixtureRoot('bl1516-probe-');
  });

  scoped(/^post-qa-branch-sweep-tell is driven for a role$/, (ctx) => {
    const result = spawnSync('bb', [HANDOFFD_PROBE_CLI, ctx.isolatedCwd], { encoding: 'utf8', cwd: ctx.isolatedCwd });
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stdout}${result.stderr}`);
    ctx.probeResult = JSON.parse(result.stdout.trim().split('\n').pop());
  });

  scoped(/^no entry named "([^"]+)" exists at the top level of the current directory$/, (ctx, name) => {
    assert.equal(ctx.probeResult['probe-entry-exists-at-cwd?'], false, `expected no ${name} entry at ${ctx.isolatedCwd}, got: ${JSON.stringify(ctx.probeResult)}`);
    assert.ok(!fs.existsSync(path.join(ctx.isolatedCwd, name)), `expected ${name} absent from ${ctx.isolatedCwd}`);
  });

  scoped(/^the daemon log it wrote resolves to an absolute path outside the current directory$/, (ctx) => {
    const logFile = ctx.probeResult['log-file'];
    assert.ok(path.isAbsolute(logFile), `expected an absolute log path, got: ${logFile}`);
    assert.ok(!logFile.startsWith(ctx.isolatedCwd), `expected the log path outside ${ctx.isolatedCwd}, got: ${logFile}`);
  });

  // ── Scenario Outline 04 / Scenario 05 ─────────────────────────────────
  //
  // The Outline's Given text carries no <test> placeholder (only <entry>
  // does) - the test's own filename reaches this scenario only through the
  // Then step's own literal text. Rather than guess a filename from the
  // entry shape, this Given plants BOTH known planted-test shapes (the
  // sh one making "planted-entry", the bb one making "--planted-flag")
  // unconditionally; whichever Example row's Then step runs, its own
  // "test=<test> entry=<entry>" line is present among the (possibly two)
  // ROOT_POLLUTION_DETECTED lines the run produces.
  scoped(/^a checkout with a planted standing test that creates a top-level entry "([^"]+)"$/, (ctx) => {
    ctx.plantedSpec = ['test_planted.sh=planted-entry', 'test_planted_bb.bb=--planted-flag'];
  });

  scoped(/^a checkout whose standing tests leave no top-level entry behind$/, (ctx) => {
    ctx.plantedSpec = ['test_clean.sh=CLEAN', 'test_clean_bb.bb=CLEAN'];
  });

  scoped(/^run_bb_suite\.sh runs$/, (ctx) => {
    const result = spawnSync('bash', [SUITE_CENSUS_CLI, ...ctx.plantedSpec], { encoding: 'utf8' });
    ctx.suiteResult = result;
  });

  scoped(/^a line "ROOT_POLLUTION_DETECTED test=(\S+) entry=(\S+)" is printed$/, (ctx, testName, entry) => {
    const out = `${ctx.suiteResult.stdout}${ctx.suiteResult.stderr}`;
    assert.match(out, new RegExp(`^ROOT_POLLUTION_DETECTED test=${testName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} entry=${entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), `expected the ROOT_POLLUTION_DETECTED line, got:\n${out}`);
  });

  scoped(/^the runner exits non-zero although every test passed$/, (ctx) => {
    assert.notEqual(ctx.suiteResult.status, 0, `expected a non-zero exit, got 0: ${ctx.suiteResult.stdout}`);
    assert.match(ctx.suiteResult.stdout, /bb suite: \d+ passed, 0 failed/, `expected every planted test to have passed, got:\n${ctx.suiteResult.stdout}`);
  });

  scoped(/^no line starting "ROOT_POLLUTION_DETECTED" is printed$/, (ctx) => {
    const out = `${ctx.suiteResult.stdout}${ctx.suiteResult.stderr}`;
    assert.doesNotMatch(out, /^ROOT_POLLUTION_DETECTED/m, `expected no ROOT_POLLUTION_DETECTED line, got:\n${out}`);
  });

  scoped(/^the runner exits as it did before this ticket$/, (ctx) => {
    assert.equal(ctx.suiteResult.status, 0, `expected exit 0 for a clean run, got ${ctx.suiteResult.status}: ${ctx.suiteResult.stdout}${ctx.suiteResult.stderr}`);
  });
}

module.exports = { registerSteps };
