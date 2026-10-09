'use strict';

// BL-2017: step handlers for "A verification-debt settle that cannot be
// grounded is refused and writes nothing" - the five refusal rows of
// BL-1783's scenario 03. Drives the REAL verification_debt_ledger_update.bb
// CLI against a real fixture git repository (mkdtemp, BL-1390) - never a
// reimplementation of the ledger's validation. A refusal that does not
// name its reason would be a BL-2015 defect; this handler only gates it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const UPDATE_CLI = path.join(SCRIPTS_DIR, 'verification_debt_ledger_update.bb');
const LEDGER_RELPATH = path.join('backlog', 'verification-debt-ledger.yaml');

const FEATURE = "BL-2017 A verification-debt settle that cannot be grounded is refused";

let trackedRoots = [];
function __bl1659Dispose_bl2017() {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function mkFixtureRepo(ctx) {
  ctx.__disposables = ctx.__disposables || [];
  ctx.__disposables.push(__bl1659Dispose_bl2017);
  const root = trackedTmpRoot('sfvc-bl2017-');
  trackedRoots.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'done'), { recursive: true });
  fs.writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'seed fixture repo');
  return root;
}

function runUpdate(root, args) {
  return spawnSync('bb', [UPDATE_CLI, root, ...args], { encoding: 'utf8' });
}

function record(root, { category, ticket, role, description, on }) {
  const args = [category, '--ticket', ticket, '--role', role, '--description', description];
  if (on) {
    args.push('--on', on);
  }
  return runUpdate(root, ['--record', ...args]);
}

function ledgerHead(root) {
  return git(root, 'log', '-1', '--format=%H', '--', LEDGER_RELPATH);
}

function settleArgs(argumentsText) {
  // The step splits <arguments> on spaces; the token BLANK stands for an
  // empty argument (a --reason of "").
  return argumentsText.split(' ').map((token) => (token === 'BLANK' ? '' : token));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(new RegExp("^a fixture git repository whose verification-debt ledger has rows in category \"land-path-ownership\" for tickets \"BL-9001, BL-9002, BL-9003\"$"), (ctx) => {
    ctx.root = mkFixtureRepo(ctx);
    for (const ticket of ['BL-9001', 'BL-9002', 'BL-9003']) {
      const res = record(ctx.root, { category: 'land-path-ownership', ticket, role: 'QA', description: 'prior check', on: '2026-09-26' });
      assert.equal(res.status, 0, `background record failed: ${res.stdout}${res.stderr}`);
    }
  });

  scoped(new RegExp("^rows in category \"other-check\" for tickets \"BL-9001, BL-9002\"$"), (ctx) => {
    for (const ticket of ['BL-9001', 'BL-9002']) {
      const res = record(ctx.root, { category: 'other-check', ticket, role: 'QA', description: 'prior check', on: '2026-09-26' });
      assert.equal(res.status, 0, `background record failed: ${res.stdout}${res.stderr}`);
    }
  });

  scoped(new RegExp("^the committed file \"backlog/evidence/BL-9200-tool\\.md\"$"), (ctx) => {
    const dir = path.join(ctx.root, 'backlog', 'evidence');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'BL-9200-tool.md'), 'the tool that makes the check mechanical\n');
    git(ctx.root, 'add', '-A');
    git(ctx.root, 'commit', '-q', '-m', 'add committed evidence file');
  });

  // ── Scenario 03 (the five refusal rows) ──────────────────────────────
  scoped(new RegExp("^a settle command runs with \"(.+?)\"$"), (ctx, p1) => {
    ctx.ledgerBefore = ledgerHead(ctx.root);
    ctx.result = runUpdate(ctx.root, settleArgs(p1));
  });

  scoped(new RegExp("^the settle command exits non-zero naming \"(.+?)\"$"), (ctx, p1) => {
    assert.notEqual(ctx.result.status, 0, `expected a non-zero exit, got 0: ${ctx.result.stdout}${ctx.result.stderr}`);
    assert.ok(ctx.result.stderr.includes(p1), `expected stderr to name "${p1}", got: ${ctx.result.stderr}`);
  });

  scoped(new RegExp("^the verification-debt ledger at HEAD is unchanged$"), (ctx) => {
    assert.equal(ledgerHead(ctx.root), ctx.ledgerBefore, 'the ledger\'s last commit must be the same before and after the refused settle');
  });

}

module.exports = { registerSteps };
