'use strict';

// BL-879: step handlers for "A front-desk leftover that has lost its
// supervisor is reaped before it can steal the host bridge port". Drives
// the REAL Babashka decision/wiring functions (the landed hotfix under
// review, commit 36ea0109e9) via bl879_parent_orphaned_front_desk_
// acceptance_runner.bb - same JSON-bridge pattern as
// bl849DarwinOrphanJanitorHotfixSteps.js, never a hand-rolled
// reimplementation of the reap decision in JS.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(
  REPO_ROOT,
  'swarmforge',
  'scripts',
  'test',
  'bl879_parent_orphaned_front_desk_acceptance_runner.bb'
);

const FEATURE_NAME =
  'A front-desk leftover that has lost its supervisor is reaped before it can steal the host bridge port';

const DISPOSABLE_ROOT = '/tmp/tmp.bl879fixt';
const HOST_ROOT = '/Users/ldecorps/projects/swarmforgevc';

const FRONT_DESK_ENTRYPOINT = 'extension/out/tools/start-bridge-headless.js';

const KNOWN_PARENT_STATES = {
  gone: 'gone',
  alive: 'alive',
  'not determinable': 'not-determinable',
};

const KNOWN_OUTCOMES = {
  reaped: true,
  'not reaped': false,
};

const KNOWN_ANCILLARIES = {
  'a babysitter daemon': (root) => `bash ${root}/swarmforge/scripts/babysitterd.sh ${root}`,
  'the tmux binary': (root) => `/usr/local/bin/tmux -S ${root}/bl647.sock new-session -d -s swarmforge-coder -n agent`,
};

function run(subcommand, payload) {
  const out = execFileSync('bb', [RUNNER, subcommand, JSON.stringify(payload || {})], { encoding: 'utf8' });
  return JSON.parse(out);
}

function frontDeskCmdline(root) {
  return `node ${root}/${FRONT_DESK_ENTRYPOINT} ${root} 8765`;
}

function runSweep(ctx) {
  ctx.sweepResult = run('sweep-one-ancillary', {
    cmdline: ctx.cmdline,
    fresh: ctx.fresh !== false,
    parentState: ctx.parentState,
    inLiveWindow: !!ctx.inLiveWindow,
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
    /^its command line names the front-desk bridge or bot$/,
    (ctx) => {
      ctx.cmdline = frontDeskCmdline(ctx.root);
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^its command line names (.+)$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_ANCILLARIES, raw)) {
        throw new Error(`bl879: unrecognized <ancillary> example value "${raw}"`);
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
    /^its parent process is (.+)$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_PARENT_STATES, raw)) {
        throw new Error(`bl879: unrecognized <parent state> example value "${raw}"`);
      }
      ctx.parentState = KNOWN_PARENT_STATES[raw];
    },
    FEATURE_NAME
  );

  registry.defineScoped(
    /^the process is in the live window set$/,
    (ctx) => {
      ctx.inLiveWindow = true;
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

  // ── parent-orphaned-front-desk-01 / 03 / 05 ─────────────────────────
  registry.defineScoped(
    /^the process is (.+)$/,
    (ctx, raw) => {
      if (!Object.prototype.hasOwnProperty.call(KNOWN_OUTCOMES, raw)) {
        throw new Error(`bl879: unrecognized <outcome> example value "${raw}"`);
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

  // ── parent-orphaned-front-desk-02 ───────────────────────────────────
  registry.defineScoped(
    /^the audit line for that reap carries the parent-orphaned front-desk reason$/,
    (ctx) => {
      const found = (ctx.sweepResult.audits || []).some((line) =>
        line.includes('reason=parent-orphaned-front-desk')
      );
      if (!found) {
        throw new Error(
          `expected an audit line carrying reason=parent-orphaned-front-desk, got: ${JSON.stringify(
            ctx.sweepResult.audits
          )}`
        );
      }
    },
    FEATURE_NAME
  );

  // ── parent-orphaned-front-desk-04 ───────────────────────────────────
  registry.defineScoped(
    /^no reap decision is taken against it$/,
    (ctx) => {
      if (ctx.sweepResult.isCandidate || ctx.sweepResult.tmpProjectRoot) {
        throw new Error(
          `expected a host-rooted front-desk process to never even become a reap candidate, got: ${JSON.stringify(
            ctx.sweepResult
          )}`
        );
      }
    },
    FEATURE_NAME
  );
}

module.exports = { registerSteps };
