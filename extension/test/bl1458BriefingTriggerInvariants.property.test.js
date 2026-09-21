'use strict';

// BL-1458's two declared invariants (coder first authorship, BL-654):
//
// Invariant 1: "No trigger, on any path (closing ceremony, fixed-morning
// fallback, VS Code host), ever asks a role other than the documenter to
// compose the briefing; the banked headless composer (BL-308) is the only
// non-documenter writer and only while hibernated." Encoded against the
// real, adapter-injected briefing_generation_schedule_lib.bb
// generate-briefing-if-due! over a generated spread of (hibernated?,
// already-generated-today?) - proving :notify! (the documenter's mailbox
// route, wired by handoffd.bb's instruct-documenter-briefing!) and
// :compose-headless! (BL-308, hibernated-only) are mutually exclusive and
// never both silent when due.
//
// Invariant 2: "The instruction is one literal: for the same date the
// ceremony's note and the fallback's note are byte-identical, asserted by
// a test that reads both builders (BL-897 mirror rule)." Encoded against
// the real compiled TypeScript builder (nightClosingCeremonyLive.ts's
// briefingInstruction) and the real Babashka builder
// (briefing_generation_schedule_lib.bb's briefing-due-instruction) over a
// generated spread of dates.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { SUBPROCESS_HEAVY_TIMEOUT_MS } = require('./helpers/subprocessHeavyTimeout');
const { mkTmpDir } = require('./helpers/tmpDir');
const { briefingInstruction } = require('../out/quality/nightClosingCeremonyLive');

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIB = path.join(REPO_ROOT, 'swarmforge', 'scripts', 'briefing_generation_schedule_lib.bb');

function bbInstruction(dayKey) {
  return execFileSync('bb', ['-e', `(load-file "${LIB}") (print (briefing-generation-schedule-lib/briefing-due-instruction "${dayKey}"))`], {
    encoding: 'utf8',
  });
}

// ── Invariant 1 ──────────────────────────────────────────────────────────

function runSweep(briefingsDir, { hibernated, alreadyGenerated }) {
  if (alreadyGenerated) {
    fs.mkdirSync(briefingsDir, { recursive: true });
    fs.writeFileSync(path.join(briefingsDir, '2026-09-08.md'), 'already there\n');
  }
  const nowMs = new Date('2026-09-08T09:00:00Z').getTime();
  const script = `
(require '[cheshire.core :as json])
(load-file "${LIB}")
(def notified (atom []))
(def composed (atom []))
(briefing-generation-schedule-lib/generate-briefing-if-due!
 ${nowMs} 8 0 "${briefingsDir}" ${hibernated}
 {:notify! (fn [text] (swap! notified conj text))
  :compose-headless! (fn [day-key] (swap! composed conj day-key))
  :emit-sidecar! (fn [] nil)
  :log! (fn [& _] nil)})
(println (json/generate-string {:notified @notified :composed @composed}))
`;
  const out = execFileSync('bb', ['-e', script], { encoding: 'utf8' });
  return JSON.parse(out.trim().split('\n').pop());
}

test(
  'property (BL-1458 invariant 1): the only ever-firing adapters are the documenter notify (not hibernated) or the headless composer (hibernated), never both, never neither when due',
  () => {
    let draws = 0;
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (hibernated, alreadyGenerated) => {
        draws += 1;
        const root = mkTmpDir('bl1458-invariant1-');
        const briefingsDir = path.join(root, 'docs', 'briefings');
        const { notified, composed } = runSweep(briefingsDir, { hibernated, alreadyGenerated });
        if (alreadyGenerated) {
          assert.deepEqual(notified, [], `expected no notify when already generated (hibernated=${hibernated})`);
          assert.deepEqual(composed, [], `expected no compose-headless when already generated (hibernated=${hibernated})`);
        } else if (hibernated) {
          assert.deepEqual(notified, [], 'expected no notify (no documenter to nudge) while hibernated');
          assert.deepEqual(composed, ['2026-09-08'], 'expected the headless composer called exactly once while hibernated');
        } else {
          assert.deepEqual(notified, ['produce the morning briefing for 2026-09-08'], 'expected exactly one documenter notify when due and not hibernated');
          assert.deepEqual(composed, [], 'expected the headless composer never called when not hibernated');
        }
      }),
      { numRuns: 8 }
    );
    assert.ok(draws >= 4);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test('property (BL-1458 invariant 1) non-vacuity: a broken hibernated-branch guard would wrongly compose headlessly even when not hibernated - proven against a scratch copy, then restored', () => {
  const original = fs.readFileSync(LIB, 'utf8');
  const marker = '(if hibernated?\n           ((:compose-headless! adapters) day-key)\n           ((:notify! adapters) (briefing-due-instruction day-key)))';
  assert.ok(original.includes(marker), 'expected to find the hibernated?-branch dispatch to invert for the non-vacuity probe');
  const broken = original.replace(
    marker,
    '(if hibernated?\n           ((:notify! adapters) (briefing-due-instruction day-key))\n           ((:compose-headless! adapters) day-key))'
  );
  assert.notEqual(broken, original, 'expected the textual swap to actually change the file');

  const brokenPath = path.join(path.dirname(LIB), `briefing_generation_schedule_lib-non-vacuity-scratch-${process.pid}-${Date.now()}.bb`);
  fs.writeFileSync(brokenPath, broken.replace(/ns briefing-generation-schedule-lib/, 'ns briefing-generation-schedule-lib'), { mode: 0o644 });
  const root = mkTmpDir('bl1458-non-vacuity-');
  const briefingsDir = path.join(root, 'docs', 'briefings');
  try {
    const nowMs = new Date('2026-09-08T09:00:00Z').getTime();
    const script = `
(require '[cheshire.core :as json])
(load-file "${brokenPath}")
(def notified (atom []))
(def composed (atom []))
(briefing-generation-schedule-lib/generate-briefing-if-due!
 ${nowMs} 8 0 "${briefingsDir}" false
 {:notify! (fn [text] (swap! notified conj text))
  :compose-headless! (fn [day-key] (swap! composed conj day-key))
  :emit-sidecar! (fn [] nil)
  :log! (fn [& _] nil)})
(println (json/generate-string {:notified @notified :composed @composed}))
`;
    const out = execFileSync('bb', ['-e', script], { encoding: 'utf8' });
    const { notified, composed } = JSON.parse(out.trim().split('\n').pop());
    assert.deepEqual(composed, ['2026-09-08'], 'expected the broken (inverted) guard to wrongly compose headlessly while NOT hibernated');
    assert.deepEqual(notified, [], 'expected the broken guard to wrongly skip the documenter notify while NOT hibernated');
  } finally {
    fs.rmSync(brokenPath, { force: true });
  }
});

// ── Invariant 2 ──────────────────────────────────────────────────────────

const dayKeyArbitrary = fc
  .tuple(fc.integer({ min: 2026, max: 2030 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
  .map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);

test(
  'property (BL-1458 invariant 2): the TypeScript and Babashka instruction builders are byte-identical for any date (BL-897 mirror rule)',
  () => {
    let draws = 0;
    fc.assert(
      fc.property(dayKeyArbitrary, (dayKey) => {
        draws += 1;
        assert.equal(bbInstruction(dayKey), briefingInstruction(dayKey), `expected byte-identical instructions for ${dayKey}`);
      }),
      { numRuns: 8 }
    );
    assert.ok(draws >= 4);
  },
  SUBPROCESS_HEAVY_TIMEOUT_MS
);

test('property (BL-1458 invariant 2) non-vacuity: a Babashka builder that drifts from the TypeScript wording would be caught - proven against a scratch copy, then restored', () => {
  const original = fs.readFileSync(LIB, 'utf8');
  const marker = '(str "produce the morning briefing for " day-key)';
  assert.ok(original.includes(marker), 'expected to find the instruction literal to mutate for the non-vacuity probe');
  const broken = original.replace(marker, '(str "produce the MORNING briefing for " day-key)');
  assert.notEqual(broken, original, 'expected the textual mutation to actually change the file');

  const brokenPath = path.join(path.dirname(LIB), `briefing_generation_schedule_lib-non-vacuity-scratch2-${process.pid}-${Date.now()}.bb`);
  fs.writeFileSync(brokenPath, broken, { mode: 0o644 });
  try {
    const out = execFileSync('bb', ['-e', `(load-file "${brokenPath}") (print (briefing-generation-schedule-lib/briefing-due-instruction "2026-09-08"))`], {
      encoding: 'utf8',
    });
    assert.notEqual(out, briefingInstruction('2026-09-08'), 'expected the drifted Babashka wording to no longer match the TypeScript builder');
  } finally {
    fs.rmSync(brokenPath, { force: true });
  }
});
