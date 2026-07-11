'use strict';

// BL-270: step handlers for the stage-dwell-fixed-clock feature. Drives the
// REAL compiled buildStageDwellState against a real fixture directory, with
// BOTH the fixture's own timestamps and the evaluation clock pinned to
// constants (never new Date()/Date.now()) - proving the exact real-clock-
// fixture-vs-real-clock-code flake pattern (engineering article, de0991e)
// cannot recur, by running the computation twice and asserting the results
// are identical.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { buildStageDwellState } = require(path.join(EXT_DIR, 'out', 'bridge', 'bridgeState'));

// Same half-open [earliest, latest) window readRoleStageDwellRecords uses
// (stageDwell.ts) - the fixed "now" sits a full minute after the fixture's
// completed_at so completedAtMs < nowMs holds with a real margin, never an
// equal-boundary straddle.
const FIXED_COMPLETED_MS = Date.parse('2026-07-09T12:00:00.000Z');
const FIXED_NOW_MS = FIXED_COMPLETED_MS + 60 * 1000;

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeRolesTsv(targetPath, roles) {
  mkdirp(path.join(targetPath, '.swarmforge'));
  const tsv = roles
    .map((r) => [r.role, 'session', r.worktreePath, `swarmforge-${r.role}`, r.displayName, 'claude', 'task'].join('\t'))
    .join('\n');
  fs.writeFileSync(path.join(targetPath, '.swarmforge', 'roles.tsv'), tsv + '\n');
}

function registerSteps(registry) {
  registry.define(
    /^a completed handoff fixture whose dequeued_at and completed_at are built from a fixed reference instant$/,
    (ctx) => {
      ctx.targetPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-stage-dwell-fixed-clock-'));
      const coderWt = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-stage-dwell-fixed-clock-wt-'));
      writeRolesTsv(ctx.targetPath, [{ role: 'coder', worktreePath: coderWt, displayName: 'Coder' }]);
      const completedDir = path.join(coderWt, '.swarmforge', 'handoffs', 'inbox', 'completed');
      mkdirp(completedDir);
      const dequeuedAt = new Date(FIXED_COMPLETED_MS - 10 * 60 * 1000).toISOString();
      const completedAt = new Date(FIXED_COMPLETED_MS).toISOString();
      fs.writeFileSync(
        path.join(completedDir, '00_test.handoff'),
        `task: BL-1-fixture\ndequeued_at: ${dequeuedAt}\ncompleted_at: ${completedAt}\n\nbody\n`
      );
    }
  );

  registry.define(/^the same fixed instant is injected as the stage-dwell evaluation time$/, (ctx) => {
    ctx.nowMs = FIXED_NOW_MS;
  });

  registry.define(/^the stage-dwell report is computed for the fixture$/, (ctx) => {
    // Computed TWICE from the exact same inputs - the "stable across
    // repeated runs" claim is asserted below by comparing them, not merely
    // by not-throwing once.
    ctx.resultOne = buildStageDwellState(ctx.targetPath, ctx.nowMs);
    ctx.resultTwo = buildStageDwellState(ctx.targetPath, ctx.nowMs);
  });

  registry.define(/^it counts the fixture parcel as processed in the window$/, (ctx) => {
    const coderStage = ctx.resultOne.stages.find((s) => s.role === 'coder');
    if (!coderStage || coderStage.parcelsProcessed !== 1) {
      throw new Error(`expected the fixture parcel to be counted as processed; got: ${JSON.stringify(ctx.resultOne.stages)}`);
    }
  });

  registry.define(/^it names the fixture's role as the bottleneck$/, (ctx) => {
    if (ctx.resultOne.bottleneck?.role !== 'coder') {
      throw new Error(`expected "coder" as the bottleneck; got: ${JSON.stringify(ctx.resultOne.bottleneck)}`);
    }
  });

  registry.define(/^the same inputs always produce the same result, with no dependence on the real clock$/, (ctx) => {
    if (JSON.stringify(ctx.resultOne) !== JSON.stringify(ctx.resultTwo)) {
      throw new Error('expected two computations from the same fixed inputs to produce byte-identical results');
    }
  });
}

module.exports = { registerSteps };
