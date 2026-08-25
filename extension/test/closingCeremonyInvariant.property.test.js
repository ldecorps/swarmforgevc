const assert = require('node:assert/strict');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { runClosingCeremony } = require('../out/metrics/closingCeremonyRun');
const { readCeremonyRun, recordCeremonyOutcome } = require('../out/metrics/closingCeremonyStore');
const { appendLeanLedgerEventIfNew } = require('../out/metrics/leanLedgerStore');
const { ceremonyRunState } = require('../out/quality/closingCeremony');

// BL-820 (coder.prompt's Invariants section - first authorship rests with
// the coder): a coder-authored property test for this ticket's one declared
// invariant - "Every ceremony run terminates in a recorded outcome... and
// never in silence; a run that produced nothing is indistinguishable from a
// ceremony that did not happen, which is the failure this slice exists to
// prevent." Runs ONLY via `npm run test:properties`
// (vitest.properties.config.mjs); excluded from unit/coverage/mutation.
//
// Non-vacuity, checked by hand before landing: commenting out
// closingCeremonyRun.ts's `for (const stale of findOpenCeremonyRunsBefore(...))`
// finalize loop (simulating the exact regression this invariant guards - a
// shift's ceremony that got no outcome staying silently pending forever)
// reproduced the failure this property is built to catch - a run left
// PENDING after later shifts ran, where the property expects it resolved
// to complete or failed - and restoring the loop made it pass again.

function mkTmp() {
  return mkTmpDir('sfvc-closing-ceremony-invariant-');
}

// Each generated shift is a distinct calendar day, 2026-01-01 + dayIndex, so
// every run in a sequence gets its own file and its own natural ordering -
// the generator's own reach: both branches (an outcome recorded in time,
// and a shift left to go silent) are exercised across the array, and the
// LENGTH of the array varies the ceremony's own gap-day handling (a run
// left pending for several shifts before it is ever finalized).
function isoForDay(dayIndex) {
  return new Date(Date.UTC(2026, 0, 1 + dayIndex, 20, 0, 0)).toISOString();
}

test('property: every ceremony run ends complete or failed - never left silently pending - once a later shift has run', () => {
  fc.assert(
    fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 12 }), (recordOutcomeDecisions) => {
      const target = mkTmp();
      const sent = [];
      const deps = { sendNote: (t, draft) => sent.push(draft) };
      const shiftKeys = [];

      recordOutcomeDecisions.forEach((shouldRecord, i) => {
        const at = isoForDay(i);
        const shiftKey = at.slice(0, 10);
        shiftKeys.push(shiftKey);
        // Non-empty ledger every day, so the run never auto-resolves to
        // no_change - the only way each run reaches "complete" here is
        // through an explicit recorded outcome, exercising the real path
        // this invariant is about.
        appendLeanLedgerEventIfNew(target, {
          ticket: `BL-${900 + i}`,
          type: 'stage_transition',
          source: 'stage-dwell',
          at,
          role: 'coder',
          data: { processingMs: 1000 },
        });
        runClosingCeremony(target, at, deps);
        if (shouldRecord) {
          recordCeremonyOutcome(target, shiftKey, { type: 'no_change', ref: null, recordedAt: at });
        }
      });

      // A ceremony run some time after the whole sequence - the moment any
      // still-pending run from the sequence must be finalized as failed.
      const finalAt = isoForDay(recordOutcomeDecisions.length + 5);
      runClosingCeremony(target, finalAt, deps);

      for (const shiftKey of shiftKeys) {
        const run = readCeremonyRun(target, shiftKey);
        assert.ok(run, `expected a stored run for shift ${shiftKey}`);
        const state = ceremonyRunState(run);
        assert.notEqual(state, 'pending', `shift ${shiftKey} was left silently pending after a later ceremony ran`);
      }
    }),
    { numRuns: 100 }
  );
});

test('property: a run left silent is always surfaced via a failure note naming that shift', () => {
  fc.assert(
    fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }), (recordOutcomeDecisions) => {
      const target = mkTmp();
      const sent = [];
      const deps = { sendNote: (t, draft) => sent.push(draft) };

      recordOutcomeDecisions.forEach((shouldRecord, i) => {
        const at = isoForDay(i);
        const shiftKey = at.slice(0, 10);
        appendLeanLedgerEventIfNew(target, {
          ticket: `BL-${900 + i}`,
          type: 'stage_transition',
          source: 'stage-dwell',
          at,
          role: 'coder',
          data: { processingMs: 1000 },
        });
        runClosingCeremony(target, at, deps);
        if (shouldRecord) {
          recordCeremonyOutcome(target, shiftKey, { type: 'no_change', ref: null, recordedAt: at });
        }
      });

      const finalAt = isoForDay(recordOutcomeDecisions.length + 5);
      runClosingCeremony(target, finalAt, deps);

      recordOutcomeDecisions.forEach((shouldRecord, i) => {
        if (shouldRecord) {
          return;
        }
        const shiftKey = isoForDay(i).slice(0, 10);
        const wasSurfaced = sent.some((draft) => draft.includes('FAILED') && draft.includes(shiftKey));
        assert.ok(wasSurfaced, `expected shift ${shiftKey}'s silence to be surfaced via a failure note`);
      });
    }),
    { numRuns: 100 }
  );
});
