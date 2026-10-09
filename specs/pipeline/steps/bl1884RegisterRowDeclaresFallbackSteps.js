'use strict';

// BL-1884: step handlers for "A new standing-red row declares why its red
// was not hotfixed". Drives the REAL check_standing_red_register.sh
// against a real git fixture (BL-1390: mkProcessTmpDir, never the live
// checkout) - the same "shell out to the real guard" convention this
// repo's own commit-guard acceptance handlers use (see
// bl1646RegisterGuardLedgerJoinSteps.js), since the defect lives in the
// guard's own git/diff plumbing.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkProcessTmpDir } = require('../../../extension/test/helpers/tmpDir');

const FEATURE = "BL-1884 A new standing-red row declares why its red was not hotfixed";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const GUARD = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'check_standing_red_register.sh');

const OWNER = 'BL-5000';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function appendRegisterRow(root, lane, file, ticket) {
  fs.appendFileSync(
    path.join(root, 'backlog', 'standing-reds.tsv'),
    `${lane}\t${file}\t${ticket}\t2026-10-01\tfixture\n`
  );
}

function writeOwnerTicket(root, content) {
  fs.writeFileSync(path.join(root, 'backlog', 'paused', `${OWNER}-owner.yaml`), content);
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
  if (ctx.bl1884) return ctx.bl1884;
  const root = mkProcessTmpDir('bl1884acc-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@test']);
  git(root, ['config', 'user.name', 'test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'done'), { recursive: true });
  // The open owner ticket the register's own row names - no fallback
  // declared yet; each scenario's Given step rewrites it as needed.
  writeOwnerTicket(root, `id: ${OWNER}\n`);
  fs.writeFileSync(path.join(root, 'backlog', 'standing-reds.tsv'), '');
  fs.writeFileSync(path.join(root, 'backlog', 'hardening-debt-ledger.yaml'), '');
  fs.mkdirSync(path.join(root, 'swarmforge', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'swarmforge', 'scripts', 'property_suite_standing_allowlist.tsv'), 'file\tdisposition\trationale\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  git(root, ['branch', 'role']);
  ctx.bl1884 = { root };
  return ctx.bl1884;
}

function stageAndRun(ctx) {
  const { root } = ensureState(ctx);
  git(root, ['checkout', '-q', 'role']);
  git(root, ['add', '-A']);
  ctx.bl1884.result = runGuard(root);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ────────────────────────────────────────────────────────
  scoped(/^a fixture repository with the standing-red register guard and an open owner ticket$/, (ctx) => {
    ensureState(ctx);
  });

  // ── Given: owner ticket declarations ──────────────────────────────────
  scoped(/^the owner ticket declares hotfix_fallback multi-sitting with a reason$/, (ctx) => {
    const { root } = ensureState(ctx);
    writeOwnerTicket(root, `id: ${OWNER}\nhotfix_fallback: multi-sitting\nhotfix_fallback_reason: "the fix needs a second sitting"\n`);
  });

  scoped(/^the owner ticket declares no hotfix_fallback$/, (ctx) => {
    const { root } = ensureState(ctx);
    writeOwnerTicket(root, `id: ${OWNER}\n`);
  });

  // Scenario Outline: the owner ticket <declaration>
  scoped(/^the owner ticket (.+)$/, (ctx, declaration) => {
    const { root } = ensureState(ctx);
    switch (declaration) {
      case 'declares no hotfix_fallback':
        writeOwnerTicket(root, `id: ${OWNER}\n`);
        break;
      case 'declares hotfix_fallback needs-ruling without ruling_options':
        writeOwnerTicket(root, `id: ${OWNER}\nhotfix_fallback: needs-ruling\n`);
        break;
      case 'declares hotfix_fallback multi-sitting without a reason':
        writeOwnerTicket(root, `id: ${OWNER}\nhotfix_fallback: multi-sitting\n`);
        break;
      default:
        throw new Error(`unknown declaration "${declaration}"`);
    }
  });

  // ── Given: pre-existing register row (scenario 03) ────────────────────
  scoped(/^the register on main holds a row whose owner declares no hotfix_fallback$/, (ctx) => {
    const { root } = ensureState(ctx);
    git(root, ['checkout', '-q', 'main']);
    appendRegisterRow(root, 'unit', 'preexisting.test.js', OWNER);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'main: pre-existing register row']);
  });

  // ── When ──────────────────────────────────────────────────────────────
  scoped(/^a commit adds a register row naming that owner$/, (ctx) => {
    const { root } = ensureState(ctx);
    git(root, ['checkout', '-q', 'role']);
    appendRegisterRow(root, 'unit', 'newred.test.js', OWNER);
    stageAndRun(ctx);
  });

  scoped(/^a commit adds a hardening-lane register row naming that owner$/, (ctx) => {
    const { root } = ensureState(ctx);
    git(root, ['checkout', '-q', 'role']);
    appendRegisterRow(root, 'hardening', 'newred.test.js', OWNER);
    stageAndRun(ctx);
  });

  scoped(/^a commit changes another file$/, (ctx) => {
    const { root } = ensureState(ctx);
    git(root, ['checkout', '-q', 'role']);
    fs.writeFileSync(path.join(root, 'README-unrelated.md'), 'unrelated change\n');
    stageAndRun(ctx);
  });

  // ── Then ──────────────────────────────────────────────────────────────
  scoped(/^the commit is accepted$/, (ctx) => {
    assert.equal(ctx.bl1884.result.status, 0, `expected the guard to pass: ${ctx.bl1884.result.output}`);
  });

  scoped(/^the commit is refused naming the row and the owner's missing fallback$/, (ctx) => {
    assert.notEqual(ctx.bl1884.result.status, 0, `expected the guard to refuse: ${ctx.bl1884.result.output}`);
    assert.match(ctx.bl1884.result.output, /newred\.test\.js/, `expected the refusal to name the row: ${ctx.bl1884.result.output}`);
    assert.match(ctx.bl1884.result.output, /hotfix_fallback/, `expected the refusal to name the missing fallback: ${ctx.bl1884.result.output}`);
  });
}

module.exports = { registerSteps };
