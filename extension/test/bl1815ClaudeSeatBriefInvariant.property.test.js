'use strict';

// BL-1815/BL-654 declared invariant: "A trial boundary that moves a seat
// from the claude agent to the local-model agent never completes without a
// persisted schema-1 payload whose continuitySummary is the outgoing
// seat's non-empty brief of at most 2000 characters; every failure to get
// one leaves the seat where it was."
//
// Drives the REAL model_steward_cli.bb trial transfer-memory-debug seam and
// the REAL compiled trial-boundary-memory.js (never a reimplementation of
// either), over a randomly-shaped brief for the one owed pair
// (claude -> local-model). No tmux socket file exists in the fixture, so
// resolve-pane-target resolves to nil and no real tmux call is ever made -
// the whole wait is spent polling disk, bounded to 1s via
// MODEL_STEWARD_BRIEF_WAIT_S.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');
const { mkTmpDir } = require('./helpers/tmpDir');
const { assertReachFloor, runsPerCell } = require('./helpers/reachFloors');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'model_steward_cli.bb');
const MEMORY_TOOL = path.join(REPO_ROOT, 'extension', 'out', 'tools', 'trial-boundary-memory.js');

function briefPath(root, role) {
  return path.join(root, '.swarmforge', 'agent-memory', role, 'brief.md');
}

function payloadPath(root, role) {
  return path.join(root, '.swarmforge', 'agent-memory', role, 'payload.json');
}

function seedOutgoingSeat(factoryDir, role) {
  fs.mkdirSync(factoryDir, { recursive: true });
  const assignment = {
    [role]: {
      role,
      provider: 'anthropic',
      model: 'debug-from-model',
      agent: { provider: 'anthropic', agent: 'claude', 'known?': true },
    },
  };
  fs.writeFileSync(path.join(factoryDir, 'assignment.json'), JSON.stringify(assignment));
}

function seatAgent(factoryDir, role) {
  const raw = fs.readFileSync(path.join(factoryDir, 'assignment.json'), 'utf8');
  return JSON.parse(raw)[role]?.agent?.agent;
}

function runBoundary(root, factoryDir, role, waitS) {
  const r = spawnSync('bb', [
    CLI, 'trial', 'transfer-memory-debug',
    '--role', role,
    '--boundary', 'trial-start',
    '--from-provider', 'anthropic',
    '--to-provider', 'local',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MODEL_STEWARD_MEMORY_TOOL: MEMORY_TOOL,
      MODEL_STEWARD_TARGET_ROOT: root,
      MODEL_FACTORY_STATE_DIR: factoryDir,
      MODEL_STEWARD_BRIEF_WAIT_S: String(waitS || 1),
      MODEL_STEWARD_BRIEF_POLL_MS: '50',
    },
  });
  return { exit: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

// D1 (BL-1815 QA bounce, 2026-09-30): request-brief! now clears any
// pre-existing brief.md before it starts waiting, so a 'valid' brief must
// be written AFTER the boundary call begins - never before it, which is
// exactly the "leftover from an earlier boundary" shape D1 fixed. A
// detached, unref'd node process writes it a short delay in, decoupled
// from this test's own synchronous spawnSync call to the boundary.
function seedDelayedBrief(root, role, content, delayMs) {
  const target = briefPath(root, role);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const script = `setTimeout(() => { require('fs').writeFileSync(${JSON.stringify(target)}, ${JSON.stringify(content)}); }, ${delayMs});`;
  const child = spawn('node', ['-e', script], { detached: true, stdio: 'ignore' });
  child.unref();
}

// GENERATOR REACH (by construction): the four shapes the invariant covers -
// a valid brief (varying length/content each run), never written, blank,
// and over the 2000-character budget - each get their OWN fc.assert below,
// never left to a single shared arbitrary's sampling.
const SHAPES = ['valid', 'missing', 'blank', 'over-budget'];
const TOTAL_RUNS = 4;
const PER_CELL = runsPerCell(TOTAL_RUNS, SHAPES.length);

function exerciseShape(shape, content) {
  const root = mkTmpDir('bl1815-invariant-');
  const factoryDir = path.join(root, 'factory');
  const role = 'coder';
  seedOutgoingSeat(factoryDir, role);

  // 'valid' is written a short delay AFTER the boundary call begins - see
  // seedDelayedBrief's own comment (D1). 'blank'/'over-budget' pre-write
  // is fine: request-brief! clears it and, since nothing rewrites it
  // within the wait, the call still refuses (D1's own regression proof
  // lives in test_model_steward_brief_lib.sh case 05 instead of here).
  // 'missing': nothing written.
  // request-brief! clears any pre-existing brief.md the instant it starts
  // (D1) - and bb's own namespace-load startup for model_steward_cli.bb
  // takes a real, measurable few hundred ms before it gets there. The
  // delayed write must land safely AFTER that clear, or this fixture would
  // just be re-creating the exact stale-file race D1 fixed.
  const waitS = shape === 'valid' ? 6 : 1;
  if (shape === 'valid') {
    seedDelayedBrief(root, role, content, 800);
  } else if (shape === 'blank') {
    fs.mkdirSync(path.dirname(briefPath(root, role)), { recursive: true });
    fs.writeFileSync(briefPath(root, role), '   \n\t  ');
  } else if (shape === 'over-budget') {
    fs.mkdirSync(path.dirname(briefPath(root, role)), { recursive: true });
    fs.writeFileSync(briefPath(root, role), 'x'.repeat(2001));
  }

  const { exit, out } = runBoundary(root, factoryDir, role, waitS);
  const payloadFile = payloadPath(root, role);

  if (shape === 'valid') {
    assert.equal(exit, 0, `expected a valid brief to succeed, got exit=${exit}: ${out}`);
    assert.ok(fs.existsSync(payloadFile), `expected a persisted payload, got none: ${out}`);
    const payload = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
    assert.equal(payload.schemaVersion, 1, 'expected schema version 1');
    assert.equal(payload.continuitySummary, content.trim(), 'expected continuitySummary to equal the trimmed brief');
    assert.ok(payload.continuitySummary.length > 0 && payload.continuitySummary.length <= 2000);
    assert.equal(seatAgent(factoryDir, role), 'local-model', 'expected the seat to have moved to local-model');
  } else {
    assert.notEqual(exit, 0, `expected shape=${shape} to refuse the move, got exit=0: ${out}`);
    assert.ok(!fs.existsSync(payloadFile), `expected shape=${shape} to persist no payload, got one: ${out}`);
    assert.equal(seatAgent(factoryDir, role), 'claude', `expected shape=${shape} to leave the seat where it was`);
  }
}

test(
  'BL-1815/BL-654 invariant: a claude->local-model boundary completes only with a persisted valid brief, and never moves the seat otherwise',
  () => {
    const coverage = {};
    fc.assert(
      fc.property(fc.constant('missing'), () => {
        coverage.missing = (coverage.missing || 0) + 1;
        exerciseShape('missing');
      }),
      { numRuns: PER_CELL }
    );
    fc.assert(
      fc.property(fc.constant('blank'), () => {
        coverage.blank = (coverage.blank || 0) + 1;
        exerciseShape('blank');
      }),
      { numRuns: PER_CELL }
    );
    fc.assert(
      fc.property(fc.constant('over-budget'), () => {
        coverage['over-budget'] = (coverage['over-budget'] || 0) + 1;
        exerciseShape('over-budget');
      }),
      { numRuns: PER_CELL }
    );
    const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2000 }).chain((n) =>
          fc.array(fc.constantFrom(...ALPHABET), { minLength: n, maxLength: n }).map((chars) => chars.join(''))
        ),
        (content) => {
          coverage.valid = (coverage.valid || 0) + 1;
          exerciseShape('valid', content);
        }
      ),
      { numRuns: PER_CELL }
    );
    assertReachFloor(coverage, SHAPES, PER_CELL, 'shape');
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);
