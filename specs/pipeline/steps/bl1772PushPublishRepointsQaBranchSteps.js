'use strict';

// BL-1772: step handlers for "The --push publish re-points the QA branch
// after a land" - stamp-off review of hotfix db4da5c573 (BL-848). Drives the
// REAL land_main_publish.sh --push (which shells to the REAL
// land_step_cli.bb repoint verb, which calls the REAL
// land_step_lib.bb/post-land-repoint!) against a fixture repository with a
// bare origin under mkdtemp - never the live checkout, and never a
// reimplementation of the publish or re-point decision logic. Fixture shape
// follows swarmforge/scripts/test/test_bl1772_push_repoints.sh exactly (the
// shell suite the hotfix already landed with) and BL-1438's own sibling
// handler (the --land shape this ticket extends to --push).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { trackedTmpRoot } = require('./lib/fixtureReaper');

const FEATURE = 'BL-1772 The --push publish re-points the QA branch after a land';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

const KNOWN_WORK = new Set(['an uncommitted change', 'a parcel in its in_process']);

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

// Both the worktree and its bare origin live under ONE trackedTmpRoot -
// never a raw fs.mkdtempSync (BL-1636's own migration-complete gate) - so a
// single reap on abnormal exit clears both. land_main_publish.sh resolves
// land_step_cli.bb (and that resolves land_step_lib.bb) relative to its OWN
// location, so the fixture must carry a real copy/link of this exact
// parcel's scripts, never the installed swarm's. Matches BL-1438's own
// buildFixture (the sibling --land handler) in every respect but that.
function buildFixture(ctx) {
  const base = trackedTmpRoot('bl1772-');
  const root = path.join(base, 'repo');
  const origin = path.join(base, 'origin.git');
  fs.mkdirSync(root, { recursive: true });

  execFileSync('git', ['init', '-q', '--bare', origin]);
  try {
    execFileSync('git', ['-C', origin, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  } catch {
    // best-effort, matching the shell fixture's own tolerance
  }

  fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  for (const [k, v] of [
    ['user.email', 't@t'],
    ['user.name', 't'],
    ['commit.gpgsign', 'false'],
  ]) {
    git(root, 'config', k, v);
  }
  fs.symlinkSync(path.join(REPO_ROOT, 'swarmforge', 'scripts'), path.join(root, 'swarmforge', 'scripts'), 'dir');
  git(root, 'remote', 'add', 'origin', origin);
  fs.writeFileSync(
    path.join(root, 'backlog', 'active', 'BL-9772-fixture.yaml'),
    'id: BL-9772\ntitle: fixture\nmilestone: M8\nstatus: todo\n'
  );
  // .swarmforge/ is gitignored in the real repo precisely so
  // land-lock/land-repoint-log/in_process machinery bookkeeping never
  // registers as an "uncommitted change" - without this the fixture's own
  // lock/log writes would falsely trip post-land-repoint!'s dirty-tree
  // guard, reporting a skip for a worktree that is genuinely clean of any
  // REAL work.
  fs.writeFileSync(path.join(root, '.gitignore'), '.swarmforge/\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'seed');
  git(root, 'push', '-q', '-u', 'origin', 'main');

  ctx.root = root;
  ctx.origin = origin;
}

// Extra commit on the worktree that origin/main does not have - the QA
// branch leftover the re-point is meant to drop.
function growQaBranch(ctx) {
  fs.writeFileSync(path.join(ctx.root, 'review.txt'), `review ${Math.random()}\n`);
  git(ctx.root, 'add', '-A');
  git(ctx.root, 'commit', '-q', '-m', 'QA review merge leftover');
  ctx.qaBeforeSha = git(ctx.root, 'rev-parse', 'HEAD');
}

// A tip-pure landing off current origin/main, leaving HEAD back on the
// leftover QA branch (the branch the re-point must move) - --push publishes
// ctx.landingSha directly, never a commit reachable from the QA branch's
// own history.
function makeTipPure(ctx) {
  const qaBranch = git(ctx.root, 'rev-parse', '--abbrev-ref', 'HEAD');
  const originMain = git(ctx.root, 'rev-parse', 'origin/main');
  git(ctx.root, 'checkout', '-q', '--detach', originMain);
  fs.writeFileSync(path.join(ctx.root, 'landed.txt'), `landed ${Math.random()}\n`);
  git(ctx.root, 'add', 'landed.txt');
  git(ctx.root, 'commit', '-q', '-m', 'BL-9772: the tip-pure landing');
  ctx.landingSha = git(ctx.root, 'rev-parse', 'HEAD');
  git(ctx.root, 'checkout', '-q', qaBranch);
}

function runPush(ctx, sha) {
  const result = spawnSync(
    'bash',
    [path.join(ctx.root, 'swarmforge', 'scripts', 'land_main_publish.sh'), ctx.root, '--push', sha],
    { cwd: ctx.root, encoding: 'utf8', env: { ...process.env, LAND_LOCK_WAIT_SECONDS: '20' } }
  );
  ctx.pushResult = { rc: result.status ?? 1, out: `${result.stdout || ''}${result.stderr || ''}` };
}

function indexOfLine(text, needlePrefix) {
  return text.split('\n').findIndex((line) => line.startsWith(needlePrefix));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(
    /^a fixture repository with a bare origin and a QA-style worktree holding a tip-pure landing commit that --push will publish$/,
    (ctx) => {
      buildFixture(ctx);
      growQaBranch(ctx);
      makeTipPure(ctx);
    }
  );

  // ── Scenario 01 Given ───────────────────────────────────────────────────
  scoped(/^the QA-style worktree is clean and its in_process mailbox is empty$/, (ctx) => {
    // Framing only: the fixture built above is already clean by
    // construction (the tip-pure landing lives off-branch; the QA
    // worktree itself carries only the committed leftover, no untracked
    // files, no in_process directory at all).
    assert.equal(git(ctx.root, 'status', '--porcelain'), '', 'expected the freshly built fixture to be clean');
  });

  // ── shared When ──────────────────────────────────────────────────────────
  scoped(/^land_main_publish\.sh --push publishes the landing commit$/, (ctx) => {
    runPush(ctx, ctx.landingSha);
  });

  // ── Scenario 01 Then ─────────────────────────────────────────────────────
  scoped(/^it prints LAND_PUBLISHED and then LAND_REPOINTED with the old tip and the new tip$/, (ctx) => {
    const { out } = ctx.pushResult;
    const publishedIdx = indexOfLine(out, 'LAND_PUBLISHED');
    const repointedIdx = indexOfLine(out, 'LAND_REPOINTED ');
    assert.ok(publishedIdx !== -1, `expected a LAND_PUBLISHED line, got: ${out}`);
    assert.ok(repointedIdx !== -1, `expected a LAND_REPOINTED line, got: ${out}`);
    assert.ok(publishedIdx < repointedIdx, `expected LAND_PUBLISHED before LAND_REPOINTED, got: ${out}`);
    const repointedLine = out.split('\n')[repointedIdx];
    const parts = repointedLine.split(' ');
    assert.equal(parts.length, 3, `expected "LAND_REPOINTED <old> <new>", got: ${repointedLine}`);
  });

  scoped(/^the QA-style branch tip equals origin\/main$/, (ctx) => {
    const head = git(ctx.root, 'rev-parse', 'HEAD');
    const originMain = git(ctx.origin, 'rev-parse', 'main');
    assert.equal(head, originMain, 'expected the worktree HEAD to equal origin/main after re-pointing');
  });

  scoped(/^the re-point log carries the entry$/, (ctx) => {
    const logPath = path.join(ctx.root, '.swarmforge', 'daemon', 'land-repoint.log');
    assert.ok(fs.existsSync(logPath), `expected a re-point log at ${logPath}`);
    const text = fs.readFileSync(logPath, 'utf8');
    assert.match(text, /:action :repointed/, `expected the log to carry a :repointed entry, got: ${text}`);
  });

  // ── Scenario 02 Given (outline) ──────────────────────────────────────────
  scoped(/^the QA-style worktree holds (.+)$/, (ctx, work) => {
    assert.ok(KNOWN_WORK.has(work), `unknown <work> example value: ${work}`);
    ctx.work = work;
    if (work === 'an uncommitted change') {
      fs.writeFileSync(path.join(ctx.root, 'uncommitted.txt'), 'dirty\n');
    } else {
      const inProcessDir = path.join(ctx.root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
      fs.mkdirSync(inProcessDir, { recursive: true });
      fs.writeFileSync(path.join(inProcessDir, '00_fixture.handoff'), 'type: git_handoff\n');
    }
  });

  // ── Scenario 02 Then ──────────────────────────────────────────────────────
  scoped(/^it prints LAND_PUBLISHED and then LAND_REPOINT_SKIPPED naming (.+)$/, (ctx, work) => {
    assert.ok(KNOWN_WORK.has(work), `unknown <work> example value: ${work}`);
    const { out } = ctx.pushResult;
    const publishedIdx = indexOfLine(out, 'LAND_PUBLISHED');
    const skippedIdx = indexOfLine(out, 'LAND_REPOINT_SKIPPED ');
    assert.ok(publishedIdx !== -1, `expected a LAND_PUBLISHED line, got: ${out}`);
    assert.ok(skippedIdx !== -1, `expected a LAND_REPOINT_SKIPPED line, got: ${out}`);
    assert.ok(publishedIdx < skippedIdx, `expected LAND_PUBLISHED before LAND_REPOINT_SKIPPED, got: ${out}`);
    const skippedLine = out.split('\n')[skippedIdx];
    assert.ok(skippedLine.includes(work), `expected the skip reason to name "${work}", got: ${skippedLine}`);
  });

  scoped(/^it exits 0$/, (ctx) => {
    assert.equal(ctx.pushResult.rc, 0, `expected the publish to exit 0, got ${ctx.pushResult.rc}: ${ctx.pushResult.out}`);
  });

  scoped(/^nothing about the branch or the worktree has moved$/, (ctx) => {
    const head = git(ctx.root, 'rev-parse', 'HEAD');
    assert.equal(head, ctx.qaBeforeSha, 'expected HEAD to stay at the pre-push QA-branch tip (the publish itself still succeeds; only the re-point is skipped)');
    if (ctx.work === 'an uncommitted change') {
      assert.ok(fs.existsSync(path.join(ctx.root, 'uncommitted.txt')), 'expected the uncommitted file to still be present');
    } else {
      const inProcessDir = path.join(ctx.root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
      assert.ok(fs.existsSync(path.join(inProcessDir, '00_fixture.handoff')), 'expected the in_process marker to still be present');
    }
  });

  // ── Scenario 03 ────────────────────────────────────────────────────────
  // A merge commit is what verify-push-safe refuses (BL-1678) - built by
  // commit-tree directly, in isolation, so HEAD never leaves the leftover
  // QA branch tip the background already established.
  scoped(/^the publish step refuses the landing commit$/, (ctx) => {
    ctx.headBeforeLand = git(ctx.root, 'rev-parse', 'HEAD');
    const parentA = ctx.headBeforeLand;
    fs.writeFileSync(path.join(ctx.root, 'other-parent.txt'), 'other\n');
    git(ctx.root, 'add', '-A');
    git(ctx.root, 'commit', '-q', '-m', 'other parent');
    const parentB = git(ctx.root, 'rev-parse', 'HEAD');
    git(ctx.root, 'reset', '-q', '--hard', parentA);
    const tree = git(ctx.root, 'rev-parse', 'HEAD^{tree}');
    ctx.mergeSha = git(ctx.root, 'commit-tree', tree, '-p', parentA, '-p', parentB, '-m', 'BL-9772: a merge landing');
  });

  scoped(/^land_main_publish\.sh --push is run against that commit$/, (ctx) => {
    runPush(ctx, ctx.mergeSha);
  });

  scoped(/^it prints LAND_STOPPED and no re-point line$/, (ctx) => {
    const { out } = ctx.pushResult;
    assert.match(out, /LAND_STOPPED/, `expected a LAND_STOPPED line, got: ${out}`);
    assert.ok(!out.includes('LAND_REPOINTED'), `expected no LAND_REPOINTED line, got: ${out}`);
    assert.ok(!out.includes('LAND_REPOINT_SKIPPED'), `expected no LAND_REPOINT_SKIPPED line, got: ${out}`);
  });

  scoped(/^the branch was left exactly where the refusal found it$/, (ctx) => {
    const head = git(ctx.root, 'rev-parse', 'HEAD');
    assert.equal(head, ctx.headBeforeLand, 'expected HEAD to be unchanged by the refused push');
  });
}

module.exports = { registerSteps };
