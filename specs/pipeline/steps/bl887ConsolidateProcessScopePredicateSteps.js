'use strict';

// BL-887: step handlers for "BL-887 one shared process-scope predicate for
// the supervisor reaper and the orphan janitor".
//
// Scenario 01 drives BOTH real subsystems for each example row:
//  - janitor: the REAL orphan_janitor_lib.bb project-scoped-path? via
//    bl887_scope_predicate_classify_runner.bb's JSON bridge ("classify"),
//    same pattern bl886_vitest_orphan_reaper_acceptance_runner.bb already
//    established - cwd is passed through literally (null models
//    "unresolvable" faithfully; the janitor consumes cwd as a plain
//    argument, no real process involved).
//  - supervisor: job-in-scope? has no adapter seam (handoffd_supervisor.bb
//    self-executes -main on load), so its classification is observed via a
//    REAL orphaned process + `bb handoffd_supervisor.bb --check-once` +
//    pidAlive, reusing lib/bl886SupervisorFixture.js exactly as bl886's own
//    supervisor scenarios do. "unresolvable" is modeled as a genuinely
//    out-of-scope real directory rather than forcing a live process's
//    resolved cwd to actually fail (OS/lsof-timing dependent, would make
//    this step flaky) - sufficient because every example row pairing
//    "unresolvable" with an in-scope classification depends on the
//    CMDLINE leg alone, so what the real cwd resolves to must be
//    irrelevant to the outcome; an out-of-scope stand-in proves exactly
//    that.
//
// Scenario 02 drives the REAL orphan-janitor-sweep-lib/sweep! wiring via
// the classify runner's "sweep-worker" subcommand, generalizing
// bl886_vitest_orphan_reaper_acceptance_runner.bb's "sweep-one-vitest" to
// an arbitrary cmdline/cwd instead of that runner's fixed constants.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const supervisorFixture = require('./lib/bl886SupervisorFixture');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CLASSIFY_RUNNER = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'bl887_scope_predicate_classify_runner.bb');

const FEATURE_NAME = 'BL-887 one shared process-scope predicate for the supervisor reaper and the orphan janitor';

function runClassifyBridge(subcommand, payload) {
  const out = execFileSync('bb', [CLASSIFY_RUNNER, subcommand, JSON.stringify(payload)], { encoding: 'utf8' });
  return JSON.parse(out);
}

const CMDLINE_SHAPES = {
  'worker embedding an absolute scope path mid-string': (coderWt) =>
    `node ${coderWt}/node_modules/vitest/dist/worker.js (vitest 1)`,
  'launcher with a relative config path and no path': () => 'npm exec vitest run --config vitest.properties.config.mjs',
  'command with no scope path anywhere': () => 'npx vitest run --config vitest.properties.config.mjs',
};

const CWD_KINDS = {
  unresolvable: 'unresolvable',
  'under the host root': 'under-host-root',
  'under a role worktree': 'under-worktree',
  'outside every scope path': 'outside-every-scope-path',
};

const KNOWN_CLASSIFICATIONS = { 'in scope': true, 'out of scope': false };

function resolveCwd(kind, fixture) {
  switch (kind) {
    case 'unresolvable':
      return null;
    case 'under-host-root': {
      // A real, chdir-able directory - spawnOrphanFixture's fork script
      // must os.chdir() into it, which throws (and never writes the pid
      // file) if the path does not exist on disk.
      const dir = path.join(fixture.root, 'somewhere');
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    }
    case 'under-worktree':
      return path.join(fixture.coderWt, 'extension');
    case 'outside-every-scope-path':
      return supervisorFixture.mkTmp('bl887-out-of-scope-');
    default:
      throw new Error(`bl887: unhandled cwd kind "${kind}"`);
  }
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^the scope path set is the canonical host root plus every registered role worktree$/,
    (ctx) => {
      ctx.fixture = supervisorFixture.makeFixtureRoot();
    },
    FEATURE_NAME
  );

  // ── shared-scope-predicate-01 (Scenario Outline) ────────────────────
  registry.defineScoped(
    /^a process whose cmdline shape is "(.+)"$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(CMDLINE_SHAPES, raw)) {
        throw new Error(`bl887: unrecognized <cmdline-shape> example value "${raw}"`);
      }
      ctx.cmdline = CMDLINE_SHAPES[raw](ctx.fixture.coderWt);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^whose resolved cwd is (.+)$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(CWD_KINDS, raw)) {
        throw new Error(`bl887: unrecognized <cwd> example value "${raw}"`);
      }
      ctx.cwdKind = CWD_KINDS[raw];
      ctx.cwd = resolveCwd(ctx.cwdKind, ctx.fixture);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the supervisor scope check and the janitor scope check each classify the process$/,
    async (ctx) => {
      const janitorResult = runClassifyBridge('classify', {
        projectRoot: ctx.fixture.root,
        worktree: ctx.fixture.coderWt,
        cmd: ctx.cmdline,
        cwd: ctx.cwd,
      });
      ctx.janitorInScope = janitorResult.inScope;

      // Every covered cmdline shape matches job-process-pattern (stryker |
      // node --test | vitest.properties.config.mjs | npm exec vitest |
      // npx vitest | (vitest), so a real orphaned process is genuinely a
      // job-reaper candidate: reaped iff job-in-scope? was true.
      const proc = await supervisorFixture.spawnOrphanFixture({ cwd: ctx.cwd || supervisorFixture.mkTmp('bl887-null-cwd-'), cmdline: ctx.cmdline });
      supervisorFixture.checkOnce(ctx.fixture.root, ctx.fixture.binDir);
      const alive = supervisorFixture.pidAlive(proc.pid);
      supervisorFixture.killFixture(proc.pid);
      ctx.supervisorInScope = !alive;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^both classify it as (.+)$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_CLASSIFICATIONS, raw)) {
        throw new Error(`bl887: unrecognized <classification> example value "${raw}"`);
      }
      const expected = KNOWN_CLASSIFICATIONS[raw];
      supervisorFixture.cleanupFixtureRoot(ctx.fixture);
      if (ctx.janitorInScope !== expected || ctx.supervisorInScope !== expected) {
        throw new Error(
          `expected both to classify as ${raw} (${expected}), got janitor=${ctx.janitorInScope} supervisor=${ctx.supervisorInScope}`
        );
      }
    },
    FEATURE_NAME
  );

  // ── shared-scope-predicate-02 ────────────────────────────────────────
  registry.defineScoped(
    /^a hung property-lane vitest worker whose cmdline embeds an absolute scope path mid-string$/,
    (ctx) => {
      ctx.cmdline = CMDLINE_SHAPES['worker embedding an absolute scope path mid-string'](ctx.fixture.coderWt);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the worker's cwd is unresolvable$/,
    (ctx) => {
      ctx.cwd = null;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the worker's parent is alive and the worker has exceeded the stale threshold$/,
    (ctx) => {
      ctx.parentState = 'alive';
      ctx.ageMs = 999999999;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the janitor sweep classifies reap candidates$/,
    (ctx) => {
      ctx.sweepResult = runClassifyBridge('sweep-worker', {
        projectRoot: ctx.fixture.root,
        worktree: ctx.fixture.coderWt,
        cmd: ctx.cmdline,
        cwd: ctx.cwd,
        ageMs: ctx.ageMs,
        parentState: ctx.parentState,
      });
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the worker is a reap candidate$/,
    (ctx) => {
      supervisorFixture.cleanupFixtureRoot(ctx.fixture);
      if (!ctx.sweepResult.reaped) {
        throw new Error(`expected the worker to be a reap candidate, sweep result: ${JSON.stringify(ctx.sweepResult)}`);
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
