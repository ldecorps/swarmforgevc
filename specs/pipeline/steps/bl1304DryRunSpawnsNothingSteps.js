'use strict';

// BL-1304: step handlers for "An expedite dry run plans and spawns nothing,
// whatever an earlier run left on disk". Drives the REAL expedite_cli.bb
// through the real expedite_fixture.sh (same fixture test_expedite_cli.sh
// and BL-1255's own step handlers use), never a reimplementation of the
// driver - the whole point of this ticket is that the real driver, not a
// stand-in, must skip run-stage! on --dry-run.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'expedite_cli.bb');
const FIXTURE_SH = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'expedite_fixture.sh');

// Must match the feature file's "Feature:" line verbatim - resolve() scopes
// on that exact text, not the per-scenario "# BL-1304 ..." tag comments.
const FEATURE = 'An expedite dry run plans and spawns nothing, whatever an earlier run left on disk';

const RUN_TICKET = 'BL-1304';
const OTHER_TICKET = 'BL-590';

// Explicit known values per the Scenario Outline handler rule.
const KNOWN_WORKTREE_STATES = new Set(['absent', 'present from an earlier run']);

function buildRoot(ctx, args) {
  if (!ctx.bl1304) ctx.bl1304 = { dir: fs.mkdtempSync(path.join(os.tmpdir(), 'bl1304-')) };
  const res = spawnSync('bash', [FIXTURE_SH, ctx.bl1304.dir, ...args], { encoding: 'utf8' });
  assert.equal(res.status, 0, `fixture build failed: ${res.stdout || ''}${res.stderr || ''}`);
  ctx.bl1304.built = true;
  return ctx.bl1304.dir;
}

function mkRoot(ctx) {
  if (ctx.bl1304?.built) return ctx.bl1304.dir;
  return buildRoot(ctx, ['--paused', RUN_TICKET]);
}

function worktreeDir(root) {
  return path.join(root, '.worktrees', `expedite-${RUN_TICKET}`);
}

function runExpedite(ctx, extraArgs) {
  const root = mkRoot(ctx);
  const env = {
    ...process.env,
    EXPEDITE_STAGE_RUNNER: path.join(root, 'stage-runner.sh'),
    EXPEDITE_STOP_CMD: './stop-swarm.sh',
    EXPEDITE_START_CMD: './start-swarm.sh',
  };
  const res = spawnSync('bb', [CLI, root, RUN_TICKET, '--no-restart', ...extraArgs], {
    encoding: 'utf8',
    env,
    cwd: REPO_ROOT,
  });
  ctx.bl1304.last = { out: `${res.stdout || ''}${res.stderr || ''}`, status: res.status };
  return ctx.bl1304.last;
}

function ranStages(root) {
  try {
    return fs
      .readFileSync(path.join(root, '.swarmforge', 'expedite-fixture', 'ran.log'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a ticket eligible for an expedited run$/, (ctx) => {
    mkRoot(ctx);
  });

  scoped(/^a run worktree for that ticket is (.+)$/, (ctx, state) => {
    assert.ok(
      KNOWN_WORKTREE_STATES.has(state),
      `unknown worktree state "${state}" - handlers know ${[...KNOWN_WORKTREE_STATES]}`,
    );
    const root = mkRoot(ctx);
    if (state === 'present from an earlier run') {
      const dir = worktreeDir(root);
      const branch = `expedite/${RUN_TICKET}`;
      const res = spawnSync('git', ['-C', root, 'worktree', 'add', '-b', branch, dir, 'main'], {
        encoding: 'utf8',
      });
      assert.equal(res.status, 0, `could not seed the earlier-run worktree: ${res.stderr}`);
    }
    // "absent": the fixture never creates one - nothing to do.
  });

  scoped(/^the run ticket is in backlog\/paused\/ and another ticket is in backlog\/active\/$/, (ctx) => {
    buildRoot(ctx, ['--paused', RUN_TICKET, '--active', OTHER_TICKET]);
  });

  scoped(/^the expeditor is invoked with --dry-run$/, (ctx) => {
    runExpedite(ctx, ['--dry-run']);
  });

  scoped(/^the expeditor is invoked without --dry-run$/, (ctx) => {
    runExpedite(ctx, []);
  });

  scoped(/^no stage process is started$/, (ctx) => {
    const stages = ranStages(ctx.bl1304.dir);
    assert.deepEqual(stages, [], `expected no stage to run; ran: ${stages.join(',')}`);
  });

  scoped(/^no run worktree is created for that ticket$/, (ctx) => {
    // The "present from an earlier run" case seeded one by hand in the Given
    // above; this asserts the DRIVER never creates one on its own. When no
    // worktree exists at all, no branch can exist either - the CLI would
    // have had to make both, and it made neither.
    const dir = worktreeDir(ctx.bl1304.dir);
    if (!fs.existsSync(dir)) {
      const branchList = spawnSync(
        'git',
        ['-C', ctx.bl1304.dir, 'branch', '--list', `expedite/${RUN_TICKET}`],
        { encoding: 'utf8' },
      );
      assert.equal(branchList.stdout.trim(), '', 'no worktree dir but a branch exists - CLI made one');
    }
    // A dir that DOES exist here was seeded by this scenario's own Given
    // (git worktree add is atomic with the branch), so its mere presence
    // proves nothing about the CLI - the "no stage started" assertion is
    // what actually distinguishes a real run from this dry run.
  });

  scoped(/^the run reports its plan and succeeds$/, (ctx) => {
    assert.equal(ctx.bl1304.last.status, 0, ctx.bl1304.last.out);
    assert.match(ctx.bl1304.last.out, /dry-run plan: stages/, ctx.bl1304.last.out);
  });

  scoped(/^the run ticket is still in backlog\/paused\/$/, (ctx) => {
    assert.ok(
      fs.existsSync(path.join(ctx.bl1304.dir, 'backlog', 'paused', `${RUN_TICKET}-fixture.yaml`)),
      ctx.bl1304.last.out,
    );
  });

  scoped(/^the other ticket is still in backlog\/active\/$/, (ctx) => {
    assert.ok(
      fs.existsSync(path.join(ctx.bl1304.dir, 'backlog', 'active', `${OTHER_TICKET}-fixture.yaml`)),
      ctx.bl1304.last.out,
    );
  });

  scoped(/^the stage driver runs the chain$/, (ctx) => {
    const stages = ranStages(ctx.bl1304.dir);
    assert.ok(stages.length > 0, `expected the driver to run stages; got none: ${ctx.bl1304.last.out}`);
    assert.ok(stages.includes('QA'), `expected the chain to reach QA; ran: ${stages.join(',')}`);
  });
}

module.exports = { registerSteps };
