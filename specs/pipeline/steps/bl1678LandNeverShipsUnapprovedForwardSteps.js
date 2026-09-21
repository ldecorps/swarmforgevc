'use strict';

// BL-1678: step handlers for "A land never ships an unapproved forward that
// shares no path with the landing ticket". Drives the REAL
// swarmforge/scripts/land_step_cli.bb and land_main_publish.sh against a
// real fixture origin (a bare repo, never the live checkout - BL-1390) -
// never a reimplementation of land-plan, replay!, or the publish step's own
// verify-push-safe guard.

const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkSocketFixtureRoot } = require('./lib/socketFixtureRoot');

const FEATURE = 'BL-1678 A land never ships an unapproved forward that shares no path with the landing ticket';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const LAND_STEP_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_step_cli.bb');
const LAND_MAIN_PUBLISH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'land_main_publish.sh');

const TASK = 'BL-9101-fixture';
const A_ID = 'BL-9101';
const B_ID = 'BL-9102';
const A_PATH = 'a.txt';
const B_PATH = 'b.txt';
// replay! always stamps this exact subject on the tip-pure commit it
// builds (land_step_lib.bb) - never the cited commit's own subject, which
// is the whole point: the published commit is a fresh build, not a
// republish of whatever QA happened to cite.
const A_LANDING_SUBJECT = `${A_ID}: tip-pure replay onto origin/main (BL-1241 land-step remedy)`;

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function commitFile(root, rel, body, message) {
  const fs = require('node:fs');
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
  return git(root, 'rev-parse', 'HEAD');
}

// Background: a bare origin, a repo with a seed pushed to it, then a QA
// branch shape carrying BOTH tickets, built so the feature's three
// scenarios can each pick the exact commit they need out of it:
//   seed -> A's own commit (a.txt, tagged BL-9101) -> merge B's line in
//   (b.txt, tagged BL-9102) -> one further single-parent commit on top
//   (also tagged BL-9101, "QA review pass evidence") - the real 2026-09-21
//   incident shape: a single-parent tip whose ANCESTRY, via the earlier
//   merge, still carries the unapproved sibling.
function buildFixture(ctx) {
  const work = mkSocketFixtureRoot('bl1678-fixture-');
  ctx.work = work;
  const originDir = path.join(work, 'origin.git');
  const repoDir = path.join(work, 'repo');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', originDir]);
  execFileSync('git', ['init', '-q', '-b', 'main', repoDir]);
  git(repoDir, 'config', 'user.email', 't@t');
  git(repoDir, 'config', 'user.name', 't');
  git(repoDir, 'config', 'commit.gpgsign', 'false');
  git(repoDir, 'remote', 'add', 'origin', originDir);
  git(repoDir, 'commit', '-q', '--allow-empty', '-m', 'seed');
  git(repoDir, 'push', '-q', 'origin', 'main');

  git(repoDir, 'checkout', '-q', '-b', 'b-line');
  const bSha = commitFile(repoDir, B_PATH, 'b\n', `${B_ID}: B's own unapproved forward`);

  git(repoDir, 'checkout', '-q', 'main');
  const aSha = commitFile(repoDir, A_PATH, 'a\n', A_LANDING_SUBJECT);
  git(repoDir, 'merge', '-q', '--no-ff', '-m', 'Merge b-line into main.', bSha);
  ctx.mergeTip = git(repoDir, 'rev-parse', 'HEAD');
  const evidenceSha = commitFile(
    repoDir,
    'evidence.txt',
    'evidence\n',
    `${A_ID}: QA review pass evidence`,
  );
  ctx.singleParentForeignPathTip = evidenceSha;

  ctx.repoDir = repoDir;
  ctx.originDir = originDir;
  ctx.aSha = aSha;
  ctx.bSha = bSha;
  // The commit named A's land - the one QA cites for the land step, which
  // (per BL-1678 item 1) still carries B's unlanded ancestry, unapproved.
  ctx.landingCommit = ctx.singleParentForeignPathTip;
}

const OUTLINE_COMMITS = {
  "the QA branch's merge tip": (ctx) => ctx.mergeTip,
  "a single-parent commit that also carries B's path": (ctx) => ctx.singleParentForeignPathTip,
};

const OUTLINE_REASONS = {
  'a merge commit is never pushed as main': /a merge commit is never pushed as main/,
  "B's path attributed to the unapproved B": new RegExp(`${B_PATH.replace('.', '\\.')} attributed to the unapproved ${B_ID}`),
};

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(
    /^a fixture origin whose QA branch merged an approved ticket A and an unapproved ticket B forward on disjoint paths$/,
    (ctx) => {
      buildFixture(ctx);
    },
  );

  // ── Scenario 01 ──────────────────────────────────────────────────────
  scoped(/^the land step plans A's land on that tip$/, (ctx) => {
    const result = spawnSync('bb', [LAND_STEP_CLI, TASK, ctx.landingCommit, ctx.repoDir], { encoding: 'utf8' });
    ctx.planResult = result;
  });

  scoped(/^it names B as an unapproved forward$/, (ctx) => {
    const { stdout, stderr, status } = ctx.planResult;
    assert.equal(status, 0, `expected exit 0, got ${status}: ${stdout}${stderr}`);
    assert.match(stdout, new RegExp(`^ENTANGLED_SIBLING ${B_ID}$`, 'm'), `expected ENTANGLED_SIBLING ${B_ID}, got:\n${stdout}`);
  });

  scoped(/^it plans a replay whose diff against main names only A's paths$/, (ctx) => {
    const match = /^LAND_REPLAY (\S+) (\S+)$/m.exec(ctx.planResult.stdout);
    assert.ok(match, `expected a LAND_REPLAY line, got:\n${ctx.planResult.stdout}`);
    const [, , replayCommit] = match;
    const names = git(ctx.repoDir, 'diff', '--name-only', 'origin/main', replayCommit).split('\n').filter(Boolean);
    // The fixture's own landing commit carries BOTH of A's own paths
    // (a.txt from its first commit, evidence.txt from the further one
    // stacked on top to build the outline's single-parent-with-foreign-
    // ancestry shape) - the assertion under test is that NONE of B's
    // paths ride, not that A delivered exactly one file.
    assert.ok(names.includes(A_PATH), `expected the replay diff to include ${A_PATH}, got: ${JSON.stringify(names)}`);
    assert.ok(!names.includes(B_PATH), `expected the replay diff to exclude ${B_PATH}, got: ${JSON.stringify(names)}`);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^A is landed through the publish step$/, (ctx) => {
    const result = spawnSync(
      'bash',
      [LAND_MAIN_PUBLISH, ctx.repoDir, '--land', TASK, ctx.landingCommit],
      { encoding: 'utf8' },
    );
    ctx.landResult = result;
  });

  scoped(
    /^the fixture origin's main gains exactly one commit with one parent whose subject is A's landing subject$/,
    (ctx) => {
      assert.equal(ctx.landResult.status, 0, `expected the land to succeed, got ${ctx.landResult.status}: ${ctx.landResult.stdout}${ctx.landResult.stderr}`);
      const log = git(ctx.originDir, 'log', '--oneline', '--all');
      const lines = log.split('\n').filter(Boolean);
      assert.equal(lines.length, 2, `expected exactly seed + one landing commit on origin, got:\n${log}`);
      const tip = git(ctx.originDir, 'rev-parse', 'main');
      const parents = git(ctx.originDir, 'rev-list', '--parents', '-n1', tip).split(/\s+/).filter(Boolean);
      assert.equal(parents.length, 2, `expected exactly one parent (tip + 1 parent token), got: ${parents.join(' ')}`);
      const subject = git(ctx.originDir, 'log', '-1', '--format=%s', tip);
      assert.equal(subject, A_LANDING_SUBJECT, `expected the landing subject, got: ${subject}`);
    },
  );

  scoped(/^none of B's paths exist on main$/, (ctx) => {
    const tip = git(ctx.originDir, 'rev-parse', 'main');
    const result = spawnSync('git', ['-C', ctx.originDir, 'cat-file', '-e', `${tip}:${B_PATH}`], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, `expected ${B_PATH} to be ABSENT from origin/main`);
  });

  // ── Scenario Outline 03 ──────────────────────────────────────────────
  scoped(/^the publish step is asked to push (.+) as main$/, (ctx, commitKey) => {
    const resolve = OUTLINE_COMMITS[commitKey];
    assert.ok(resolve, `bl1678: unrecognized <commit> "${commitKey}"`);
    const commit = resolve(ctx);
    ctx.originMainBefore = git(ctx.originDir, 'rev-parse', 'main');
    const result = spawnSync('bash', [LAND_MAIN_PUBLISH, ctx.repoDir, '--push', commit], { encoding: 'utf8' });
    ctx.pushResult = result;
  });

  scoped(/^it refuses naming (.+)$/, (ctx, reasonKey) => {
    const pattern = OUTLINE_REASONS[reasonKey];
    assert.ok(pattern, `bl1678: unrecognized <reason> "${reasonKey}"`);
    const { stdout, stderr, status } = ctx.pushResult;
    assert.notEqual(status, 0, `expected a non-zero refusal, got 0: ${stdout}${stderr}`);
    assert.match(`${stdout}${stderr}`, pattern, `expected the refusal to name "${reasonKey}", got:\n${stdout}${stderr}`);
    const originMainAfter = git(ctx.originDir, 'rev-parse', 'main');
    assert.equal(originMainAfter, ctx.originMainBefore, 'expected origin/main untouched by a refused push');
  });
}

module.exports = { registerSteps };
