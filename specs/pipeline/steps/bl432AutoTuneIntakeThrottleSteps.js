'use strict';

// BL-432 (epic BL-429 slice 3 - ACT, the mandatory wiring slice): step
// handlers for "the swarm auto-throttles its own intake when it diagnoses
// too much rework". Drives the REAL, compiled/executable artifacts end to
// end - never a re-implementation of the combination logic in JS:
//   - persistReworkSignal (reworkObservatoryStore.js) seeds BL-430's real
//     signal store exactly as the live observatory sweep would.
//   - "the coordinator decides whether to promote the next item" shells to
//     the REAL effective_backlog_depth_cli.bb, the actual entry point
//     coordinator.prompt calls before every promotion - which itself shells
//     to the REAL compiled emit-throttle-recommendation.js (Babashka has no
//     way to import compiled TS). One process boundary crossed exactly the
//     way production crosses it, so this proves the WIRING, not just each
//     language's own half in isolation.
// The fixture's own extension/ is a symlink to this checkout's real,
// already-compiled one (mirrors the Stryker sandbox siblings' own
// cross-directory-symlink convention) - never a copy, never a fake.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const EXTENSION_DIR = path.join(REPO_ROOT, 'extension');
const EFFECTIVE_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'effective_backlog_depth_cli.bb');
const { persistReworkSignal } = require(path.join(EXTENSION_DIR, 'out', 'metrics', 'reworkObservatoryStore'));

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeConfiguredCap(targetRepo, cap) {
  fs.mkdirSync(path.join(targetRepo, 'swarmforge'), { recursive: true });
  fs.writeFileSync(path.join(targetRepo, 'swarmforge', 'swarmforge.conf'), `config active_backlog_max_depth ${cap}\n`);
}

function writeSignal(targetRepo, overrides) {
  persistReworkSignal(targetRepo, {
    kind: 'rework-rate',
    version: 1,
    computedAtIso: '2026-07-16T00:00:00Z',
    signal: { hasSample: true, sampleCount: 10, reworkRate: 0.5, baselineRate: 0.1, topRole: null, topTicketClass: null, ...overrides },
  });
}

// The one place "the coordinator decides whether to promote" actually runs -
// the REAL bb CLI, which itself shells to the REAL node CLI. Returns the
// printed effective cap as a number.
function decidePromotion(ctx) {
  const out = execFileSync('bb', [EFFECTIVE_CLI, ctx.targetRepo], { encoding: 'utf8' });
  ctx.effectiveCap = Number.parseInt(out.trim(), 10);
  if (!Number.isFinite(ctx.effectiveCap)) {
    throw new Error(`expected effective_backlog_depth_cli.bb to print an integer, got: ${JSON.stringify(out)}`);
  }
}

function changeLogPath(targetRepo) {
  return path.join(targetRepo, '.swarmforge', 'coordinator', 'throttle-changes.jsonl');
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a configured active-depth cap and a rework diagnosis$/, (ctx) => {
    ctx.targetRepo = mkTmp('bl432-auto-tune-');
    fs.symlinkSync(EXTENSION_DIR, path.join(ctx.targetRepo, 'extension'));
    ctx.configuredCap = 3;
    writeConfiguredCap(ctx.targetRepo, ctx.configuredCap);
  });

  // ── auto-tune-intake-throttle-01 ────────────────────────────────────────
  registry.define(/^the rework diagnosis is degraded$/, (ctx) => {
    // Between 2x and 4x baseline - classifyThrottleSeverity's own
    // "degraded" band (reworkDiagnosis.ts, ABOVE_BASELINE_MULTIPLIER..
    // SEVERE_BASELINE_MULTIPLIER).
    writeSignal(ctx.targetRepo, { reworkRate: 0.3, baselineRate: 0.1 });
  });

  registry.define(/^the coordinator decides whether to promote the next item$/, (ctx) => decidePromotion(ctx));

  registry.define(/^the effective active-depth cap is one$/, (ctx) => {
    assert.equal(ctx.effectiveCap, 1);
  });

  // ── auto-tune-intake-throttle-02 ────────────────────────────────────────
  registry.define(/^the rework diagnosis is severe$/, (ctx) => {
    // Past 4x baseline - classifyThrottleSeverity's own "severe" band.
    writeSignal(ctx.targetRepo, { reworkRate: 0.5, baselineRate: 0.1 });
  });

  registry.define(/^the effective active-depth cap is zero$/, (ctx) => {
    assert.equal(ctx.effectiveCap, 0);
  });

  registry.define(/^no new item is promoted$/, (ctx) => {
    // A cap of zero means under-depth-cap? (backlog_depth_lib.bb, already
    // unit-tested in backlog_depth_test_runner.bb) is false for ANY
    // active-count >= 0 - there is no active-count at which zero admits a
    // promotion. Asserted here by definition of the printed value itself,
    // never a second re-derivation of that gate in JS.
    assert.equal(ctx.effectiveCap, 0, 'a cap of zero means the coordinator promotion gate can never open');
  });

  // ── auto-tune-intake-throttle-03 ────────────────────────────────────────
  registry.define(/^the rework diagnosis had lowered the effective cap$/, (ctx) => {
    writeSignal(ctx.targetRepo, { reworkRate: 0.3, baselineRate: 0.1 }); // degraded
    decidePromotion(ctx); // bakes the recommendation onto disk, exactly as a prior real promotion decision would have
    assert.equal(ctx.effectiveCap, 1, 'setup: expected the degraded recommendation already in effect');
  });

  registry.define(/^the rework diagnosis returns to baseline$/, (ctx) => {
    writeSignal(ctx.targetRepo, { reworkRate: 0.1, baselineRate: 0.1 }); // at baseline - no verdict at all
  });

  registry.define(/^the effective active-depth cap is the configured value$/, (ctx) => {
    assert.equal(ctx.effectiveCap, ctx.configuredCap);
  });

  // ── auto-tune-intake-throttle-04 ────────────────────────────────────────
  // A recommendation only ever ranges over {0, 1} (recommendedCapForSeverity's
  // own allowlist), so "above the configured value" is reached the same way
  // the real pipeline reaches it: configure a cap BELOW what a degraded
  // diagnosis would recommend (0 < 1), never a synthetic recommendation the
  // real diagnosis pipeline could not actually produce.
  registry.define(/^a rework diagnosis recommending a cap above the configured value$/, (ctx) => {
    ctx.configuredCap = 0;
    writeConfiguredCap(ctx.targetRepo, ctx.configuredCap);
    writeSignal(ctx.targetRepo, { reworkRate: 0.3, baselineRate: 0.1 }); // degraded -> recommends 1, which is > 0
  });

  // ── auto-tune-intake-throttle-05 ────────────────────────────────────────
  registry.define(/^the rework diagnosis lowers the effective cap$/, (ctx) => {
    writeSignal(ctx.targetRepo, { reworkRate: 0.3, baselineRate: 0.1 }); // degraded
  });

  registry.define(/^the effective cap changes$/, (ctx) => decidePromotion(ctx));

  registry.define(/^the change is written to the log with its reason$/, (ctx) => {
    const lines = fs
      .readFileSync(changeLogPath(ctx.targetRepo), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    assert.ok(lines.length >= 1, 'expected at least one change-log entry');
    const last = lines[lines.length - 1];
    assert.equal(last.to, 1);
    assert.ok(typeof last.reason === 'string' && last.reason.length > 0, `expected a non-empty reason, got: ${JSON.stringify(last)}`);
  });
}

module.exports = { registerSteps };
