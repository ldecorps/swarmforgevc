'use strict';

// BL-1317 Adapt tier: a seat's reasoning effort climbs from outcome signals
// and drops only after sustained clean work.
//
// BL-236 shipped Suggest-only and deferred Adapt. BL-1316 sets the
// CLAIM-TIME baseline from the held ticket's mutation_cost. Adapt moves
// around that baseline and never below it, so a hard ticket that keeps
// bouncing can climb without a human turning the dial, while an easy ticket
// cannot be dragged down under the floor its difficulty already bought.
//
// The asymmetry is the point (declared invariant 2): a climb is ONE notch per
// signal, a drop needs a whole clean streak. That is BL-545's descent-ladder
// hysteresis - cheap to escalate under evidence of under-thinking, expensive
// to de-escalate, because the cost of thinking too little is a bounce and the
// cost of thinking too much is only tokens.

const assert = require('node:assert/strict');
const {
  decideAdaptEffort,
  adaptRoleEffort,
  ADAPT_EFFORT_LADDER,
  ADAPT_DEFAULT_CLEAN_STREAK,
} = require('../out/tools/effortDialAdapt');
const { EFFORT_LEVELS } = require('../out/swarm/effortDial');

const base = {
  backendHasLever: true,
  baselineEffort: 'medium',
  priorEffort: 'medium',
  cleanStreak: 0,
  cleanStreakRequired: ADAPT_DEFAULT_CLEAN_STREAK,
};

// ── the ladder itself ────────────────────────────────────────────────────

test("BL-1317: the ladder is BL-236's own operator dial scale, in order", () => {
  // Not a copy of the mutation_cost scale: a seat can already be running at
  // xhigh because the dial can set it there, and a ladder that stopped at
  // high would leave Adapt silently inert at the highest-stakes setting.
  assert.deepEqual(ADAPT_EFFORT_LADDER, EFFORT_LEVELS);
  assert.ok(ADAPT_EFFORT_LADDER.includes('xhigh'), 'Adapt must be able to climb onto every dial rung');
});

test('BL-1317: a bounce at high climbs onto xhigh rather than going inert there', () => {
  const d = decideAdaptEffort({ ...base, priorEffort: 'high', baselineEffort: 'high', signal: 'bounce' });
  assert.equal(d.apply, true);
  assert.equal(d.effort, 'xhigh');
});

// ── climb ────────────────────────────────────────────────────────────────

test('BL-1317: a bounce climbs exactly one notch', () => {
  const d = decideAdaptEffort({ ...base, signal: 'bounce' });
  assert.equal(d.apply, true);
  assert.equal(d.effort, 'high');
});

test('BL-1317: a bounce from low climbs to medium, not straight to high', () => {
  const d = decideAdaptEffort({ ...base, baselineEffort: 'low', priorEffort: 'low', signal: 'bounce' });
  assert.equal(d.effort, 'medium');
});

test('BL-1317: a bounce at the top of the ladder stays there rather than overflowing', () => {
  const d = decideAdaptEffort({ ...base, priorEffort: 'xhigh', signal: 'bounce' });
  assert.equal(d.effort, 'xhigh');
  assert.equal(d.apply, false, 'nothing to write when the effort would not change');
});

// ── drop ─────────────────────────────────────────────────────────────────

test('BL-1317: a clean completion short of the streak changes nothing', () => {
  const d = decideAdaptEffort({
    ...base,
    priorEffort: 'high',
    signal: 'clean',
    cleanStreak: ADAPT_DEFAULT_CLEAN_STREAK - 1,
  });
  assert.equal(d.apply, false);
  assert.equal(d.effort, 'high');
});

test('BL-1317: meeting the clean streak drops exactly one notch', () => {
  const d = decideAdaptEffort({
    ...base,
    priorEffort: 'high',
    signal: 'clean',
    cleanStreak: ADAPT_DEFAULT_CLEAN_STREAK,
  });
  assert.equal(d.apply, true);
  assert.equal(d.effort, 'medium');
});

test('BL-1317: a drop never goes below the BL-1316 claim-time baseline', () => {
  const d = decideAdaptEffort({
    ...base,
    baselineEffort: 'medium',
    priorEffort: 'medium',
    signal: 'clean',
    cleanStreak: ADAPT_DEFAULT_CLEAN_STREAK,
  });
  assert.equal(d.apply, false, 'already at the baseline - there is nowhere to drop to');
  assert.equal(d.effort, 'medium');
});

test('BL-1317: a clean streak brings an xhigh seat back down one notch at a time', () => {
  const d = decideAdaptEffort({
    ...base,
    priorEffort: 'xhigh',
    signal: 'clean',
    cleanStreak: ADAPT_DEFAULT_CLEAN_STREAK,
  });
  assert.equal(d.effort, 'high', 'never straight back to the baseline');
});

test('BL-1317: a high-cost ticket keeps its high baseline however clean the streak', () => {
  const d = decideAdaptEffort({
    ...base,
    baselineEffort: 'high',
    priorEffort: 'high',
    signal: 'clean',
    cleanStreak: ADAPT_DEFAULT_CLEAN_STREAK * 5,
  });
  assert.equal(d.apply, false);
  assert.equal(d.effort, 'high');
});

// ── no lever (BL-1316 invariant 2, carried forward) ──────────────────────

test('BL-1317: a backend with no effort lever never decides to apply anything', () => {
  for (const signal of ['bounce', 'clean']) {
    const d = decideAdaptEffort({ ...base, backendHasLever: false, signal, cleanStreak: 99 });
    assert.equal(d.apply, false, `${signal} must not apply on a lever-less backend`);
    assert.equal(d.effort, undefined, 'and must not name an effort a lever-less backend cannot take');
  }
});

// ── fail-closed on unusable input ────────────────────────────────────────

test('BL-1317: an unknown prior effort is not guessed at', () => {
  const d = decideAdaptEffort({ ...base, priorEffort: 'turbo', signal: 'bounce' });
  assert.equal(d.apply, false);
});

test('BL-1317: an unknown signal changes nothing', () => {
  const d = decideAdaptEffort({ ...base, signal: 'shrug' });
  assert.equal(d.apply, false);
});

test('BL-1317: a missing baseline is treated as the prior effort, never as low', () => {
  // Treating an absent baseline as "low" would let a clean streak drag a
  // high-cost seat all the way down - the exact floor invariant 2 protects.
  const d = decideAdaptEffort({
    ...base,
    baselineEffort: undefined,
    priorEffort: 'high',
    signal: 'clean',
    cleanStreak: ADAPT_DEFAULT_CLEAN_STREAK,
  });
  assert.equal(d.apply, false);
});

// ── the apply edge: adaptRoleEffort ──────────────────────────────────────
//
// The TypeScript side of Adapt. It exists so a UI or launch path never
// composes its own read/decide/write - it reuses BL-236's switchRoleEffort,
// which is what keeps declared invariant 1 (never the pack conf) true here
// too.

const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { installExecutable } = require('./helpers/sharedBin');
const { installInProcessTmux } = require('./helpers/fakeTmux');

function successfulRespawnRules() {
  return [
    { subcommand: 'show-window-options', exitCode: 0, stdout: '1\n' },
    { subcommand: 'list-windows', exitCode: 0, stdout: '2\n' },
    { subcommand: 'send-keys', exitCode: 0, stdout: '' },
  ];
}

function settingsPath(tmp, role) {
  return path.join(tmp, '.swarmforge', 'launch', `${role}.claude-settings.json`);
}

function mkSeat(role, settings) {
  const tmp = mkTmpDir('sfvc-adapt-apply-');
  const stateDir = path.join(tmp, '.swarmforge');
  const launchDir = path.join(stateDir, 'launch');
  fs.mkdirSync(launchDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'tmux-socket'), '/tmp/fake.sock');
  fs.writeFileSync(path.join(stateDir, 'sessions.tsv'), `1\t${role}\tswarmforge-${role}\tCoder\tclaude\n`);
  installExecutable(path.join(launchDir, `${role}.sh`), '#!/bin/bash\ntrue\n');
  fs.writeFileSync(settingsPath(tmp, role), JSON.stringify(settings));
  const confPath = path.join(tmp, 'swarmforge', 'swarmforge.conf');
  fs.mkdirSync(path.dirname(confPath), { recursive: true });
  fs.writeFileSync(confPath, 'window coder claude coder --effort medium\n');
  return { tmp, confPath };
}

test('BL-1317: adaptRoleEffort climbs the seat one notch on a bounce and respawns it', () => {
  const { tmp } = mkSeat('coder', { model: 'claude-sonnet-5', effortLevel: 'medium' });
  const fake = installInProcessTmux(successfulRespawnRules());
  try {
    const result = adaptRoleEffort(tmp, 'coder', {
      agent: 'claude',
      baselineEffort: 'medium',
      signal: 'bounce',
    });
    assert.equal(result.decision.apply, true);
    assert.equal(result.respawn.success, true, 'the climb must respawn the pane, not just rewrite a file');
    const written = JSON.parse(fs.readFileSync(settingsPath(tmp, 'coder'), 'utf8'));
    assert.deepEqual(written, { model: 'claude-sonnet-5', effortLevel: 'high' }, 'every other field preserved');
  } finally {
    fake.restore();
  }
});

test('BL-1317 invariant 1: adaptRoleEffort never writes the pack conf', () => {
  const { tmp, confPath } = mkSeat('coder', { effortLevel: 'medium' });
  const before = fs.readFileSync(confPath, 'utf8');
  const fake = installInProcessTmux(successfulRespawnRules());
  try {
    adaptRoleEffort(tmp, 'coder', { agent: 'claude', baselineEffort: 'medium', signal: 'bounce' });
    assert.equal(fs.readFileSync(confPath, 'utf8'), before, 'swarmforge.conf must be byte-for-byte unchanged');
  } finally {
    fake.restore();
  }
});

test('BL-1317: adaptRoleEffort applies nothing - and respawns nothing - when the decision does not change the effort', () => {
  const { tmp } = mkSeat('coder', { effortLevel: 'medium' });
  const before = fs.readFileSync(settingsPath(tmp, 'coder'), 'utf8');
  // A lone clean pass is short of the streak: the seat must not be bounced
  // through a respawn for a decision that changes nothing.
  const result = adaptRoleEffort(tmp, 'coder', {
    agent: 'claude',
    baselineEffort: 'medium',
    signal: 'clean',
    cleanStreak: 1,
  });
  assert.equal(result.decision.apply, false);
  assert.equal(result.respawn, undefined, 'no respawn for a no-op decision');
  assert.equal(fs.readFileSync(settingsPath(tmp, 'coder'), 'utf8'), before);
});

test('BL-1317: adaptRoleEffort sends no effort at all to a backend with no dial', () => {
  const { tmp } = mkSeat('coder', { effortLevel: 'medium' });
  const before = fs.readFileSync(settingsPath(tmp, 'coder'), 'utf8');
  const result = adaptRoleEffort(tmp, 'coder', {
    agent: 'cursor',
    baselineEffort: 'medium',
    signal: 'bounce',
  });
  assert.equal(result.decision.apply, false);
  assert.equal(result.decision.effort, undefined);
  assert.equal(result.respawn, undefined);
  assert.equal(fs.readFileSync(settingsPath(tmp, 'coder'), 'utf8'), before);
});
