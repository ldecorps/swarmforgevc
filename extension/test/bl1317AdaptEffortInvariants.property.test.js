'use strict';

// BL-1317's two DECLARED invariants (property authorship rests with the
// coder, first pass - BL-654). Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs).
//
//   invariant 1  Adapt never silently changes the pack window line on disk;
//                in-memory / respawn only (the BL-235/BL-236/BL-1316
//                posture).
//   invariant 2  A climb is one notch per signal; a drop requires the
//                clean-period rule named in the feature - asymmetric,
//                matching BL-545's descent-ladder hysteresis.
//
// Invariant 1 is about IO, so it drives the REAL Babashka consumer
// (handoff_lib.bb::record-effort-adapt!) against a real filesystem fixture
// and reads the real pack conf back off disk - never a mocked writer. One bb
// process replays a whole generated signal sequence, so a long sequence
// costs one subprocess rather than one per signal.
//
// Invariant 2 is a property of the pure decision, which after the 2026-09-02
// spec amendment lives in Babashka too (seat_difficulty_lib.bb
// ::adapt-effort-decision) - there is no TypeScript caller at the adapt
// moment, so there is no TypeScript decision to test. One bb process folds a
// whole generated sequence and reports, per step, BOTH the inputs it used and
// the decision it made; the JS side then replays its own loop against those
// recorded decisions and asserts the inputs agree, so a divergence between
// the two loops fails loudly instead of hiding behind a replayed answer.
//
// GENERATOR REACH (the asserted floor, never a hoped-for one). An invariant
// about a FLOOR and a CEILING is only tested if the generator actually
// arrives at both: a sequence of mostly-clean signals that never accumulates
// a streak would satisfy every assertion below while exercising nothing. So
// both properties count the deep states their sequences reach - the top rung,
// the baseline floor, and at least one applied drop - and the run FAILS if
// any of those counts is zero, rather than passing quietly on shallow input.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkTmpDir } = require('./helpers/tmpDir');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HANDOFF_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'handoff_lib.bb');
const SEAT_DIFFICULTY_LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'seat_difficulty_lib.bb');

// Read the ladder and the streak length OUT of the Babashka lib rather than
// restating them here: a second copy in JS is exactly the mirrored-constant
// shape that drifts silently (BL-897), and there is no longer a TS module for
// it to be mirrored in.
function readAdaptConstants() {
  const program = `
(load-file "${SEAT_DIFFICULTY_LIB}")
(require '[cheshire.core :as json])
(println (json/generate-string
  {:ladder seat-difficulty-lib/adapt-effort-ladder
   :streak seat-difficulty-lib/adapt-default-clean-streak}))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb constants read failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim());
}

const { ladder: ADAPT_EFFORT_LADDER, streak: ADAPT_DEFAULT_CLEAN_STREAK } = readAdaptConstants();

const ROLE = 'coder';
const rank = (e) => ADAPT_EFFORT_LADDER.indexOf(e);

// Weighted so a bounce is common enough to reach the ceiling and a clean run
// is long enough to reach the floor. An unweighted 50/50 draw reaches a
// 3-long clean streak rarely enough that the floor assertions would almost
// never fire - the "technically reachable but astronomically rare" shape.
const signalArb = fc.oneof(
  { weight: 2, arbitrary: fc.constant('bounce') },
  { weight: 5, arbitrary: fc.constant('clean') },
);
const sequenceArb = fc.array(signalArb, { minLength: 6, maxLength: 24 });
const effortArb = fc.constantFrom(...ADAPT_EFFORT_LADDER);

// ── invariant 2: the pure decision's asymmetry ───────────────────────────

// The whole of invariant 2, as one function over a `decide` seam, so the
// non-vacuity test below can drive the SAME assertions against a
// deliberately broken decision instead of restating a weaker version of them.
function checkAsymmetry(decide, signals, baselineEffort, reach) {
  let effort = baselineEffort;
  let streak = 0;

  for (const signal of signals) {
    streak = signal === 'clean' ? streak + 1 : 0;
    const before = effort;
    const d = decide({
      backendHasLever: true,
      priorEffort: before,
      baselineEffort,
      signal,
      cleanStreak: streak,
      cleanStreakRequired: ADAPT_DEFAULT_CLEAN_STREAK,
    });

    if (d.apply) {
      effort = d.effort;
      if (signal === 'clean') streak = 0;
    }

    const moved = rank(effort) - rank(before);

    // Never off the ladder, in either direction.
    assert.ok(rank(effort) >= 0, `${effort} is not a rung`);
    // At most one notch, whichever way it went.
    assert.ok(Math.abs(moved) <= 1, `moved ${moved} notches on a single ${signal}`);
    // A drop is never below the BL-1316 claim-time baseline.
    assert.ok(rank(effort) >= rank(baselineEffort), `${effort} fell below the ${baselineEffort} baseline`);

    if (signal === 'bounce') {
      assert.ok(moved >= 0, 'a bounce never lowers effort');
      if (moved === 1) reach.climbs += 1;
    } else {
      assert.ok(moved <= 0, 'a clean completion never raises effort');
      if (moved === -1) {
        reach.drops += 1;
        // The asymmetry itself: a drop only ever happens on a signal that
        // completed a full streak, never on a lone clean pass.
        assert.equal(streak, 0, 'a drop must have spent a completed streak');
      }
    }

    if (rank(effort) === ADAPT_EFFORT_LADDER.length - 1) reach.top += 1;
    if (effort === baselineEffort) reach.floor += 1;
  }
  return true;
}
// Folds the sequence through the REAL pure decision in one bb process,
// recording the inputs each step used alongside the decision it produced.
function bbDecideSequence(signals, baselineEffort) {
  const program = `
(load-file "${SEAT_DIFFICULTY_LIB}")
(require '[cheshire.core :as json])
(let [ladder seat-difficulty-lib/adapt-effort-ladder
      required seat-difficulty-lib/adapt-default-clean-streak
      baseline "${baselineEffort}"]
  (println
    (json/generate-string
      (:steps
        (reduce
          (fn [{:keys [effort streak steps]} signal]
            (let [streak (if (= signal "clean") (inc streak) 0)
                  d (seat-difficulty-lib/adapt-effort-decision
                      {:backend "claude" :prior-effort effort :baseline-effort baseline
                       :signal signal :clean-streak streak
                       :clean-streak-required required})
                  applied (boolean (:apply? d))
                  next-effort (if applied (:effort d) effort)]
              {:effort next-effort
               :streak (if (and applied (= signal "clean")) 0 streak)
               :steps (conj steps {:priorEffort effort :baselineEffort baseline
                                   :signal signal :cleanStreak streak
                                   :cleanStreakRequired required
                                   :apply applied :effort (:effort d)})}))
          {:effort baseline :streak 0 :steps []}
          ${JSON.stringify(signals)})))))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb decision fold failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim());
}

test('BL-1317/BL-654 invariant 2: a climb is one notch per signal, a drop needs the whole streak, and neither leaves the ladder', () => {
  const reach = { top: 0, floor: 0, drops: 0, climbs: 0 };

  fc.assert(
    fc.property(sequenceArb, effortArb, (signals, baselineEffort) => {
      const steps = bbDecideSequence(signals, baselineEffort);
      assert.equal(steps.length, signals.length, 'bb fold skipped a signal');
      let i = 0;
      // The seam: each answer comes from the real Babashka decision, and the
      // inputs the JS loop built must match the ones bb actually decided on.
      const decide = (input) => {
        const step = steps[i++];
        for (const key of ['priorEffort', 'baselineEffort', 'signal', 'cleanStreak', 'cleanStreakRequired']) {
          assert.equal(input[key], step[key], `JS and bb folds diverged on ${key} at step ${i - 1}`);
        }
        return { apply: step.apply, effort: step.effort };
      };
      return checkAsymmetry(decide, signals, baselineEffort, reach);
    }),
    { numRuns: 40 },
  );

  // The asserted reachability floor.
  assert.ok(reach.top > 0, 'generator never reached the top rung - the ceiling assertions never fired');
  assert.ok(reach.floor > 0, 'generator never sat at the baseline - the floor assertions never fired');
  assert.ok(reach.climbs > 0, 'generator never produced an applied climb');
  assert.ok(reach.drops > 0, 'generator never produced an applied drop - the whole streak rule went untested');
});

test('BL-1317 non-vacuity: invariant 2 rejects a decision that jumps straight to the top rung', () => {
  // The same assertions, the same generator, one broken decision: a bounce
  // that climbs all the way instead of one notch. If invariant 2 above can
  // pass against this, it proves nothing about the real module.
  const jumpsToTop = ({ priorEffort, signal }) =>
    signal === 'bounce'
      ? { apply: true, effort: ADAPT_EFFORT_LADDER[ADAPT_EFFORT_LADDER.length - 1] }
      : { apply: false, effort: priorEffort };

  assert.throws(() => {
    fc.assert(
      fc.property(sequenceArb, fc.constant('low'), (signals, baselineEffort) =>
        checkAsymmetry(jumpsToTop, signals, baselineEffort, { top: 0, floor: 0, drops: 0, climbs: 0 })),
      { numRuns: 300 },
    );
  });
});

test('BL-1317 non-vacuity: invariant 2 rejects a drop that ignores the clean streak', () => {
  // The other half of the asymmetry: a decision that gives a notch back on
  // every single clean pass, with no streak and no baseline floor.
  const dropsOnEveryClean = ({ priorEffort, signal }) =>
    signal === 'clean'
      ? { apply: true, effort: ADAPT_EFFORT_LADDER[Math.max(rank(priorEffort) - 1, 0)] }
      : { apply: false, effort: priorEffort };

  assert.throws(() => {
    fc.assert(
      fc.property(sequenceArb, fc.constant('high'), (signals, baselineEffort) =>
        checkAsymmetry(dropsOnEveryClean, signals, baselineEffort, { top: 0, floor: 0, drops: 0, climbs: 0 })),
      { numRuns: 300 },
    );
  });
});

// ── invariant 1: the real consumer never writes the pack conf ────────────

function bl1317Fixture(startingEffort) {
  const root = mkTmpDir('bl1317-invariant1-');
  const launchDir = path.join(root, '.swarmforge', 'launch');
  fs.mkdirSync(launchDir, { recursive: true });
  fs.writeFileSync(
    path.join(launchDir, `${ROLE}.claude-settings.json`),
    JSON.stringify({ model: 'claude-sonnet-5', effortLevel: startingEffort }),
  );
  const confDir = path.join(root, 'swarmforge');
  fs.mkdirSync(confDir, { recursive: true });
  const confPath = path.join(confDir, 'swarmforge.conf');
  fs.writeFileSync(
    confPath,
    ['active_backlog_max_depth 2', `window ${ROLE} claude ${ROLE} --effort medium --seat-tier hard`, ''].join('\n'),
  );
  return { root, confPath, settingsPath: path.join(launchDir, `${ROLE}.claude-settings.json`) };
}

// Replays a whole signal sequence through the REAL record-effort-adapt!, in
// one bb process, and reports the effort the seat would respawn at.
function replaySignals(root, signals, mutationCost) {
  const program = `
(require '[babashka.fs :as fs] '[cheshire.core :as json])
(load-file "${HANDOFF_LIB}")
(handoff-lib/set-project-root! "${root}")
(doseq [s ${JSON.stringify(signals)}]
  (handoff-lib/record-effort-adapt!
    {:role "${ROLE}" :backend "claude" :mutation-cost "${mutationCost}"
     :pack-default-effort "medium" :signal s}))
(println (:effortLevel (json/parse-string
  (slurp (str (fs/path "${root}" ".swarmforge" "launch" "${ROLE}.claude-settings.json"))) true)))`;
  const r = spawnSync('bb', ['-e', program], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bb replay failed: ${r.stderr}`);
  return r.stdout.trim();
}

test('BL-1317/BL-654 invariant 1: no outcome sequence ever rewrites the pack conf on disk', () => {
  const reach = { climbed: 0, dropped: 0 };

  fc.assert(
    fc.property(sequenceArb, fc.constantFrom('low', 'medium', 'high'), (signals, mutationCost) => {
      const { root, confPath } = bl1317Fixture('medium');
      const before = fs.readFileSync(confPath);
      const beforeStat = fs.statSync(confPath);

      const finalEffort = replaySignals(root, signals, mutationCost);

      const after = fs.readFileSync(confPath);
      assert.ok(before.equals(after), 'Adapt rewrote the pack conf');
      assert.equal(beforeStat.size, fs.statSync(confPath).size);

      // And the mechanism it DOES use is the respawn-read settings file, so
      // "never the conf" is not passing merely because nothing happened.
      if (rank(finalEffort) > rank(mutationCost)) reach.climbed += 1;
      if (rank(finalEffort) < rank('medium')) reach.dropped += 1;
      return true;
    }),
    { numRuns: 12 },
  );

  assert.ok(
    reach.climbed + reach.dropped > 0,
    'no replay ever moved the seat at all - "the conf is unchanged" would then hold for the wrong reason',
  );
});
