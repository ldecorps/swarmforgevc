'use strict';

// BL-2015: step handlers for "A verification-debt category is discharged by
// a tool". Drives the REAL verification_debt_ledger_update.bb /
// verification_debt_ledger_read.bb CLIs against a real fixture git
// repository (mkdtemp, BL-1390) - never a reimplementation of the ledger's
// validation, idempotence, or ownership logic.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPTS_DIR = path.join(REPO_ROOT, 'swarmforge', 'scripts');
const UPDATE_CLI = path.join(SCRIPTS_DIR, 'verification_debt_ledger_update.bb');
const READ_CLI = path.join(SCRIPTS_DIR, 'verification_debt_ledger_read.bb');
const LEDGER_RELPATH = path.join('backlog', 'verification-debt-ledger.yaml');

const FEATURE = 'BL-2015 A verification-debt category is discharged by a tool';

let trackedRoots = [];
function __bl1659Dispose_bl2015() {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function mkFixtureRepo(ctx) {
  ctx.__disposables = ctx.__disposables || [];
  ctx.__disposables.push(__bl1659Dispose_bl2015);
  const root = trackedTmpRoot('sfvc-bl2015-');
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

function readLedger(root) {
  const result = execFileSync('bb', [READ_CLI, root], { encoding: 'utf8' });
  return JSON.parse(result);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a fixture git repository whose verification-debt ledger has rows in category "land-path-ownership" for tickets "BL-9001, BL-9002, BL-9003"$/, (ctx) => {
    ctx.root = mkFixtureRepo(ctx);
    for (const ticket of ['BL-9001', 'BL-9002', 'BL-9003']) {
      const res = record(ctx.root, { category: 'land-path-ownership', ticket, role: 'QA', description: 'prior check', on: '2026-09-26' });
      assert.equal(res.status, 0, `background record failed: ${res.stdout}${res.stderr}`);
    }
  });

  scoped(/^rows in category "other-check" for tickets "BL-9001, BL-9002"$/, (ctx) => {
    for (const ticket of ['BL-9001', 'BL-9002']) {
      const res = record(ctx.root, { category: 'other-check', ticket, role: 'QA', description: 'prior check', on: '2026-09-26' });
      assert.equal(res.status, 0, `background record failed: ${res.stdout}${res.stderr}`);
    }
  });

  scoped(/^the committed file "backlog\/evidence\/BL-9200-tool\.md"$/, (ctx) => {
    const dir = path.join(ctx.root, 'backlog', 'evidence');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'BL-9200-tool.md'), 'the tool that makes the check mechanical\n');
    git(ctx.root, 'add', '-A');
    git(ctx.root, 'commit', '-q', '-m', 'add committed evidence file');
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^"coder" discharges category "land-path-ownership" with evidence "backlog\/evidence\/BL-9200-tool\.md" on "2026-09-26"$/, (ctx) => {
    ctx.result = runUpdate(ctx.root, ['--discharge', 'land-path-ownership', '--by', 'coder', '--evidence', 'backlog/evidence/BL-9200-tool.md', '--on', '2026-09-26']);
  });

  scoped(/^the settle command exits 0$/, (ctx) => {
    assert.equal(ctx.result.status, 0, `expected exit 0, got ${ctx.result.status}: ${ctx.result.stdout}${ctx.result.stderr}`);
  });

  scoped(/^the ledger committed at HEAD still carries all 3 "land-path-ownership" rows, each with discharged_at "2026-09-26" and discharged_evidence "backlog\/evidence\/BL-9200-tool\.md"$/, (ctx) => {
    const committedText = git(ctx.root, 'show', `HEAD:${LEDGER_RELPATH.split(path.sep).join('/')}`);
    const workingText = fs.readFileSync(path.join(ctx.root, LEDGER_RELPATH), 'utf8');
    assert.equal(committedText.trim(), workingText.trim(), 'ledger on disk must match what is committed at HEAD');
    const ledger = readLedger(ctx.root);
    const rows = ledger.categories['land-path-ownership'].rows;
    assert.equal(rows.length, 3, `expected 3 rows, got: ${JSON.stringify(rows)}`);
    for (const row of rows) {
      assert.equal(row.discharged_at, '2026-09-26', `row ${row.ticket} discharged_at: ${JSON.stringify(row)}`);
      assert.equal(row.discharged_evidence, 'backlog/evidence/BL-9200-tool.md', `row ${row.ticket} discharged_evidence: ${JSON.stringify(row)}`);
    }
  });

  scoped(/^the reader reports category "land-path-ownership" with count 0 and does not list it as unowned$/, (ctx) => {
    const ledger = readLedger(ctx.root);
    const entry = ledger.categories['land-path-ownership'];
    assert.ok(entry, `expected a categories entry for land-path-ownership, got: ${JSON.stringify(ledger)}`);
    assert.equal(entry.count, 0);
    assert.ok(!ledger.unowned.includes('land-path-ownership'), `unowned=${JSON.stringify(ledger.unowned)}`);
  });

  scoped(/^the reader reports category "other-check" with count 2$/, (ctx) => {
    const ledger = readLedger(ctx.root);
    const entry = ledger.categories['other-check'];
    assert.ok(entry, `expected a categories entry for other-check, got: ${JSON.stringify(ledger)}`);
    assert.equal(entry.count, 2);
  });
}

module.exports = { registerSteps };
