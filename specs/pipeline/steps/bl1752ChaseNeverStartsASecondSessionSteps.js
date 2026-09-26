'use strict';

// BL-1752: step handlers for "the chase never starts a second session on a
// mono-router pack". Drives the REAL test_chase_departing_mid_parcel_gate.sh
// (extended by this same parcel with cases 08a-10), which exercises the
// real swarmforge/scripts/handoffd.bb attempt-resident-rotate! against a
// disposable fixture git repo, fake tmux on PATH, and real child processes
// standing in for "a command launched from the resident pane" - never a
// parallel reimplementation of the gate. Same fixture pattern
// bl1535ChaseNeverDisplacesAWorkingResidentSteps.js uses for the sibling
// BL-1535 gate: run the whole script once, assert on its own `PASS: <marker>`
// lines. The fixture's own hardender/specifier pair stands in for this
// feature's documenter/specifier pair - the gate is keyed on IDENTITY
// (departing vs target role) and RESIDENT STATE, never on which role name
// is used, so the Background/Given steps below are narrative only.
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TEST_SCRIPT = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'test', 'test_chase_departing_mid_parcel_gate.sh');
const FEATURE = 'BL-1752 The chase never starts a second session on a mono-router pack';

function runGateTest() {
  const result = spawnSync('bash', [TEST_SCRIPT], { encoding: 'utf8', timeout: 120000 });
  return { status: result.status, stdout: (result.stdout || '') + (result.stderr || '') };
}

// Memoized at MODULE scope, not per-ctx - same rationale as BL-1535's own
// step handler: the shell script drives real tmux respawns and real child
// processes per case (13 cases in one script run, seconds each), so
// re-running it once per Gherkin scenario would multiply real wall-clock
// wastefully. Every scenario in this generated file reads the SAME real
// run's output - one execution proves every case.
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

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  // ── Background ───────────────────────────────────────────────────────
  scoped(/^a mono-router fixture whose resident is seated as documenter$/, (ctx) => {
    ctx.bl1752 = {};
  }, FEATURE);

  // ── Given ────────────────────────────────────────────────────────────
  scoped(/^the resident holds a documenter parcel and is mid-turn$/, (ctx) => {
    ctx.bl1752 = { ...(ctx.bl1752 || {}) };
  }, FEATURE);

  scoped(/^specifier's mailbox holds "?([^"]+?)"?$/, (ctx, mail) => {
    const KNOWN_VALUES = {
      'a git_handoff parcel': '08a',
      'a note from documenter': '08b',
      'a raw intake in the backlog root': '08c',
    };
    const marker = KNOWN_VALUES[mail];
    if (!marker) {
      throw new Error(`BL-1752: unrecognized mail value "${mail}" - expected one of ${Object.keys(KNOWN_VALUES).join(', ')}`);
    }
    ctx.bl1752 = { ...(ctx.bl1752 || {}), marker };
  }, FEATURE);

  scoped(/^the pack conf also carries the line "config single_inference_slot 1"$/, (ctx) => {
    ctx.bl1752 = { ...(ctx.bl1752 || {}), marker: '10' };
  }, FEATURE);

  // ── When ─────────────────────────────────────────────────────────────
  scoped(/^the resident's turn ends$/, (ctx) => {
    ctx.bl1752 = { ...(ctx.bl1752 || {}), marker: '09' };
  }, FEATURE);

  scoped(/^the pack conf is parsed$/, (ctx) => {
    ctx.bl1752 = { ...(ctx.bl1752 || {}), marker: '10' };
  }, FEATURE);

  scoped(/^the chase sweep runs$/, (ctx) => {
    if (!ctx.bl1752 || !ctx.bl1752.marker) {
      throw new Error('BL-1752: "the chase sweep runs" reached with no case marker resolved yet');
    }
    ensureResult();
  }, FEATURE);

  // ── Then ─────────────────────────────────────────────────────────────
  function requireMarker(ctx, description) {
    const marker = ctx.bl1752 && ctx.bl1752.marker;
    if (!marker) {
      throw new Error(`BL-1752: unrecognized scenario for "${description}": ${JSON.stringify(ctx.bl1752)}`);
    }
    return marker;
  }

  scoped(/^no tmux session is created$/, (ctx) => {
    requirePass(requireMarker(ctx, 'no tmux session is created'), 'no tmux session created');
  }, FEATURE);

  scoped(/^no consult marker is written$/, (ctx) => {
    requirePass(requireMarker(ctx, 'no consult marker is written'), 'no consult marker written');
  }, FEATURE);

  scoped(/^the resident is rotated to specifier$/, (ctx) => {
    requirePass(requireMarker(ctx, 'the resident is rotated to specifier'), 'the resident rotated to specifier');
  }, FEATURE);

  scoped(/^the parse succeeds$/, (ctx) => {
    requirePass(requireMarker(ctx, 'the parse succeeds'), 'the pack conf parse to succeed');
  }, FEATURE);
}

module.exports = { registerSteps };
