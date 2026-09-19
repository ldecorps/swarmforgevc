'use strict';

// BL-1646: step handlers for "The register guard judges ledger rows
// through the register's join and only rows the commit authors". Drives
// the REAL check_standing_red_register.sh against a real git fixture
// (BL-1390: mkProcessTmpDir, never the live checkout) - the same
// "shell out to the real guard" convention this repo's own commit-guard
// acceptance handlers use (see test_ticket_deletion_guard.sh's sibling
// feature handlers), since the defect lives in the guard's own git/diff
// plumbing.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = "BL-1646 The register guard judges ledger rows through the register's join and only rows the commit authors";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_standing_red_register.sh');

// The one file_set shared by every ledger row this fixture ever writes -
// "the ledger row's file set" the feature's own Given steps refer to as a
// single, already-established thing.
const FILE_SET = 'fixture/file.js';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function appendLedgerRow(root, parcel, fileSet) {
  fs.appendFileSync(
    path.join(root, 'backlog', 'hardening-debt-ledger.yaml'),
    `- parcel: ${parcel}\n  gate: mutation\n  file_set: ${fileSet}\n  reason: "fixture"\n  detected_at: 2026-01-01\n`
  );
}

function appendRegisterOwner(root, ticket, fileSet) {
  fs.appendFileSync(
    path.join(root, 'backlog', 'standing-reds.tsv'),
    `hardening\t${fileSet}\t${ticket}\t2026-01-01\tfixture owner row\n`
  );
}

function runGuard(root) {
  try {
    const out = execFileSync('bash', [GUARD], { cwd: root, encoding: 'utf8' });
    return { status: 0, output: out };
  } catch (err) {
    return { status: err.status ?? 1, output: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

function ensureState(ctx) {
  if (ctx.bl1646) return ctx.bl1646;
  const root = mkProcessTmpDir('bl1646acc-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@test']);
  git(root, ['config', 'user.name', 'test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'done'), { recursive: true });
  fs.writeFileSync(path.join(root, 'backlog', 'paused', 'BL-4343-owner.yaml'), 'id: BL-4343\n');
  fs.writeFileSync(path.join(root, 'backlog', 'hardening-debt-ledger.yaml'), '');
  fs.writeFileSync(path.join(root, 'backlog', 'standing-reds.tsv'), '');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  git(root, ['branch', 'role']);

  // main gains the BL-4242 ledger row AFTER role forked - the real
  // false-positive shape (a branch that forked before a parcel's own
  // deferred-gate row existed).
  appendLedgerRow(root, 'BL-4242', FILE_SET);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'main: add BL-4242 ledger row']);

  ctx.bl1646 = { root };
  return ctx.bl1646;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(
    /^a git fixture with a main branch and a role branch forked before main gained a hardening-debt ledger row for parcel BL-4242$/,
    (ctx) => {
      ensureState(ctx);
    }
  );

  scoped(/^on main the ticket BL-4242 is closed$/, (ctx) => {
    const { root } = ensureState(ctx);
    fs.writeFileSync(path.join(root, 'backlog', 'done', 'BL-4242-fixture.yaml'), 'id: BL-4242\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'main: close BL-4242']);
  });

  scoped(/^the real guard runs from the fixture root on the staged commit$/, () => {
    // Setup marker only - the real invocation happens in the When steps.
  });

  // ── Given: register ownership state ──────────────────────────────────
  scoped(
    /^the staged register names the open paused ticket BL-4343 as owner of the ledger row's file set in the hardening lane$/,
    (ctx) => {
      // Applied to BOTH branches: a later "merge of main" scenario needs it
      // on main to inherit it, and a later "linear commit on role" scenario
      // needs it already on role's own tree - this Given step's own text
      // doesn't say which, so both are made true.
      const { root } = ensureState(ctx);
      for (const branch of ['main', 'role']) {
        git(root, ['checkout', '-q', branch]);
        appendRegisterOwner(root, 'BL-4343', FILE_SET);
        git(root, ['add', '-A']);
        git(root, ['commit', '-q', '-m', `${branch}: BL-4343 owns the ledger row's file_set via the register`]);
      }
    }
  );

  scoped(/^the staged register names no owner for any hardening row$/, () => {
    // Nothing to add - main's register stays empty of hardening rows.
  });

  // ── When ──────────────────────────────────────────────────────────────
  scoped(/^the role branch stages a merge of main$/, (ctx) => {
    const { root } = ensureState(ctx);
    git(root, ['checkout', '-q', 'role']);
    try {
      git(root, ['merge', '-q', '--no-ff', '--no-commit', 'main']);
    } catch {
      /* nothing further staged by the merge itself for these fixtures */
    }
    ctx.bl1646.result = runGuard(root);
  });

  scoped(
    /^the role branch stages a merge of main and adds a ledger row for the closed parcel BL-4444 present in neither parent$/,
    (ctx) => {
      const { root } = ensureState(ctx);
      git(root, ['checkout', '-q', 'role']);
      try {
        git(root, ['merge', '-q', '--no-ff', '--no-commit', 'main']);
      } catch {
        /* nothing further staged by the merge itself for these fixtures */
      }
      appendLedgerRow(root, 'BL-4444', FILE_SET);
      git(root, ['add', '-A']);
      ctx.bl1646.result = runGuard(root);
    }
  );

  scoped(/^the role branch stages a linear commit adding a ledger row for the closed parcel BL-4444$/, (ctx) => {
    const { root } = ensureState(ctx);
    git(root, ['checkout', '-q', 'role']);
    appendLedgerRow(root, 'BL-4444', FILE_SET);
    git(root, ['add', '-A']);
    ctx.bl1646.result = runGuard(root);
  });

  scoped(/^the role branch stages a linear commit adding a register row naming the closed ticket BL-4242$/, (ctx) => {
    const { root } = ensureState(ctx);
    git(root, ['checkout', '-q', 'role']);
    appendRegisterOwner(root, 'BL-4242', 'some/other/path.js');
    git(root, ['add', '-A']);
    ctx.bl1646.result = runGuard(root);
  });

  // ── Then ──────────────────────────────────────────────────────────────
  scoped(/^the guard passes$/, (ctx) => {
    assert.equal(ctx.bl1646.result.status, 0, `expected the guard to pass: ${ctx.bl1646.result.output}`);
  });

  scoped(/^the guard refuses naming the (BL-\d+) row$/, (ctx, ticket) => {
    assert.notEqual(ctx.bl1646.result.status, 0, `expected the guard to refuse: ${ctx.bl1646.result.output}`);
    assert.match(
      ctx.bl1646.result.output,
      new RegExp(ticket),
      `expected refusal to name ${ticket}: ${ctx.bl1646.result.output}`
    );
  });
}

module.exports = { registerSteps };
