const { mkTmpDir } = require('./helpers/tmpDir');
const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const {
  appendAvailabilityRecord,
  availabilityLedgerFileForMonth,
} = require('../out/metrics/availabilityLedgerStore');
const { writeControlPauseState, readControlPauseState } = require('../out/tools/telegram-front-desk-bot');
const { writeOperatorPauseState, readOperatorPauseState } = require('../out/tools/telegramCursorOperatorExec');

// BL-823 invariant 1 (declared in the ticket YAML): "A ledger write failure
// never blocks, fails, or alters the operation it observes - every pause,
// stop and start completes exactly as it does today whether or not the
// ledger is writable." Authored by the coder per BL-654 (first authorship
// of a declared invariant's property test rests with the coder). The
// EISDIR-directory-at-the-exact-path technique (never chmod) is this
// codebase's established, portable way to force a REAL write failure - see
// availabilityLedgerStore.test.js's own single-case version of this; this
// file is the property-generalized form across every event/class/source/ts
// combination and both TS write call sites. Runs ONLY via
// `npm run test:properties` (vitest.properties.config.mjs).

const BASE_MS = Date.parse('2026-08-01T00:00:00Z');

const eventArb = fc.constantFrom('pause-start', 'pause-end', 'stop', 'start');
const classArb = fc.constantFrom('control-pause', 'swarm-stop');
const sourceArb = fc.string({ minLength: 0, maxLength: 24 });
const offsetMsArb = fc.integer({ min: 0, max: 60 * 24 * 60 * 60 * 1000 }); // up to 60 days
const untilOffsetArb = fc.option(fc.integer({ min: 0, max: 60 * 60 * 1000 }), { nil: undefined });

function tsFromOffset(offsetMs) {
  return new Date(BASE_MS + offsetMs).toISOString();
}

function blockLedgerPath(root, ts) {
  const filePath = availabilityLedgerFileForMonth(root, ts.slice(0, 7));
  fs.mkdirSync(filePath, { recursive: true });
}

test('property: appendAvailabilityRecord never throws whether or not the ledger is writable', () => {
  fc.assert(
    fc.property(eventArb, classArb, sourceArb, offsetMsArb, fc.boolean(), (event, cls, source, offsetMs, blocked) => {
      const root = mkTmpDir('bl823-prop-write-');
      const ts = tsFromOffset(offsetMs);
      if (blocked) {
        blockLedgerPath(root, ts);
      }
      assert.doesNotThrow(() => appendAvailabilityRecord(root, event, cls, source, ts));
    }),
    { numRuns: 40 }
  );
});

test('property: writeControlPauseState always writes the pause state file and never throws, whether or not the ledger is writable', () => {
  fc.assert(
    fc.property(fc.boolean(), untilOffsetArb, sourceArb, fc.boolean(), (active, untilOffset, source, blocked) => {
      const root = mkTmpDir('bl823-prop-control-');
      if (blocked) {
        blockLedgerPath(root, new Date().toISOString());
      }
      const untilMs = active && untilOffset !== undefined ? Date.now() + untilOffset : undefined;
      assert.doesNotThrow(() => writeControlPauseState(root, active ? { active: true, untilMs } : { active: false }, source));
      assert.deepEqual(readControlPauseState(root), active ? { active: true, untilMs } : { active: false });
    }),
    { numRuns: 40 }
  );
});

test('property: writeOperatorPauseState always writes the pause state file and never throws, whether or not the ledger is writable', () => {
  fc.assert(
    fc.property(fc.boolean(), untilOffsetArb, sourceArb, fc.boolean(), (active, untilOffset, source, blocked) => {
      const root = mkTmpDir('bl823-prop-operator-');
      if (blocked) {
        blockLedgerPath(root, new Date().toISOString());
      }
      const untilMs = active && untilOffset !== undefined ? Date.now() + untilOffset : undefined;
      // readOperatorPauseState (like its writeControlPauseState twin)
      // unconditionally includes an `untilMs` key when active - possibly
      // `undefined` - so the expected shape mirrors that exactly rather
      // than omitting the key.
      const state = active ? { active: true, untilMs } : { active: false };
      assert.doesNotThrow(() => writeOperatorPauseState(root, state, source));
      assert.deepEqual(readOperatorPauseState(root), state);
    }),
    { numRuns: 40 }
  );
});
