'use strict';

// BL-926: step handlers for "rotating a pane into a parcel's own owner is
// not abandonment". Drives test_rotate_to_role_stuck_parcel_gate.sh, which
// exercises the REAL rotate_to_role.sh / handoff_lib.bb against a disposable
// fixture git repo (fake tmux) - never a parallel reimplementation of the
// gate logic. Same one-full-run-memoized-per-scenario pattern as
// bl805RotateGateOnUnfinishedInProcessParcelSteps.js.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_rotate_to_role_stuck_parcel_gate.sh');
const FEATURE = "rotating a pane into a parcel's own owner is not abandonment";

const KNOWN_ROLES = new Set(['coder', 'documenter']);
const BOX_STATE_TO_KEY = {
  'a real parcel': 'real-parcel',
  'no parcel': 'no-parcel',
  'a sidecar only': 'sidecar-only',
};
const KNOWN_DECISIONS = new Set(['proceed', 'refuse', 'proceed-forced']);

// (target === departing?, box, forceOverride) -> the shell script's PASS
// marker that proves that exact combination. Explicit KNOWN_VALUES table,
// never a passthrough - an unrecognized combination throws.
function resolveMarker(ctx) {
  const { departing, target, box, forceOverride } = ctx.bl926;
  const sameOwner = departing === target;
  if (sameOwner && box === 'real-parcel') return '09:';
  if (!sameOwner && box === 'real-parcel' && forceOverride) return '05:';
  if (!sameOwner && box === 'real-parcel' && !forceOverride) return '01:';
  if (!sameOwner && box === 'no-parcel') return '02:';
  if (!sameOwner && box === 'sidecar-only') return '03:';
  throw new Error(`BL-926: no known scenario for ${JSON.stringify(ctx.bl926)}`);
}

// resolveMarker is keyed on shape (departing/target/box/forceOverride), not
// on the Examples table's own <decision> literal - so mutating a Scenario
// Outline decision cell alone would resolve the same marker and pass. Pin
// each marker's real outcome so the <decision> the fixture actually asserts
// is checked against what the shell test scenario itself proves, not merely
// whitelisted for being a recognized word.
const MARKER_EXPECTED_DECISION = {
  '09:': 'proceed',
  '01:': 'refuse',
  '02:': 'proceed',
  '03:': 'proceed',
  '05:': 'proceed-forced',
};

function runGateTest() {
  const result = spawnSync('bash', [TEST_SCRIPT], { encoding: 'utf8' });
  return { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') };
}

function ensureResult(ctx) {
  if (!ctx.bl926.result) {
    ctx.bl926.result = runGateTest();
  }
  return ctx.bl926.result;
}

function requirePass(ctx, marker, description) {
  const { stdout } = ensureResult(ctx);
  if (!stdout.includes(`PASS: ${marker}`)) {
    throw new Error(`expected ${description} (${marker}):\n${stdout}`);
  }
}

function registerSteps(registry) {
  registry.defineScoped(/^a mono-router pack whose single resident pane serves every role in turn$/, (ctx) => {
    ctx.bl926 = {};
  }, FEATURE);

  registry.defineScoped(/^the active-role marker names "([^"]+)"$/, (ctx, departing) => {
    if (!KNOWN_ROLES.has(departing)) {
      throw new Error(`BL-926: unrecognized departing role "${departing}"`);
    }
    ctx.bl926 = { ...(ctx.bl926 || {}), departing };
  }, FEATURE);

  registry.defineScoped(/^that role's in_process box holds (a real parcel|no parcel|a sidecar only)$/, (ctx, boxState) => {
    const box = BOX_STATE_TO_KEY[boxState];
    ctx.bl926 = { ...(ctx.bl926 || {}), box };
  }, FEATURE);

  registry.defineScoped(/^the rotate force override is set$/, (ctx) => {
    ctx.bl926 = { ...(ctx.bl926 || {}), forceOverride: true };
  }, FEATURE);

  registry.defineScoped(/^the resident invokes rotation to "([^"]+)"$/, (ctx, target) => {
    if (!KNOWN_ROLES.has(target)) {
      throw new Error(`BL-926: unrecognized rotation target "${target}"`);
    }
    ctx.bl926 = { ...(ctx.bl926 || {}), target };
    ensureResult(ctx);
  }, FEATURE);

  registry.defineScoped(/^the rotate gate decision is "([^"]+)"$/, (ctx, decision) => {
    if (!KNOWN_DECISIONS.has(decision)) {
      throw new Error(`BL-926: unrecognized decision "${decision}"`);
    }
    const marker = resolveMarker(ctx);
    const expected = MARKER_EXPECTED_DECISION[marker];
    if (expected !== decision) {
      throw new Error(
        `BL-926: Examples row claims decision "${decision}" but scenario ${marker} ` +
        `(${JSON.stringify(ctx.bl926)}) proves "${expected}"`
      );
    }
    requirePass(ctx, marker, `the rotate gate decision to be "${decision}"`);
  }, FEATURE);

  registry.defineScoped(/^that role's in_process box still holds the same parcel unchanged$/, (ctx) => {
    requirePass(ctx, resolveMarker(ctx), 'the parcel to survive a same-role rotation byte-identical');
  }, FEATURE);

  registry.defineScoped(/^that role's next receive resumes the parcel rather than reporting no task$/, (ctx) => {
    requirePass(ctx, resolveMarker(ctx), 'exactly one in_process parcel left as the resume precondition');
  }, FEATURE);

  registry.defineScoped(/^the warning names the parcel left behind$/, (ctx) => {
    requirePass(ctx, '05:', 'a loud warning naming the stuck parcel left behind');
  }, FEATURE);
}

module.exports = { registerSteps };
