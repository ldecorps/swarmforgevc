'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const { diffEnvSnapshots, formatEnvLeakMessage } = require('./helpers/envRestoreGuard');

// BL-720 invariant 1 (BL-654 coder-authored): "A test that mutates a
// process.env key restores it to exactly what it found — the same value, or
// absent if it was absent — before the next file in that worker runs."
//
// Models exactly the capture/restore idiom applied at all 11
// CURSOR_API_KEY sites in cursorBridgeAgentSession.test.js (8 fixed by this
// ticket, 3 already correct): capture prevValue before mutating, then in
// finally either delete (if prevValue was absent) or restore prevValue. The
// first property proves that idiom always leaves diffEnvSnapshots empty for
// ANY prior state (present with an arbitrary value, or absent) and ANY
// temporary value the test sets it to - not just the fixed literal
// 'test-key' the real file happens to use. The second proves the exact bug
// this ticket fixes - SKIPPING the restore step - is always caught as
// exactly one leak naming the right key with the right before/after values.
// Runs ONLY via `npm run test:properties` (vitest.properties.config.mjs).
//
// Non-vacuous: both properties were manually confirmed to FAIL when
// diffEnvSnapshots was temporarily broken to always return [] (2026-08-01,
// coder), then restored.

const KEY = 'BL720_PROPERTY_ENV_KEY';
const priorValueArb = fc.option(fc.string(), { nil: undefined });
const tempValueArb = fc.string();

function applyCaptureRestoreIdiom(before, tempValue) {
  const prevValue = before[KEY];
  const restored = { ...before, [KEY]: tempValue };
  if (prevValue === undefined) delete restored[KEY];
  else restored[KEY] = prevValue;
  return restored;
}

test('the capture/restore idiom leaves no leak for any prior value (present or absent) and any temporary value', () => {
  fc.assert(
    fc.property(priorValueArb, tempValueArb, (priorValue, tempValue) => {
      const before = priorValue === undefined ? {} : { [KEY]: priorValue };
      const restored = applyCaptureRestoreIdiom(before, tempValue);
      assert.deepEqual(diffEnvSnapshots(before, restored), []);
    }),
    { numRuns: 100 },
  );
});

test('skipping the restore step is always caught as exactly one leak naming the key and the right before/after values', () => {
  fc.assert(
    fc.property(priorValueArb, tempValueArb, (priorValue, tempValue) => {
      fc.pre(priorValue !== tempValue);
      const before = priorValue === undefined ? {} : { [KEY]: priorValue };
      const leakedAfter = { ...before, [KEY]: tempValue };
      const leaks = diffEnvSnapshots(before, leakedAfter);
      assert.deepEqual(leaks, [{ key: KEY, before: priorValue, after: tempValue }]);
    }),
    { numRuns: 100 },
  );
});

// BL-720 invariant 3 (BL-654 coder-authored): "A leak fails the suite
// loudly, naming the offending file and the leaked key — never silently,
// and never only under unlucky scheduling."
//
// formatEnvLeakMessage is what the runtime guard (envRestoreGuardSetup.js)
// throws to fail the test. This property proves the message always names
// BOTH the exact file path and EVERY leaked key, for an arbitrary set of
// 1-5 leaked keys with arbitrary before/after values - including edge cases
// a hand-picked example could miss (empty-string values, keys that only
// differ by one leaked entry among several) - so the guard can never
// silently drop a leak out of the message it reports.
//
// Non-vacuous: manually confirmed to FAIL when formatEnvLeakMessage was
// temporarily changed to omit the leaks list (2026-08-01, coder), then
// restored.
const leakArb = fc.record({
  key: fc.stringMatching(/^[A-Z][A-Z0-9_]{0,20}$/),
  before: fc.option(fc.string(), { nil: undefined }),
  after: fc.option(fc.string(), { nil: undefined }),
});
const leaksArb = fc.uniqueArray(leakArb, { minLength: 1, maxLength: 5, selector: (l) => l.key });
const filePathArb = fc.stringMatching(/^\/repo\/extension\/test\/[a-zA-Z][a-zA-Z0-9]{0,20}\.test\.js$/);
const testNameArb = fc.string({ minLength: 1, maxLength: 40 });

test('the failure message always names the file and every leaked key, for an arbitrary set of leaks', () => {
  fc.assert(
    fc.property(filePathArb, testNameArb, leaksArb, (filePath, testName, leaks) => {
      const message = formatEnvLeakMessage(filePath, testName, leaks);
      assert.ok(message.includes(filePath), `expected message to include file ${filePath}`);
      for (const leak of leaks) {
        assert.ok(message.includes(leak.key), `expected message to include leaked key ${leak.key}`);
      }
    }),
    { numRuns: 100 },
  );
});

// BL-720 invariant 2: "The set of failing files is the same on every run of
// the same commit; no part of the suite's verdict depends on fork or file
// scheduling." STATED REASON, no property test (per this ticket's
// Invariants contract: a declared invariant that quantifies over prose or
// process rather than a pure, testable module gets a stated reason instead
// of a test).
//
// This invariant quantifies over cross-process fork/file scheduling
// nondeterminism across multiple FULL-SUITE invocations - not a pure module
// a generator can reach into. It is the logical consequence of invariant 1
// holding at every mutation site: if no test ever leaves process.env
// different from what it found, no later file's outcome can depend on
// which file happened to run before it, in which fork. It is verified
// end-to-end instead: the coder ran the real `npx vitest run` three
// consecutive times against the fixed suite (2026-08-01) and got an
// identical 399 files / 7052 tests passed each time (before the fix, the
// ticket's own evidence records 5, then 24, then 81 failing tests across
// three such runs). QA's e2e procedure (recorded in the ticket's `notes:`)
// repeats this independently before approval.
