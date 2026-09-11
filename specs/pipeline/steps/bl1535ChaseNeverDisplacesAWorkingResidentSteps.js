'use strict';

// BL-1535: step handlers for "the chase never displaces a working resident".
// Drives the REAL test_chase_departing_mid_parcel_gate.sh, which exercises
// the real swarmforge/scripts/handoffd.bb attempt-resident-rotate! (the
// exact function the daemon's chase sweep calls) against a disposable
// fixture git repo, fake tmux on PATH, and real child processes standing in
// for "a command launched from the resident pane" - never a parallel
// reimplementation of the gate logic. Same fixture pattern
// bl805RotateGateOnUnfinishedInProcessParcelSteps.js uses for the sibling
// BL-805 gate: run the whole script once, assert on its own `PASS: <marker>`
// lines.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_chase_departing_mid_parcel_gate.sh');
const FEATURE = 'BL-1535 The chase never displaces a working resident';

function runGateTest() {
  const result = spawnSync('bash', [TEST_SCRIPT], { encoding: 'utf8' });
  return { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') };
}

// Memoized at MODULE scope, not per-ctx: the shell script drives real tmux
// respawns and a real handoff-lib/rotate-resident-to! per case (~15s each,
// 7 cases in one script run), so re-running it once per Gherkin scenario
// (a fresh ctx each time) would multiply that past the acceptance runner's
// 300s per-file mutant-timeout ceiling (runnerAdapter.js
// DEFAULT_MUTANT_TIMEOUT_MS). Every scenario in this generated file reads
// the SAME real run's output - one execution proves every case, same as
// the shell script itself already asserting all seven in a single pass.
let cachedResult = null;

function ensureResult() {
  if (!cachedResult) {
    cachedResult = runGateTest();
  }
  return cachedResult;
}

function requirePass(marker, description) {
  const { stdout } = ensureResult();
  if (!stdout.includes(`PASS: ${marker}`)) {
    throw new Error(`expected ${description} (${marker}):\n${stdout}`);
  }
}

// The Scenario Outline's two "<signal>" values and the standalone
// Given/When steps all resolve to one of the shell script's own case
// markers - set by whichever combination of Given steps a scenario uses,
// then read by the Then step that follows.
function registerSteps(registry) {
  // ── Background ─────────────────────────────────────────────────────────
  registry.defineScoped(/^a rotation-router fixture whose resident is seated as hardender$/, (ctx) => {
    ctx.bl1535 = { parcelHeld: true };
  }, FEATURE);

  registry.defineScoped(/^the hardender's inbox in_process holds a real parcel$/, (ctx) => {
    ctx.bl1535 = { ...(ctx.bl1535 || {}), parcelHeld: true };
  }, FEATURE);

  registry.defineScoped(/^an aged note waits in the specifier's inbox new$/, () => {
    // Fixture background, established by test_chase_departing_mid_parcel_gate.sh
    // itself (roles.tsv + the specifier's aged inbox/new parcel) for every scenario.
  }, FEATURE);

  // ── Given: footer / process-tree / challenge signals ─────────────────────
  registry.defineScoped(/^the resident pane footer reads idle$/, () => {
    // The fixture's fake tmux always answers an idle footer (no busy-spinner
    // marker in capture-pane) - every scenario here is about the OTHER
    // working signals, not the footer probe.
  }, FEATURE);

  registry.defineScoped(/^a command launched from the resident pane is still running$/, (ctx) => {
    ctx.bl1535 = { ...(ctx.bl1535 || {}), signal: 'live-process' };
  }, FEATURE);

  registry.defineScoped(/^the hardender's forward stands mid-audit with a fresh challenge$/, (ctx) => {
    ctx.bl1535 = { ...(ctx.bl1535 || {}), signal: 'fresh-challenge' };
  }, FEATURE);

  registry.defineScoped(/^the resident pane's process tree holds only its shell$/, (ctx) => {
    ctx.bl1535 = { ...(ctx.bl1535 || {}), signal: 'idle-tree' };
  }, FEATURE);

  registry.defineScoped(/^no audit challenge stands for the hardender$/, (ctx) => {
    ctx.bl1535 = { ...(ctx.bl1535 || {}), challenge: 'none' };
  }, FEATURE);

  registry.defineScoped(/^the hardender's audit challenge is older than the note actionability bound$/, (ctx) => {
    ctx.bl1535 = { ...(ctx.bl1535 || {}), challenge: 'stale' };
  }, FEATURE);

  registry.defineScoped(/^the hardender's inbox in_process is empty$/, (ctx) => {
    ctx.bl1535 = { ...(ctx.bl1535 || {}), parcelHeld: false };
  }, FEATURE);

  registry.defineScoped(/^the fixture pack gives every role its own pane$/, (ctx) => {
    ctx.bl1535 = { ...(ctx.bl1535 || {}), standingPack: true };
  }, FEATURE);

  // ── When ───────────────────────────────────────────────────────────────
  registry.defineScoped(/^the chase sweep decides whether to rotate the resident to "([^"]+)"$/, (ctx, target) => {
    ctx.bl1535 = { ...(ctx.bl1535 || {}), target };
    ensureResult();
  }, FEATURE);

  // ── Then ───────────────────────────────────────────────────────────────
  function markerFor(ctx) {
    const s = ctx.bl1535 || {};
    if (s.standingPack) return '06:';
    if (s.parcelHeld === false && s.signal === 'live-process') return '05:';
    if (s.signal === 'live-process' && s.target === 'hardender') return '04:';
    if (s.signal === 'live-process' && s.target !== 'hardender') return '01a:';
    if (s.signal === 'fresh-challenge') return '01b:';
    if (s.signal === 'idle-tree' && s.challenge === 'stale') return '03:';
    if (s.signal === 'idle-tree' && s.challenge === 'none') return '02:';
    return undefined;
  }

  registry.defineScoped(/^the rotation is refused as departing-mid-parcel$/, (ctx) => {
    const marker = markerFor(ctx);
    if (!marker) {
      throw new Error(`BL-1535: unrecognized scenario for "the rotation is refused as departing-mid-parcel": ${JSON.stringify(ctx.bl1535)}`);
    }
    requirePass(marker, 'the rotation refused as departing-mid-parcel');
  }, FEATURE);

  registry.defineScoped(/^a telemetry row names hardender, the held parcel and the signal that held it$/, (ctx) => {
    const marker = markerFor(ctx);
    requirePass(marker, 'a telemetry row naming hardender, the parcel and the signal');
  }, FEATURE);

  registry.defineScoped(/^the rotation proceeds$/, (ctx) => {
    const marker = markerFor(ctx);
    if (!marker) {
      throw new Error(`BL-1535: unrecognized scenario for "the rotation proceeds": ${JSON.stringify(ctx.bl1535)}`);
    }
    requirePass(marker, 'the rotation to proceed');
  }, FEATURE);

  registry.defineScoped(/^no rotation decision is made$/, () => {
    requirePass('06:', 'a standing pack to resolve non-router before any rotation decision');
  }, FEATURE);

  registry.defineScoped(/^no telemetry row is written$/, () => {
    requirePass('06:', 'no telemetry row for a standing pack, which never reaches this gate');
  }, FEATURE);
}

module.exports = { registerSteps };
