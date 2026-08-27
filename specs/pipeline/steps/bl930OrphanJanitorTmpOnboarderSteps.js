'use strict';

// BL-930: step handlers for "BL-930 orphan janitor reaps tmp-rooted
// onboarder leftovers". Drives the REAL Babashka decision/wiring functions
// (orphan_janitor_lib.bb's tmp-ancillary-cmdline? gate, extended for the two
// onboarder entry points) via bl930_orphan_janitor_tmp_onboarder_acceptance_
// runner.bb - same JSON-bridge pattern as bl879ParentOrphanedFrontDeskSteps.js,
// never a hand-rolled reimplementation of the reap decision in JS. Per the
// ticket's own notes, this file deliberately reuses bl879's step vocabulary
// verbatim rather than inventing a third dialect.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'bl930_orphan_janitor_tmp_onboarder_acceptance_runner.bb'
);

const FEATURE_NAME = 'BL-930 orphan janitor reaps tmp-rooted onboarder leftovers';

const DISPOSABLE_ROOT = '/tmp/tmp.bl930fixt';
const HOST_ROOT = '/Users/ldecorps/projects/swarmforgevc';

const KNOWN_PARENT_STATES = {
  gone: 'gone',
  alive: 'alive',
};

const KNOWN_OUTCOMES = {
  reaped: true,
  'not reaped': false,
};

const KNOWN_ANCILLARIES = {
  'the onboarder reconcile loop': (root) =>
    `node ${root}/swarm/extension/out/tools/onboarder-reconcile.js ${root}/swarm poll-loop`,
  'the onboarder supervisor': (root) => `bb ${root}/swarm/onboarder_supervisor.bb ${root}/swarm`,
};

function run(subcommand, payload) {
  const out = execFileSync('bb', [RUNNER, subcommand, JSON.stringify(payload || {})], { encoding: 'utf8' });
  return JSON.parse(out);
}

function runSweep(ctx) {
  ctx.sweepResult = run('sweep-one-ancillary', {
    cmdline: ctx.cmdline,
    fresh: ctx.fresh !== false,
    parentState: ctx.parentState,
  });
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^a host running the orphan janitor sweep$/,
    (ctx) => {
      ctx.fresh = true;
    },
    FEATURE_NAME
  );

  // ── shared Givens across scenarios ──────────────────────────────────
  registry.defineScoped(
    /^an ancillary process running under a disposable root$/,
    (ctx) => {
      ctx.root = DISPOSABLE_ROOT;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^a process with no extractable disposable root$/,
    (ctx) => {
      ctx.root = HOST_ROOT;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^its command line names (.+)$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_ANCILLARIES, raw)) {
        throw new Error(`bl930: unrecognized <ancillary> example value "${raw}"`);
      }
      ctx.cmdline = KNOWN_ANCILLARIES[raw](ctx.root);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it is younger than the ancillary age gate$/,
    (ctx) => {
      ctx.fresh = true;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^it is older than the ancillary age gate$/,
    (ctx) => {
      ctx.fresh = false;
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^its parent process is (.+)$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_PARENT_STATES, raw)) {
        throw new Error(`bl930: unrecognized <parent state> example value "${raw}"`);
      }
      ctx.parentState = KNOWN_PARENT_STATES[raw];
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the sweep runs$/,
    (ctx) => {
      runSweep(ctx);
    },
    FEATURE_NAME
  );

  // ── tmp-rooted-onboarder-reaped-01 / no-parent-orphaned-fast-path-02 ───
  registry.defineScoped(
    /^the process is (.+)$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_OUTCOMES, raw)) {
        throw new Error(`bl930: unrecognized <outcome> example value "${raw}"`);
      }
      const expectedReaped = KNOWN_OUTCOMES[raw];
      if (ctx.sweepResult.reaped !== expectedReaped) {
        throw new Error(
          `expected reaped=${expectedReaped} for "${raw}", got: ${JSON.stringify(ctx.sweepResult)}`
        );
      }
    },
    FEATURE_NAME
  );

  // ── tmp-rooted-onboarder-reaped-01 ──────────────────────────────────
  registry.defineScoped(
    /^the audit line for that reap names the disposable root$/,
    (ctx) => {
      const found = (ctx.sweepResult.audits || []).some((line) => line.includes(`root=${ctx.root}`));
      if (!found) {
        throw new Error(
          `expected an audit line naming root=${ctx.root}, got: ${JSON.stringify(ctx.sweepResult.audits)}`
        );
      }
    },
    FEATURE_NAME
  );

  // ── host-repo-onboarder-never-candidate-03 ──────────────────────────
  registry.defineScoped(
    /^no reap decision is taken against it$/,
    (ctx) => {
      if (ctx.sweepResult.isCandidate || ctx.sweepResult.tmpProjectRoot) {
        throw new Error(
          `expected a host-rooted onboarder process to never even become a reap candidate, got: ${JSON.stringify(
            ctx.sweepResult
          )}`
        );
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
