'use strict';

// BL-1438: step handlers for "The publish re-points the QA branch after a
// land". Drives the REAL land_main_publish.sh (which shells to the REAL
// land_step_cli.bb repoint verb, which calls the REAL
// land_step_lib.bb/post-land-repoint!) against a fixture repository with a
// bare origin under mkdtemp - never the live checkout, and never a
// reimplementation of the land or re-point decision logic. Fixture shape
// follows swarmforge/scripts/test/test_bl1366_land_is_one_command.sh's own
// bare-origin-plus-worktree convention exactly (the shell suite covering
// this same script).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const FEATURE = 'BL-1438 The publish re-points the QA branch after a land';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TASK_NAME = 'BL-9438-fixture-task';

const KNOWN_WORK = new Set(['an uncommitted change', 'a parcel in its in_process']);

const fixtureRoots = [];
process.on('exit', () => {
  for (const root of fixtureRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

// A repo whose origin is a bare repo under the same mkdtemp root, with the
// REAL swarmforge/scripts symlinked in - land_main_publish.sh resolves
// land_step_cli.bb (and that resolves land_step_lib.bb) relative to its
// OWN location, so the fixture must carry a real copy/link of this exact
// parcel's scripts, never the installed swarm's.
function buildFixture(ctx) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl1438-'));
  fixtureRoots.push(root);
  const origin = `${root}-origin.git`;
  fixtureRoots.push(origin);

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
    path.join(root, 'backlog', 'active', 'BL-9438-fixture.yaml'),
    'id: BL-9438\ntitle: fixture\nmilestone: M8\nstatus: todo\n'
  );
  // .swarmforge/ is gitignored in the real repo (its own top-level
  // .gitignore) precisely so land-lock/land-repoint-log/in_process
  // machinery bookkeeping never registers as an "uncommitted change" -
  // without this the fixture's own lock/log writes would falsely trip
  // post-land-repoint!'s dirty-tree guard, reporting a skip for a
  // worktree that is genuinely clean of any REAL work.
  fs.writeFileSync(path.join(root, '.gitignore'), '.swarmforge/\n');
  fs.writeFileSync(path.join(root, 'seed.txt'), 'seed\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'seed');
  git(root, 'push', '-q', '-u', 'origin', 'main');

  ctx.root = root;
  ctx.origin = origin;
  ctx.taskName = TASK_NAME;
}

// One commit on top of origin/main, subject naming the fixture ticket id -
// "an approved parcel that lands clean".
function approveCommit(ctx) {
  fs.writeFileSync(path.join(ctx.root, 'work.txt'), `work ${Math.random()}\n`);
  git(ctx.root, 'add', '-A');
  git(ctx.root, 'commit', '-q', '-m', 'BL-9438: the approved work');
  ctx.approvedSha = git(ctx.root, 'rev-parse', 'HEAD');
}

function runLand(ctx) {
  const result = spawnSync(
    'bash',
    [path.join(ctx.root, 'swarmforge', 'scripts', 'land_main_publish.sh'), ctx.root, '--land', ctx.taskName, ctx.approvedSha],
    { cwd: ctx.root, encoding: 'utf8', env: { ...process.env, LAND_LOCK_WAIT_SECONDS: '20' } }
  );
  ctx.landResult = { rc: result.status ?? 1, out: `${result.stdout || ''}${result.stderr || ''}` };
}

function indexOfLine(text, needlePrefix) {
  return text.split('\n').findIndex((line) => line.startsWith(needlePrefix));
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(
    /^a fixture repository with a bare origin and a QA-style worktree holding an approved parcel that lands clean$/,
    (ctx) => {
      buildFixture(ctx);
      approveCommit(ctx);
    }
  );

  // ── Scenario 01 Given ───────────────────────────────────────────────────
  scoped(/^the QA-style worktree is clean and its in_process mailbox is empty$/, (ctx) => {
    // Framing only: the fixture built above is already clean by
    // construction (one committed approved change, no untracked files, no
    // in_process directory at all).
    assert.equal(git(ctx.root, 'status', '--porcelain'), '', 'expected the freshly built fixture to be clean');
  });

  // ── shared When ──────────────────────────────────────────────────────────
  scoped(/^land_main_publish\.sh lands the parcel$/, (ctx) => {
    runLand(ctx);
  });

  // ── Scenario 01 Then ─────────────────────────────────────────────────────
  scoped(/^it prints LAND_PUBLISHED and then LAND_REPOINTED with the old tip and the new tip$/, (ctx) => {
    const { out } = ctx.landResult;
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
    assert.equal(head, originMain, `expected the worktree HEAD to equal origin/main after re-pointing`);
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
    const { out } = ctx.landResult;
    const publishedIdx = indexOfLine(out, 'LAND_PUBLISHED');
    const skippedIdx = indexOfLine(out, 'LAND_REPOINT_SKIPPED ');
    assert.ok(publishedIdx !== -1, `expected a LAND_PUBLISHED line, got: ${out}`);
    assert.ok(skippedIdx !== -1, `expected a LAND_REPOINT_SKIPPED line, got: ${out}`);
    assert.ok(publishedIdx < skippedIdx, `expected LAND_PUBLISHED before LAND_REPOINT_SKIPPED, got: ${out}`);
    const skippedLine = out.split('\n')[skippedIdx];
    assert.ok(skippedLine.includes(work), `expected the skip reason to name "${work}", got: ${skippedLine}`);
  });

  scoped(/^it exits 0$/, (ctx) => {
    assert.equal(ctx.landResult.rc, 0, `expected the publish to exit 0, got ${ctx.landResult.rc}: ${ctx.landResult.out}`);
  });

  scoped(/^nothing about the branch or the worktree has moved$/, (ctx) => {
    const head = git(ctx.root, 'rev-parse', 'HEAD');
    assert.equal(head, ctx.approvedSha, 'expected HEAD to stay at the approved commit (the land itself still succeeds; only the re-point is skipped)');
    if (ctx.work === 'an uncommitted change') {
      assert.ok(fs.existsSync(path.join(ctx.root, 'uncommitted.txt')), 'expected the uncommitted file to still be present');
    } else {
      const inProcessDir = path.join(ctx.root, '.swarmforge', 'handoffs', 'inbox', 'in_process');
      assert.ok(fs.existsSync(path.join(inProcessDir, '00_fixture.handoff')), 'expected the in_process marker to still be present');
    }
  });

  // ── Scenario 03 ────────────────────────────────────────────────────────
  scoped(/^the land step escalates for the parcel$/, (ctx) => {
    // The simplest real escalation land-plan produces (land_step_lib.bb:
    // "land-step: task name names no ticket id") - a task name with no
    // recognizable ticket id makes land-plan escalate before it ever asks
    // whether the commit itself is clean, exercising the exact same
    // LAND_ESCALATE -> LAND_STOPPED path a genuine entangled tip would.
    ctx.taskName = 'not-a-ticket-name';
    ctx.headBeforeLand = git(ctx.root, 'rev-parse', 'HEAD');
  });

  scoped(/^the publish is run against that escalating parcel$/, (ctx) => {
    runLand(ctx);
  });

  scoped(/^it prints LAND_STOPPED and no re-point line$/, (ctx) => {
    const { out } = ctx.landResult;
    assert.match(out, /LAND_STOPPED/, `expected a LAND_STOPPED line, got: ${out}`);
    assert.ok(!out.includes('LAND_REPOINTED'), `expected no LAND_REPOINTED line, got: ${out}`);
    assert.ok(!out.includes('LAND_REPOINT_SKIPPED'), `expected no LAND_REPOINT_SKIPPED line, got: ${out}`);
  });

  scoped(/^the branch was left exactly where the escalation found it$/, (ctx) => {
    const head = git(ctx.root, 'rev-parse', 'HEAD');
    assert.equal(head, ctx.headBeforeLand, 'expected HEAD to be unchanged by the escalated land attempt');
  });
}

module.exports = { registerSteps };
