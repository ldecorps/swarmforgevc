'use strict';

// BL-1713: step handlers for "The land step never blesses a commit
// carrying none of the ticket's own work". Drives the REAL
// swarmforge/scripts/land_step_cli.bb against a real fixture repository (a
// main checkout plus a linked worktree, never the live checkout - BL-1390)
// - never a reimplementation of land-plan's own citation or range checks.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = "BL-1713 The land step never blesses a commit carrying none of the ticket's own work";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LAND_STEP_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_cli.bb');

const TASK = 'BL-9701-fixture';
const A_ID = 'BL-9701';
const A_PATH = 'a.txt';
const A_LANDING_SUBJECT = `${A_ID}: add A's own file`;
const REGISTER_PATH = 'backlog/standing-reds.tsv';

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function head(root) {
  return git(root, 'rev-parse', 'HEAD');
}

function commitFile(root, rel, body, message) {
  const fs = require('node:fs');
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
}

function markOriginMain(root) {
  git(root, 'update-ref', 'refs/remotes/origin/main', head(root));
}

function registerRow() {
  return `unit\tfile-${A_ID}.test.js\t${A_ID}\t2026-09-01\tnote\n`;
}

// Background: a "main checkout" whose own HEAD sits AT origin/main (the
// repo-root every scenario passes as the third CLI argument, mirroring the
// shared master checkout QA cited on 2026-09-24), plus a LINKED worktree
// ("the QA worktree") whose own tip carries A's own landing commit - every
// scenario invokes the CLI with this worktree as the process's own cwd
// (BL-1713 invariant 2's own "caller's checkout"), so a relative citation
// like HEAD resolves differently there than in the main checkout, while a
// full sha resolves identically in both (FIRM, approval_context).
function buildFixture(ctx) {
  const work = mkSocketFixtureRoot('bl1713-fixture-');
  const mainCheckout = path.join(work, 'main-checkout');
  execFileSync('git', ['init', '-q', '-b', 'main', mainCheckout]);
  git(mainCheckout, 'config', 'user.email', 't@t');
  git(mainCheckout, 'config', 'user.name', 't');
  git(mainCheckout, 'config', 'commit.gpgsign', 'false');

  // The standing-red register row A owns, seeded on origin/main and left
  // untouched by A's own commit below - the land step itself is what must
  // retire it (BL-1631's own mechanism, exercised by scenario 02).
  commitFile(mainCheckout, REGISTER_PATH, `# header\n${registerRow()}`, 'seed the standing-red register');
  const originMainSha = head(mainCheckout);
  markOriginMain(mainCheckout);

  const qaWorktree = path.join(work, 'qa-worktree');
  git(mainCheckout, 'worktree', 'add', '-q', qaWorktree, '-b', 'qa-tip', originMainSha);

  commitFile(qaWorktree, A_PATH, 'a\n', A_LANDING_SUBJECT);
  const landingSha = head(qaWorktree);

  // An untagged bystander commit, sibling to A's own (off origin/main
  // directly, never an ancestor of landingSha) - built via a throwaway
  // detached checkout in the SAME worktree so mainCheckout's own HEAD is
  // never disturbed, then the worktree is returned to its real tip.
  git(qaWorktree, 'checkout', '-q', '--detach', originMainSha);
  git(qaWorktree, 'commit', '-q', '--allow-empty', '-m', 'a bystander change with no ticket id');
  const untaggedSha = head(qaWorktree);
  git(qaWorktree, 'checkout', '-q', 'qa-tip');

  ctx.mainCheckout = mainCheckout;
  ctx.qaWorktree = qaWorktree;
  ctx.originMainSha = originMainSha;
  ctx.landingSha = landingSha;
  ctx.untaggedSha = untaggedSha;
}

const CITATIONS = {
  HEAD: (ctx) => 'HEAD',
  "origin/main's full sha": (ctx) => ctx.originMainSha,
  'the full sha of a tip whose only new commit names no ticket': (ctx) => ctx.untaggedSha,
  "the QA worktree tip's full sha": (ctx) => ctx.landingSha,
};

function runLandStep(ctx, citationKey) {
  const resolve = CITATIONS[citationKey];
  assert.ok(resolve, `bl1713: unrecognized citation "${citationKey}"`);
  const citedSha = resolve(ctx);
  ctx.bl1713CitedSha = citedSha;
  const result = spawnSync('bb', [LAND_STEP_CLI, TASK, citedSha === 'HEAD' ? 'HEAD' : citedSha, ctx.mainCheckout], {
    cwd: ctx.qaWorktree,
    encoding: 'utf8',
  });
  ctx.bl1713Result = { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
  ctx.bl1713BranchesBefore = git(ctx.mainCheckout, 'branch', '--list', 'land-replay*');
  ctx.bl1713WorktreesBefore = git(ctx.mainCheckout, 'worktree', 'list');
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture origin with a main checkout at origin\/main and a QA worktree whose tip carries ticket A's own commit and a standing-red register row owned by A$/,
    (ctx) => {
      buildFixture(ctx);
    },
  );

  // ── Scenario Outline 01 / Scenario 02 share this When (same step text
  // shape, a different cited-commit literal each time) ────────────────
  scoped(
    /^the land step CLI is run from the QA worktree for A's land citing "(.+)" with the main checkout as repo root$/,
    (ctx, citationKey) => {
      runLandStep(ctx, citationKey);
    },
  );

  // ── Scenario Outline 01 ──────────────────────────────────────────────
  scoped(/^it prints LAND_ESCALATE naming (.+)$/, (ctx, reasonKey) => {
    const { status, stdout, stderr } = ctx.bl1713Result;
    assert.equal(status, 1, `expected exit 1, got ${status}: ${stdout}${stderr}`);
    assert.match(stdout, /^LAND_ESCALATE$/m, `expected a LAND_ESCALATE line, got:\n${stdout}`);
    const reasonLine = stdout.split('\n').find((l) => l && !l.startsWith('LAND_ESCALATE'));
    assert.ok(reasonLine, `expected a reason line after LAND_ESCALATE, got:\n${stdout}`);

    if (reasonKey === 'both commits HEAD resolves to') {
      assert.ok(
        reasonLine.includes(ctx.originMainSha) && reasonLine.includes(ctx.landingSha),
        `expected the reason to name both ${ctx.originMainSha} and ${ctx.landingSha}, got: ${reasonLine}`,
      );
    } else if (reasonKey === 'A and the range from origin/main') {
      assert.ok(reasonLine.includes(A_ID), `expected the reason to name ${A_ID}, got: ${reasonLine}`);
      const expectedRange = `${ctx.originMainSha}..${ctx.bl1713CitedSha}`;
      assert.ok(
        reasonLine.includes(expectedRange),
        `expected the reason to name the range ${expectedRange}, got: ${reasonLine}`,
      );
    } else {
      throw new Error(`bl1713: unrecognized reason "${reasonKey}"`);
    }
  });

  scoped(/^the land step built no commit and created no branch$/, (ctx) => {
    const branchesAfter = git(ctx.mainCheckout, 'branch', '--list', 'land-replay*');
    assert.equal(branchesAfter, ctx.bl1713BranchesBefore, `expected no new land-replay branch, got:\n${branchesAfter}`);
    const worktreesAfter = git(ctx.mainCheckout, 'worktree', 'list');
    assert.equal(worktreesAfter, ctx.bl1713WorktreesBefore, `expected no new worktree, got:\n${worktreesAfter}`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(
    /^it prints LAND_CLEAN with a built commit whose diff against origin\/main names A's own path$/,
    (ctx) => {
      const { status, stdout, stderr } = ctx.bl1713Result;
      assert.equal(status, 0, `expected exit 0, got ${status}: ${stdout}${stderr}`);
      const match = /^LAND_CLEAN (\S+)$/m.exec(stdout);
      assert.ok(match, `expected a LAND_CLEAN line, got:\n${stdout}`);
      ctx.bl1713BuiltCommit = match[1];
      const names = git(ctx.mainCheckout, 'diff', '--name-only', 'origin/main', ctx.bl1713BuiltCommit)
        .split('\n')
        .filter(Boolean);
      assert.ok(names.includes(A_PATH), `expected the built commit's diff to include ${A_PATH}, got: ${JSON.stringify(names)}`);
    },
  );

  scoped(/^that built commit retires the register row owned by A$/, (ctx) => {
    assert.ok(
      ctx.bl1713Result.stdout.includes(`REGISTER_ROW_RETIRED ${REGISTER_PATH}`) &&
        ctx.bl1713Result.stdout.includes(A_ID),
      `expected a REGISTER_ROW_RETIRED line naming ${A_ID}, got: ${ctx.bl1713Result.stdout}`,
    );
    const content = git(ctx.mainCheckout, 'show', `${ctx.bl1713BuiltCommit}:${REGISTER_PATH}`);
    assert.ok(
      !content.includes(registerRow().trim()),
      `expected the built commit's ${REGISTER_PATH} to lack A's row, got:\n${content}`,
    );
  });
}

module.exports = { registerSteps };
