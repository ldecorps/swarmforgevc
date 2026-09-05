'use strict';

// BL-1433: step handlers driving the REAL post_qa_branch_sweep_lib.bb
// sweep! - scenarios 01/02/04 via the shared BL-1421 acceptance runner
// (extended here with an optional containsLanded tick field, defaulting
// to false so every pre-existing BL-1421/BL-1361 tick is unaffected),
// scenario 03 via a dedicated real-git-fixture runner. Never a
// reimplementation, never handoffd.bb itself (never load-file
// handoffd.bb - it boots daemon machinery as a side effect).
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const FEATURE = 'BL-1433 A branch that holds the landed commit is not behind';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const SWEEP_RUNNER = path.join(
  REPO_ROOT, 'swarmforge', 'scripts', 'test',
  'bl1421_one_standing_surfacing_acceptance_runner.bb',
);
const SUPPLIER_RUNNER = path.join(
  REPO_ROOT, 'swarmforge', 'scripts', 'test',
  'bl1433_supplier_git_facts_runner.bb',
);

const ROLE = 'coder';

function runSweep(dir, ticks) {
  const scenario = { role: ROLE, ticks, ...(dir ? { dir } : {}) };
  const out = execFileSync('bb', [SWEEP_RUNNER, JSON.stringify(scenario)], { encoding: 'utf8' });
  return JSON.parse(out);
}

function cleanup(ctx) {
  if (ctx.dir) fs.rmSync(ctx.dir, { recursive: true, force: true });
}

// Scenario 01's three <shape> examples - the worktree state varies, but
// every one already contains the landed commit.
function factsForShape(shape) {
  switch (shape) {
    case 'ahead by its own commits with a clean worktree':
      return { dirty: false, inProcess: false, canFf: false, containsLanded: true };
    case 'ahead by its own commits with a dirty worktree':
      return { dirty: true, inProcess: false, canFf: false, containsLanded: true };
    case 'ahead by its own commits with in_process work':
      return { dirty: true, inProcess: true, canFf: false, containsLanded: true };
    default:
      throw new Error(`unknown <shape>: ${shape}`);
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture sweep state and a landed commit$/, (ctx) => {
    ctx.dir = undefined;
  });

  // ── Scenario 01 (Outline) ────────────────────────────────────────────
  scoped(/^a role whose HEAD contains the landed commit and is (.+)$/, (ctx, shape) => {
    ctx.pendingTicks = [{ landedSha: 'commitA', ...factsForShape(shape) }];
  });

  scoped(/^the sweep runs$/, (ctx) => {
    if (!ctx.result) {
      ctx.result = runSweep(ctx.dir, ctx.pendingTicks || []);
      ctx.dir = ctx.result.dir;
    }
  });

  scoped(/^the role is told nothing and woken nothing$/, (ctx) => {
    if (ctx.result.tellCount !== 0) {
      throw new Error(`expected no telling, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  scoped(/^the sweep logs that the role already holds the landed commit$/, (ctx) => {
    const found = (ctx.result.logs || []).some((l) => l.includes('post-qa-branch-sweep-holds-landed'));
    if (!found) {
      throw new Error(`expected a holds-landed log line, got: ${JSON.stringify(ctx.result.logs)}`);
    }
    cleanup(ctx);
  });

  // ── Scenario 02 ──────────────────────────────────────────────────────
  scoped(/^a divergent role whose branch lacks the landed commit$/, (ctx) => {
    ctx.divergentFacts = { dirty: false, inProcess: false, canFf: false, containsLanded: false };
  });

  scoped(/^two consecutive sweeps pass with nothing changed between them$/, (ctx) => {
    ctx.firstResult = runSweep(ctx.dir, [{ landedSha: 'commitZ', ...ctx.divergentFacts }]);
    ctx.dir = ctx.firstResult.dir;
    ctx.secondResult = runSweep(ctx.dir, [{ landedSha: 'commitZ', ...ctx.divergentFacts }]);
  });

  scoped(/^the first sweep tells the role once that its branch cannot fast-forward$/, (ctx) => {
    if (ctx.firstResult.tellCount !== 1 || ctx.firstResult.tells[0].reason !== 'divergent-branch') {
      throw new Error(`expected one divergent-branch telling, got: ${JSON.stringify(ctx.firstResult)}`);
    }
  });

  scoped(/^the second sweep tells it nothing$/, (ctx) => {
    if (ctx.secondResult.tellCount !== 0) {
      throw new Error(`expected no telling on the repeat sweep, got: ${JSON.stringify(ctx.secondResult)}`);
    }
    cleanup(ctx);
  });

  // ── Scenario 03 ──────────────────────────────────────────────────────
  scoped(/^a git fixture where the role's branch is origin\/main plus one commit of its own$/, () => {
    // Fixture is built inside the runner itself (a fresh mkdtemp root each
    // invocation) - nothing to stage here.
  });

  scoped(/^the daemon's fact supplier reads the role$/, (ctx) => {
    const out = execFileSync('bb', [SUPPLIER_RUNNER], { encoding: 'utf8' });
    ctx.supplierFacts = JSON.parse(out);
  });

  scoped(/^it reports that HEAD contains the landed commit$/, (ctx) => {
    if (ctx.supplierFacts['contains-landed?'] !== true) {
      throw new Error(`expected contains-landed? true, got: ${JSON.stringify(ctx.supplierFacts)}`);
    }
  });

  scoped(/^it reports that the branch cannot fast-forward$/, (ctx) => {
    if (ctx.supplierFacts['can-ff?'] !== false) {
      throw new Error(`expected can-ff? false, got: ${JSON.stringify(ctx.supplierFacts)}`);
    }
  });

  // ── Scenario 04 ──────────────────────────────────────────────────────
  scoped(/^twenty consecutive sweep cycles over an ahead-only role that holds the landed commit$/, (ctx) => {
    ctx.pendingTicks = Array.from({ length: 20 }, (_, i) => ({
      landedSha: `commit-${i}`,
      dirty: i % 2 === 0,
      inProcess: i % 3 === 0,
      canFf: false,
      containsLanded: true,
    }));
  });

  scoped(/^every replayed cycle has completed$/, (ctx) => {
    ctx.result = runSweep(ctx.dir, ctx.pendingTicks);
    ctx.dir = ctx.result.dir;
  });

  scoped(/^no cycle produced a note for that role$/, (ctx) => {
    if (ctx.result.tellCount !== 0) {
      throw new Error(`expected zero tells across all 20 cycles, got: ${JSON.stringify(ctx.result)}`);
    }
    cleanup(ctx);
  });
}

module.exports = { registerSteps };
