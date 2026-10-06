'use strict';

// BL-1782: step handlers for "Hand verifications are recorded in a
// verification-debt ledger". Drives the REAL
// verification_debt_ledger_update.bb / verification_debt_ledger_read.bb
// CLIs against a real fixture git repository (mkdtemp, BL-1390) - never a
// reimplementation of the ledger's validation, idempotence, or ownership
// logic. Scenario 06 alone reads the repository's OWN ledger, no fixture.

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

const FEATURE = 'BL-1782 Hand verifications are recorded in a verification-debt ledger';

let trackedRoots = [];
function __bl1659Dispose_bl1782() {
  while (trackedRoots.length) {
    fs.rmSync(trackedRoots.pop(), { recursive: true, force: true });
  }
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function mkFixtureRepo(ctx) {
  ctx.__disposables = ctx.__disposables || [];
  ctx.__disposables.push(__bl1659Dispose_bl1782);
  const root = trackedTmpRoot('sfvc-bl1782-');
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

let seq = 0;
function rid() {
  seq += 1;
  return `BL-9${String(seq).padStart(3, '0')}`;
}

function runUpdate(root, args) {
  return spawnSync('bb', [UPDATE_CLI, root, '--record', ...args], { encoding: 'utf8' });
}

function record(root, { category, ticket, role, description, on }) {
  const args = [category, '--ticket', ticket, '--role', role, '--description', description];
  if (on) {
    args.push('--on', on);
  }
  return runUpdate(root, args);
}

function readLedger(root) {
  const result = execFileSync('bb', [READ_CLI, root], { encoding: 'utf8' });
  return JSON.parse(result);
}

function commitCountForLedger(root) {
  const out = git(root, 'log', '--oneline', '--', LEDGER_RELPATH);
  return out === '' ? 0 : out.split('\n').length;
}

function seedDistinctRows(root, category, count) {
  const tickets = [];
  for (let i = 0; i < count; i += 1) {
    const ticket = rid();
    tickets.push(ticket);
    const res = record(root, { category, ticket, role: 'QA', description: `prior check ${i + 1}`, on: '2026-09-26' });
    assert.equal(res.status, 0, `seed record failed: ${res.stdout}${res.stderr}`);
  }
  return tickets;
}

function writeConf(root, threshold) {
  // BL-1782 QA bounce D1: swarmforge.conf always lives at
  // <root>/swarmforge/swarmforge.conf (mutation_cooldown_gate.bb,
  // swarm_identity_lib.bb) - a root-level file is dead config nothing
  // reads.
  const dir = path.join(root, 'swarmforge');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'swarmforge.conf'), `config verification_debt_threshold ${threshold}\n`);
}

function ticketYamlPath(root, folder, ticket) {
  return path.join(root, folder, `${ticket}-fixture.yaml`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a fixture git repository with backlog\/paused, backlog\/active and backlog\/done and no verification-debt ledger$/, (ctx) => {
    ctx.root = mkFixtureRepo(ctx);
  });

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(
    /^"([^"]+)" records a hand verification in category "([^"]+)" for ticket "([^"]+)" described as "([^"]*)" on "([^"]+)"$/,
    (ctx, role, category, ticket, description, on) => {
      ctx.category = category;
      ctx.ticket = ticket;
      ctx.role = role;
      ctx.description = description;
      ctx.on = on;
      ctx.result = record(ctx.root, { category, ticket, role, description, on });
    }
  );

  // ── Scenario 05 malformed variant (no "on" clause) ──────────────────
  scoped(
    /^"([^"]+)" records a hand verification in category "([^"]*)" for ticket "([^"]*)" described as "([^"]*)"$/,
    (ctx, role, category, ticket, description) => {
      ctx.category = category;
      ctx.ticket = ticket;
      ctx.role = role;
      ctx.description = description;
      ctx.result = record(ctx.root, { category, ticket, role, description });
    }
  );

  scoped(/^the recorder exits 0$/, (ctx) => {
    assert.equal(ctx.result.status, 0, `expected exit 0, got ${ctx.result.status}: ${ctx.result.stdout}${ctx.result.stderr}`);
  });

  scoped(
    /^the ledger committed at HEAD carries one row for category "([^"]+)" and ticket "([^"]+)" naming role "([^"]+)", that description and date "([^"]+)"$/,
    (ctx, category, ticket, role, date) => {
      const committedText = git(ctx.root, 'show', `HEAD:${LEDGER_RELPATH.split(path.sep).join('/')}`);
      const workingText = fs.readFileSync(path.join(ctx.root, LEDGER_RELPATH), 'utf8');
      assert.equal(committedText.trim(), workingText.trim(), 'ledger on disk must match what is committed at HEAD');
      const ledger = readLedger(ctx.root);
      const rows = ledger.categories[category].rows;
      assert.equal(rows.length, 1, `expected exactly one row, got: ${JSON.stringify(rows)}`);
      const row = rows[0];
      assert.equal(row.ticket, ticket);
      assert.equal(row.role, role);
      assert.equal(row.description, ctx.description);
      assert.equal(row.detected_at, date);
    }
  );

  scoped(/^the reader reports category "([^"]+)" with count (\d+) and threshold (\d+)$/, (ctx, category, count, threshold) => {
    const ledger = readLedger(ctx.root);
    const entry = ledger.categories[category];
    assert.ok(entry, `expected a categories entry for ${category}, got: ${JSON.stringify(ledger)}`);
    assert.equal(entry.count, Number(count));
    assert.equal(entry.threshold, Number(threshold));
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^"([^"]+)" has recorded category "([^"]+)" for ticket "([^"]+)"$/, (ctx, role, category, ticket) => {
    const res = record(ctx.root, { category, ticket, role, description: 'grepped the paths', on: '2026-09-26' });
    assert.equal(res.status, 0, `background record failed: ${res.stdout}${res.stderr}`);
    ctx.category = category;
    ctx.ticket = ticket;
  });

  scoped(/^the recorder exits 0 and prints "([^"]+)"$/, (ctx, expected) => {
    assert.equal(ctx.result.status, 0, `expected exit 0, got ${ctx.result.status}: ${ctx.result.stdout}${ctx.result.stderr}`);
    assert.ok(ctx.result.stdout.includes(expected), `expected stdout to include "${expected}", got: ${ctx.result.stdout}`);
  });

  // ── Scenario 03 (Outline) ────────────────────────────────────────────
  scoped(/^swarmforge\.conf sets verification_debt_threshold to "([^"]+)"$/, (ctx, conf) => {
    if (conf !== '(none)') {
      writeConf(ctx.root, conf);
    }
  });

  scoped(/^category "([^"]+)" has rows for (\d+) distinct tickets$/, (ctx, category, prior) => {
    ctx.category = category;
    ctx.priorTickets = seedDistinctRows(ctx.root, category, Number(prior));
  });

  scoped(/^a role records category "([^"]+)" for one more ticket$/, (ctx, category) => {
    ctx.category = category;
    const ticket = rid();
    ctx.result = record(ctx.root, { category, ticket, role: 'QA', description: 'one more check', on: '2026-09-26' });
  });

  scoped(/^the reader (lists|does not list) "([^"]+)" as unowned$/, (ctx, mode, category) => {
    const ledger = readLedger(ctx.root);
    const isListed = ledger.unowned.includes(category);
    assert.equal(isListed, mode === 'lists', `unowned=${JSON.stringify(ledger.unowned)}`);
  });

  scoped(/^the recorder (prints|does not print) "([^"]+)"$/, (ctx, mode, expected) => {
    const includes = ctx.result.stdout.includes(expected);
    assert.equal(includes, mode === 'prints', `stdout was: ${ctx.result.stdout}`);
  });

  // ── Scenario 04 (Outline) ────────────────────────────────────────────
  scoped(/^ticket "([^"]+)" in "([^"]+)" carries the line "([^"]+)"$/, (ctx, ticket, folder, line) => {
    const yaml = `id: ${ticket}\ntitle: "fixture ticket"\n${line}\n`;
    fs.writeFileSync(ticketYamlPath(ctx.root, folder, ticket), yaml);
  });

  scoped(/^the reader runs$/, (ctx) => {
    ctx.ledger = readLedger(ctx.root);
  });

  scoped(/^the reader names owners "([^"]+)" for "([^"]+)"$/, (ctx, owners, category) => {
    const expected = owners === '(none)' ? [] : owners.split(',').map((s) => s.trim());
    const entry = ctx.ledger.categories[category];
    assert.deepEqual((entry && entry.owners) || [], expected);
  });

  // ── Scenario 05 (Outline) ────────────────────────────────────────────
  scoped(/^the recorder exits non-zero naming "([^"]+)"$/, (ctx, field) => {
    assert.notEqual(ctx.result.status, 0, `expected a non-zero exit, got 0: ${ctx.result.stdout}`);
    assert.ok(ctx.result.stderr.includes(field), `expected stderr to name "${field}", got: ${ctx.result.stderr}`);
  });

  scoped(/^no verification-debt ledger commit exists at HEAD$/, (ctx) => {
    assert.equal(commitCountForLedger(ctx.root), 0);
  });

  // ── Scenario 06 ──────────────────────────────────────────────────────
  scoped(/^the repository's own verification-debt ledger$/, (ctx) => {
    ctx.root = REPO_ROOT;
  });

  scoped(/^it carries rows in category "([^"]+)" for tickets "([^"]+)"$/, (ctx, category, tickets) => {
    const expected = tickets.split(',').map((s) => s.trim());
    const ledger = readLedger(ctx.root);
    const entry = ledger.categories[category];
    assert.ok(entry, `expected a categories entry for ${category}, got: ${JSON.stringify(ledger)}`);
    const actualTickets = entry.rows.map((r) => r.ticket);
    for (const t of expected) {
      assert.ok(actualTickets.includes(t), `expected ${category} to carry a row for ${t}, got: ${JSON.stringify(actualTickets)}`);
    }
  });
}

module.exports = { registerSteps };
