'use strict';

// BL-1467: step handlers for "The post-land re-point keeps QA's bookkeeping
// for other tickets and names every commit it drops". Drives the REAL
// land_step_lib.bb/post-land-repoint! through `bb -e` against a real git
// fixture (mkdtemp, its own origin - BL-1390) - never a reimplementation of
// the classification, the reset, or the cherry-pick replay.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = "BL-1467 The post-land re-point keeps QA's bookkeeping for other tickets and names every commit it drops";

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_lib.bb');

const LANDED = 'BL-9678';
const OTHER = 'BL-9002';

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function commitFile(root, rel, body, message) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

function initRepo(root) {
  git(root, 'init', '-q', '-b', 'main', '.');
  git(root, 'config', 'user.email', 't@t');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  // post-land-repoint! writes .swarmforge/daemon/land-repoint.log -
  // excluded via .git/info/exclude (never gitignore'd content itself,
  // never committed - bl1446LandFixture.js's own convention) so it never
  // shows as an uncommitted change in a "the worktree is clean" check.
  const excludeFile = path.join(root, '.git', 'info', 'exclude');
  fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
  fs.appendFileSync(excludeFile, '\n.swarmforge/\n');
}

function bb(expr) {
  return execFileSync('bb', ['-e', expr], { encoding: 'utf8' }).trim();
}

function libExpr(body) {
  return `(require '[cheshire.core :as json])\n(load-file "${LIB}")\n${body}`;
}

function postLandRepoint(root, landedTaskTicketId) {
  const idForm = landedTaskTicketId ? `"${landedTaskTicketId}"` : 'nil';
  const out = bb(libExpr(
    `(println (json/generate-string (land-step-lib/post-land-repoint! {:root "${root}" :landed-task-ticket-id ${idForm}})))`,
  ));
  return JSON.parse(out.trim().split('\n').pop());
}

// Background: seed -> origin/main advances to the LANDED ticket's own
// (separately built) tip-pure content - a real land publishes under a NEW
// sha, never an ancestor of the QA branch's own history - while the local
// `main` (the QA-style branch) stays on its OWN line: seed -> the landed
// ticket's own parcel work -> whatever local-only commits each scenario
// adds on top. `ctx.root`/`ctx.originMainTip` are set here; each scenario's
// own Given adds its own local-only commit(s) before "the re-point runs".
function buildFixture(ctx) {
  const root = mkSocketFixtureRoot('bl1467-fixture-');
  ctx.root = root;
  initRepo(root);
  commitFile(root, 'seed.txt', 'seed\n', 'seed');
  const seed = git(root, 'rev-parse', 'HEAD');

  // origin/main: an INDEPENDENT line off the same seed, standing in for
  // the tip-pure commit the landed ticket's own land just published.
  git(root, 'checkout', '-q', '-b', 'origin-main-line', seed);
  commitFile(root, `${LANDED}-own.txt`, 'own\n', `${LANDED}: tip-pure replay onto origin/main (BL-1241 land-step remedy)`);
  ctx.originMainTip = git(root, 'rev-parse', 'HEAD');
  git(root, 'update-ref', 'refs/remotes/origin/main', ctx.originMainTip);

  // The QA-style branch: back on `main`, its own copy of the landed
  // ticket's work (a DIFFERENT sha - the parcel's own commit, never the
  // replay's), the fork point local-only commits build on from here.
  git(root, 'checkout', '-q', 'main');
  commitFile(root, `${LANDED}-own.txt`, 'own\n', `${LANDED}: own work`);
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture repository whose QA branch is ahead of origin\/main after a land, with a clean worktree and no in_process parcel$/,
    (ctx) => {
      buildFixture(ctx);
    },
  );

  // ── Scenario Outline 01 ────────────────────────────────────────────
  scoped(/^a local-only commit touching only (\S+) for a ticket other than the landed one$/, (ctx, relPath) => {
    ctx.bookkeepingPath = relPath;
    ctx.bookkeepingSha = commitFile(ctx.root, relPath, `${OTHER} bookkeeping\n`, `${OTHER}: QA bookkeeping`);
  });

  scoped(/^the re-point runs$/, (ctx) => {
    ctx.repoint = postLandRepoint(ctx.root, LANDED);
  });

  scoped(/^the branch is re-pointed to origin\/main$/, (ctx) => {
    assert.equal(ctx.repoint.action, 'repointed', `expected :repointed, got: ${JSON.stringify(ctx.repoint)}`);
  });

  scoped(/^that commit's content is present on the new tip$/, (ctx) => {
    const newTip = ctx.repoint['new-tip'];
    const content = git(ctx.root, 'show', `${newTip}:${ctx.bookkeepingPath}`);
    assert.equal(content, `${OTHER} bookkeeping`, `expected ${ctx.bookkeepingPath}'s content on the new tip, got: ${JSON.stringify(content)}`);
    assert.ok(
      (ctx.repoint.kept || []).some((k) => k.sha === ctx.bookkeepingSha),
      `expected ${ctx.bookkeepingSha} named as kept, got: ${JSON.stringify(ctx.repoint.kept)}`,
    );
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^local-only commits that are neither bookkeeping for another ticket nor part of the land$/, (ctx) => {
    ctx.unrelatedSha = commitFile(ctx.root, 'unrelated.txt', 'unrelated\n', 'a commit naming no ticket at all');
    ctx.landedOwnSha = commitFile(ctx.root, `${LANDED}-more.txt`, 'more\n', `${LANDED}: further own work, already carried by the land`);
  });

  scoped(/^the re-point log and the publish output name each dropped commit by sha and subject$/, (ctx) => {
    assert.equal(ctx.repoint.action, 'repointed', `expected :repointed, got: ${JSON.stringify(ctx.repoint)}`);
    const dropped = ctx.repoint.dropped || [];
    for (const sha of [ctx.unrelatedSha, ctx.landedOwnSha]) {
      const entry = dropped.find((d) => d.sha === sha);
      assert.ok(entry, `expected ${sha} named as dropped, got: ${JSON.stringify(dropped)}`);
      assert.ok(entry.subject && entry.subject.length > 0, `expected ${sha}'s dropped entry to carry its subject, got: ${JSON.stringify(entry)}`);
    }
    const log = fs.readFileSync(path.join(ctx.root, '.swarmforge', 'daemon', 'land-repoint.log'), 'utf8');
    assert.ok(log.includes(ctx.unrelatedSha), `expected the log to name ${ctx.unrelatedSha}, got: ${log}`);
    assert.ok(log.includes(ctx.landedOwnSha), `expected the log to name ${ctx.landedOwnSha}, got: ${log}`);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^a local-only revert commit of a bounced merge$/, (ctx) => {
    // A minimal, unambiguous "revert" subject - task_scope_gate_lib's
    // revert-subject? matches on the leading verb, not real git-revert
    // plumbing, so a plain commit with that subject exercises the same
    // classification a real `git revert` would produce.
    fs.writeFileSync(path.join(ctx.root, `${OTHER}-reverted.txt`), 'was here\n');
    git(ctx.root, 'add', '-A');
    git(ctx.root, 'commit', '-q', '-m', `Revert "${OTHER}: the bounced merge"`);
    fs.rmSync(path.join(ctx.root, `${OTHER}-reverted.txt`));
    git(ctx.root, 'add', '-A');
    git(ctx.root, 'commit', '-q', '-m', `Revert "${OTHER}: the bounced merge"`);
    ctx.revertSha = git(ctx.root, 'rev-parse', 'HEAD');
    ctx.revertedPath = `${OTHER}-reverted.txt`;
  });

  scoped(/^the revert is named as dropped$/, (ctx) => {
    assert.equal(ctx.repoint.action, 'repointed', `expected :repointed, got: ${JSON.stringify(ctx.repoint)}`);
    const entry = (ctx.repoint.dropped || []).find((d) => d.sha === ctx.revertSha);
    assert.ok(entry, `expected ${ctx.revertSha} named as dropped, got: ${JSON.stringify(ctx.repoint.dropped)}`);
    assert.equal(entry.reason, 'revert', `expected reason "revert", got: ${JSON.stringify(entry)}`);
  });

  scoped(/^the new tip equals origin\/main on every path the revert touched$/, (ctx) => {
    const result = require('node:child_process').spawnSync(
      'git', ['-C', ctx.root, 'cat-file', '-e', `${ctx.repoint['new-tip']}:${ctx.revertedPath}`],
      { encoding: 'utf8' },
    );
    assert.notEqual(result.status, 0, `expected ${ctx.revertedPath} ABSENT from the new tip (never re-applied), got present`);
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────
  scoped(/^a local-only bookkeeping commit for another ticket whose file origin\/main changed differently$/, (ctx) => {
    // origin/main's own line ALSO touches this exact bookkeeping path,
    // with different content - the re-application must conflict.
    git(ctx.root, 'checkout', '-q', 'origin-main-line');
    commitFile(ctx.root, `backlog/evidence/${OTHER}-note.md`, 'origin main version\n', `${OTHER}: note landed a different way`);
    git(ctx.root, 'update-ref', 'refs/remotes/origin/main', git(ctx.root, 'rev-parse', 'HEAD'));
    git(ctx.root, 'checkout', '-q', 'main');
    ctx.conflictSha = commitFile(ctx.root, `backlog/evidence/${OTHER}-note.md`, 'qa branch version\n', `${OTHER}: QA bookkeeping note`);
  });

  scoped(/^the commit is named as dropped with the conflict as its reason$/, (ctx) => {
    assert.equal(ctx.repoint.action, 'repointed', `expected :repointed, got: ${JSON.stringify(ctx.repoint)}`);
    const entry = (ctx.repoint.dropped || []).find((d) => d.sha === ctx.conflictSha);
    assert.ok(entry, `expected ${ctx.conflictSha} named as dropped, got: ${JSON.stringify(ctx.repoint.dropped)}`);
    assert.equal(entry.reason, 'conflict', `expected reason "conflict", got: ${JSON.stringify(entry)}`);
  });

  scoped(/^the worktree is clean at origin\/main plus the commits that did apply$/, (ctx) => {
    const status = git(ctx.root, 'status', '--porcelain');
    assert.equal(status, '', `expected a clean worktree, got: ${status}`);
    assert.equal(git(ctx.root, 'rev-parse', 'HEAD'), ctx.repoint['new-tip']);
  });

  // ── Scenario 05 ──────────────────────────────────────────────────────
  scoped(/^an uncommitted change in the worktree$/, (ctx) => {
    fs.writeFileSync(path.join(ctx.root, 'dirty.txt'), 'uncommitted\n');
    ctx.oldTip = git(ctx.root, 'rev-parse', 'HEAD');
  });

  scoped(/^it is skipped with the existing reason and the land is unaffected$/, (ctx) => {
    assert.equal(ctx.repoint.action, 'skipped', `expected :skipped, got: ${JSON.stringify(ctx.repoint)}`);
    assert.equal(ctx.repoint.reason, 'an uncommitted change', `expected the existing reason, got: ${JSON.stringify(ctx.repoint)}`);
    assert.equal(git(ctx.root, 'rev-parse', 'HEAD'), ctx.oldTip, 'expected the worktree untouched by a skip');
  });
}

module.exports = { registerSteps };
