'use strict';

// BL-1327: step handlers for the scheduled descent ladder.
//
// Slice 1 is PROPOSAL-ONLY (human ruling 2026-09-02), so the scenarios drive
// the REAL review CLI against a fixture root and then check two things every
// time: what was proposed, and that nothing about a live seat changed. The
// second half is the governance boundary, and it is asserted by comparing the
// fixture's seat-facing files byte-for-byte across the review rather than by
// trusting that the CLI has no apply path.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const REVIEW_CLI = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'descent_review_cli.bb');
const FIXTURE_PREFIX = 'bl1327-acceptance-';
const SEAT = 'coder';
const MODEL_LADDER = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];
const STALE_AFTER_MS = 10 * 60 * 1000;

// Age-guarded: scenarios run concurrently, so an unguarded prefix sweep would
// delete a sibling's live root (BL-971 wants the sweep, not the collateral).
function sweepStaleFixtures() {
  const now = Date.now();
  for (const entry of fs.readdirSync(os.tmpdir())) {
    if (!entry.startsWith(FIXTURE_PREFIX)) continue;
    const full = path.join(os.tmpdir(), entry);
    try {
      if (now - fs.statSync(full).mtimeMs > STALE_AFTER_MS) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    } catch {
      // Another scenario tidying its own root is not this sweep's business.
    }
  }
}
sweepStaleFixtures();

function state(ctx) {
  if (!ctx.bl1327) ctx.bl1327 = {};
  return ctx.bl1327;
}

function buildRoot(ctx) {
  const st = state(ctx);
  if (st.root) return st.root;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), FIXTURE_PREFIX));
  fs.mkdirSync(path.join(root, '.swarmforge', 'descent-ladder'), { recursive: true });
  fs.mkdirSync(path.join(root, '.swarmforge', 'launch'), { recursive: true });
  fs.mkdirSync(path.join(root, 'swarmforge'), { recursive: true });
  // The two places a seat's live model/effort actually live. Nothing in a
  // proposal-only slice may touch either, and the scenarios check that.
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'launch', `${SEAT}.claude-settings.json`),
    JSON.stringify({ model: 'claude-opus-5', effortLevel: 'xhigh' }),
  );
  fs.writeFileSync(
    path.join(root, 'swarmforge', 'swarmforge.conf'),
    `window ${SEAT} claude ${SEAT} --model claude-opus-5 --effort xhigh\n`,
  );
  st.root = root;
  return root;
}

function seatFacingFiles(root) {
  return [
    path.join(root, '.swarmforge', 'launch', `${SEAT}.claude-settings.json`),
    path.join(root, 'swarmforge', 'swarmforge.conf'),
  ].map((f) => [f, fs.readFileSync(f)]);
}

function writeLadder(ctx, seatState, config) {
  const root = buildRoot(ctx);
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'descent-ladder', 'state.json'),
    JSON.stringify({ [SEAT]: seatState }),
  );
  fs.writeFileSync(
    path.join(root, '.swarmforge', 'descent-ladder', 'config.json'),
    JSON.stringify({ model_ladder: MODEL_LADDER, required_clean_periods: 3, ...config }),
  );
}

function runReview(ctx) {
  const st = state(ctx);
  st.before = seatFacingFiles(st.root);
  const r = spawnSync('bb', [REVIEW_CLI, 'review', st.root], { encoding: 'utf8', cwd: REPO_ROOT });
  assert.equal(r.status, 0, `the review failed: ${r.stderr}`);
  st.output = `${r.stdout || ''}${r.stderr || ''}`;
  st.record = JSON.parse(
    fs.readFileSync(path.join(st.root, '.swarmforge', 'descent-ladder', 'proposals.json'), 'utf8'),
  );
  return st;
}

function onlyProposal(ctx) {
  const st = state(ctx);
  assert.equal(st.record.proposals.length, 1, `expected one proposal, got ${JSON.stringify(st.record.proposals)}`);
  return st.record.proposals[0];
}

const FEATURE = 'BL-1327 Scheduled descent ladder proposes a cheaper effort-then-model notch per seat';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a seat with a guard window computed from bounce and QA outcomes for the tickets it has held$/, (ctx) => {
    buildRoot(ctx);
  });

  scoped(/^the seat's current position on the effort-then-model descent ladder$/, (ctx) => {
    // Set by the scenario-specific Given that follows; the Background only
    // establishes that a position exists.
    writeLadder(ctx, { effort: 'xhigh', model: 'claude-opus-5', 'clean-periods': 0 });
  });

  scoped(/^the seat has stayed guard-clean for the configured number of review periods at its current notch$/, (ctx) => {
    writeLadder(ctx, { effort: 'xhigh', model: 'claude-opus-5', 'clean-periods': 3 });
  });

  scoped(/^the seat is already at the lowest effort notch for its current model$/, (ctx) => {
    writeLadder(ctx, { effort: 'low', model: 'claude-opus-5', 'clean-periods': 3 });
  });

  scoped(/^the seat had partial progress toward the clean-period threshold at a previously descended notch$/, (ctx) => {
    const st = state(ctx);
    st.tripState = {
      effort: 'medium',
      model: 'claude-sonnet-5',
      'clean-periods': 2,
      'last-known-good': { effort: 'high', model: 'claude-opus-5' },
    };
    writeLadder(ctx, st.tripState);
  });

  scoped(/^a seat's terminal notch was chosen using the price validity windows BL-1056 makes queryable$/, (ctx) => {
    writeLadder(ctx, { effort: 'low', model: 'claude-haiku-4-5', 'clean-periods': 5 });
    state(ctx).terminalBefore = true;
  });

  scoped(/^the price window for that model shifts$/, (ctx) => {
    // A shift that makes a cheaper model available is the case worth testing:
    // a shift that changes nothing must not manufacture a proposal, and the
    // bb runner covers that half.
    writeLadder(ctx, { effort: 'low', model: 'claude-haiku-4-5', 'clean-periods': 5 }, {
      model_ladder: [...MODEL_LADDER, 'cheaper-after-shift'],
      price_window_shifted_models: ['claude-haiku-4-5'],
    });
  });

  scoped(/^the scheduled descent review runs$/, (ctx) => {
    runReview(ctx);
  });

  scoped(/^the descent review re-evaluates the terminal state against the new window$/, (ctx) => {
    runReview(ctx);
  });

  scoped(/^a guard trip is recorded for that seat$/, (ctx) => {
    const st = state(ctx);
    // The pure bookkeeping the ladder lib owns, driven directly - a guard trip
    // is not a review, and Slice 1 has no other caller for it yet.
    const program = `
(require '[cheshire.core :as json])
(load-file "${path.join(REPO_ROOT, 'swarmforge', 'scripts', 'descent_ladder_lib.bb')}")
(println (json/generate-string (descent-ladder-lib/record-guard-trip
  {:effort "${st.tripState.effort}" :model "${st.tripState.model}"
   :clean-periods ${st.tripState['clean-periods']}
   :last-known-good {:effort "${st.tripState['last-known-good'].effort}"
                     :model "${st.tripState['last-known-good'].model}"}})))`;
    const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
    assert.equal(r.status, 0, `bb failed: ${r.stderr}`);
    st.afterTrip = JSON.parse(r.stdout.trim().split('\n').pop());
  });

  scoped(/^a descent proposal names the next lower effort notch to try$/, (ctx) => {
    const p = onlyProposal(ctx);
    assert.equal(p.effort, 'high', `expected one notch down from xhigh, got ${JSON.stringify(p)}`);
    assert.equal(p.model, 'claude-opus-5', 'the model moved while effort notches remained');
  });

  // Terminal step of its scenario (BL-971/tempDirTrapGuard, same reasoning as
  // BL-1320's cleaner pass): a failing assertion above must not skip cleanup.
  scoped(/^no seat's live model or effort changes as a result of the proposal$/, (ctx) => {
    const st = state(ctx);
    try {
      for (const [file, before] of st.before) {
        assert.ok(before.equals(fs.readFileSync(file)), `the review mutated a live seat file: ${file}`);
      }
      assert.equal(st.record.applied, false, 'the proposal record marks itself applied');
    } finally {
      fs.rmSync(st.root, { recursive: true, force: true });
    }
  });

  scoped(/^the proposal names the next cheaper model at high effort, not at low effort$/, (ctx) => {
    const p = onlyProposal(ctx);
    assert.equal(p.model, 'claude-sonnet-5', `expected the next cheaper model, got ${JSON.stringify(p)}`);
    assert.equal(p.effort, 'high', 'a cheaper model must start at high effort, never at low');
  });

  // Terminal step of its scenario - same try/finally reasoning as above.
  scoped(/^the proposal records the reason a smaller model starts at higher effort$/, (ctx) => {
    const st = state(ctx);
    try {
      const p = onlyProposal(ctx);
      assert.match(p.reason, /deliberation/i, `the proposal does not record why: ${p.reason}`);
      for (const [file, before] of st.before) {
        assert.ok(before.equals(fs.readFileSync(file)), `the review mutated a live seat file: ${file}`);
      }
    } finally {
      fs.rmSync(st.root, { recursive: true, force: true });
    }
  });

  scoped(/^the seat's ladder position climbs back to the last known-good notch immediately$/, (ctx) => {
    const after = state(ctx).afterTrip;
    assert.equal(after.effort, 'high');
    assert.equal(after.model, 'claude-opus-5');
  });

  // Terminal step of its scenario - same try/finally reasoning as above.
  scoped(/^the discarded clean-period progress does not carry forward$/, (ctx) => {
    const st = state(ctx);
    try {
      assert.equal(st.afterTrip['clean-periods'], 0, `progress carried forward: ${JSON.stringify(st.afterTrip)}`);
    } finally {
      fs.rmSync(st.root, { recursive: true, force: true });
    }
  });

  // Terminal step of its scenario - same try/finally reasoning as above.
  scoped(/^a changed terminal notch is surfaced as a new proposal, not silently adopted$/, (ctx) => {
    const st = state(ctx);
    try {
      const p = onlyProposal(ctx);
      assert.equal(p.model, 'cheaper-after-shift', `the re-walk proposed nothing new: ${JSON.stringify(p)}`);
      assert.match(p.reason, /price/i, 'the proposal does not name the price window as the reason it moved');
      // The lib's field is :applied?, so the JSON key carries the question mark.
      assert.equal(p['applied?'], false, 'the re-walked notch marks itself applied');
      for (const [file, before] of st.before) {
        assert.ok(before.equals(fs.readFileSync(file)), `the review mutated a live seat file: ${file}`);
      }
    } finally {
      fs.rmSync(st.root, { recursive: true, force: true });
    }
  });
}

module.exports = { registerSteps };
