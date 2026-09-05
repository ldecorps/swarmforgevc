'use strict';

// BL-1421: step handlers for "the post-QA branch sweep tells a role once
// per surfacing and wakes only a role that is not mid-parcel". Drives the
// REAL post_qa_branch_sweep_lib.bb sweep! via a Babashka runner
// (bl1421_one_standing_surfacing_acceptance_runner.bb), one invocation per
// Gherkin step that advances the sweep - a "Given already told" setup step
// and a later "When the sweep runs" step each report only their OWN
// tells, matching what each Then actually asserts (a fixed-up-front
// scenario would conflate "already told during setup" with "told BY this
// sweep run").
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const FEATURE = 'BL-1421 The post-QA branch sweep tells a role once per surfacing and wakes only a role that is not mid-parcel';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const RUNNER = path.join(
  REPO_ROOT, 'swarmforge', 'scripts', 'test',
  'bl1421_one_standing_surfacing_acceptance_runner.bb',
);

const ROLE = 'coder';

function run(dir, ticks) {
  const scenario = { role: ROLE, ticks, ...(dir ? { dir } : {}) };
  const out = execFileSync('bb', [RUNNER, JSON.stringify(scenario)], { encoding: 'utf8' });
  return JSON.parse(out);
}

// Called only from a scenario's LAST Then step (never mid-flow, where a
// later step still needs ctx.dir's accumulated state) - a bb-side
// mkdtemp root this runner owns outright for its own scenario's whole
// duration, so cleaning it up here is not the BL-1385/BL-1390 prefix-glob
// hazard (nothing else can be racing against a root this scenario alone
// created and is the only one to ever reference).
function cleanup(ctx) {
  if (ctx.dir) fs.rmSync(ctx.dir, { recursive: true, force: true });
}

// A tick's {dirty, inProcess, canFf} shape for each of scenario 01's three
// reasons - in-process is checked before dirty (BL-1421's own precedence
// fix), so "in_process work" sets both (a mid-parcel role IS dirty by
// definition, per the ticket's own framing) and still classifies as
// in-process-work.
function factsForReason(reason) {
  switch (reason) {
    case 'a dirty worktree':
      return { dirty: true, inProcess: false, canFf: false };
    case 'in_process work':
      return { dirty: true, inProcess: true, canFf: false };
    case 'a divergent branch':
      return { dirty: false, inProcess: false, canFf: false };
    default:
      throw new Error(`unknown reason: ${reason}`);
  }
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a fixture sweep state and a role whose branch is behind origin\/main$/, (ctx) => {
    ctx.dir = undefined;
  });

  // ── 01: a standing surfacing is not retold per landed commit ────────────
  scoped(/^the role was told it is behind commit A for (.+)$/, (ctx, reason) => {
    ctx.reasonFacts = factsForReason(reason);
    const result = run(ctx.dir, [{ landedSha: 'commitA', caughtUp: false, ...ctx.reasonFacts }]);
    ctx.dir = result.dir;
    if (result.tellCount !== 1) {
      throw new Error(`setup expected exactly one telling for commit A, got ${result.tellCount}`);
    }
  });

  scoped(/^commit B lands on origin\/main while the role's HEAD still lacks A$/, (ctx) => {
    ctx.result = run(ctx.dir, [{ landedSha: 'commitB', caughtUp: false, ...ctx.reasonFacts }]);
  });

  // ── shared When (all four scenarios) ─────────────────────────────────────
  scoped(/^the sweep runs$/, (ctx) => {
    if (!ctx.result) {
      // Scenarios that build their own tick(s) directly rather than via
      // the 01-specific Given steps above.
      ctx.result = run(ctx.dir, ctx.pendingTicks || []);
    }
  });

  scoped(/^the role is told nothing and woken nothing$/, (ctx) => {
    if (ctx.result.tellCount !== 0) {
      throw new Error(`expected no telling from this sweep run, got: ${JSON.stringify(ctx.result)}`);
    }
    cleanup(ctx);
  });

  // ── 02: catching up clears the surfacing ─────────────────────────────────
  scoped(/^the role was told it is behind commit A and its HEAD now contains A$/, (ctx) => {
    const setup = run(ctx.dir, [{ landedSha: 'commitA', caughtUp: false, dirty: true, inProcess: false, canFf: false }]);
    ctx.dir = setup.dir;
    if (setup.tellCount !== 1) {
      throw new Error(`setup expected exactly one telling for commit A, got ${setup.tellCount}`);
    }
    // "its HEAD now contains A" - the next tick this scenario runs supplies
    // caughtUp: true for exactly that reason.
    ctx.caughtUpNow = true;
  });

  scoped(/^commit B lands on origin\/main and the role's worktree is dirty again$/, (ctx) => {
    ctx.pendingTicks = [{ landedSha: 'commitB', caughtUp: ctx.caughtUpNow, dirty: true, inProcess: false, canFf: false }];
  });

  scoped(/^the role is told once that it is behind B$/, (ctx) => {
    if (ctx.result.tellCount !== 1) {
      throw new Error(`expected exactly one telling for commit B, got: ${JSON.stringify(ctx.result)}`);
    }
    cleanup(ctx);
  });

  // ── 03: in-process work is never woken ───────────────────────────────────
  scoped(/^the role holds an in_process parcel and its worktree is dirty from that work$/, (ctx) => {
    ctx.pendingTicks = [{ landedSha: 'commitA', caughtUp: false, dirty: true, inProcess: true, canFf: false }];
  });

  scoped(/^the role is told its branch is behind for in_process work$/, (ctx) => {
    const t = ctx.result.tells[0];
    if (!t || t.reason !== 'in-process-work') {
      throw new Error(`expected a single in-process-work telling, got: ${JSON.stringify(ctx.result)}`);
    }
  });

  scoped(/^the role is not woken$/, (ctx) => {
    if (ctx.result.tells[0].wake) {
      throw new Error(`expected the telling not to wake, got: ${JSON.stringify(ctx.result)}`);
    }
    cleanup(ctx);
  });

  // ── 04: the 2026-09-05 replay tells once ─────────────────────────────────
  scoped(/^a replay of 103 successive landed commits with the role dirty and behind throughout$/, (ctx) => {
    ctx.pendingTicks = Array.from({ length: 103 }, (_, i) => ({
      landedSha: `commit-${i}`,
      caughtUp: false,
      dirty: true,
      inProcess: false,
      canFf: false,
    }));
  });

  scoped(/^the sweep runs after each landed commit$/, (ctx) => {
    ctx.result = run(ctx.dir, ctx.pendingTicks);
  });

  scoped(/^the role is told exactly once and woken exactly once$/, (ctx) => {
    if (ctx.result.tellCount !== 1 || ctx.result.wakeCount !== 1) {
      throw new Error(`expected exactly one telling and one wake across the replay, got: ${JSON.stringify(ctx.result)}`);
    }
    cleanup(ctx);
  });
}

module.exports = { registerSteps };
