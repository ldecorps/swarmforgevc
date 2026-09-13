const assert = require('node:assert/strict');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { runClosingCeremony, closingCeremonyLoudCodes } = require('../out/metrics/closingCeremonyRun');
const { readCeremonyRun } = require('../out/metrics/closingCeremonyStore');
const { appendLeanLedgerEventIfNew } = require('../out/metrics/leanLedgerStore');
const { ceremonyRunState } = require('../out/quality/closingCeremony');
const { runNightClosingCeremony } = require('../out/tools/night-closing-ceremony-run');

// BL-1528 (coder.prompt's Invariants section - first authorship rests with
// the coder): property tests for this ticket's two declared invariants.
// Runs ONLY via `npm run test:properties`; excluded from unit/coverage/
// mutation.
//
// Non-vacuity, checked by hand before landing: reverting
// closingCeremonyRun.ts's created-branch to the pre-fix shape (write the
// run as pending FIRST, then call deps.sendNote unguarded) reproduced the
// exact regression both properties below exist to catch - property 1 saw a
// refused send leave the stored run `pending` instead of `failed`, and
// property 2 saw the send's thrown error propagate out of
// runNightClosingCeremony instead of being turned into a loud code -
// restoring the real fix made both pass again.

function mkTmp() {
  return mkTmpDir('sfvc-bl1528-undeliverable-');
}

// Each day gets its own shiftKey (2026-01-01 + 2*dayIndex, so even the
// widest real-world local-time offset from UTC cannot fold two generated
// days onto the same calendar date) and a non-empty ledger, so the only way
// a run resolves is through the send this property controls - never the
// auto_no_change shortcut.
function isoForDay(dayIndex) {
  return new Date(Date.UTC(2026, 0, 1 + 2 * dayIndex, 20, 0, 0)).toISOString();
}

test('property (BL-1528 invariant 1): a run is pending only when its send was accepted; a refused send is failed at write time with the refusal text, never pending', () => {
  fc.assert(
    fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 12 }), (refusals) => {
      const target = mkTmp();
      refusals.forEach((refused, i) => {
        const at = isoForDay(i);
        const shiftKey = at.slice(0, 10);
        appendLeanLedgerEventIfNew(target, {
          ticket: `BL-${9000 + i}`,
          type: 'stage_transition',
          source: 'stage-dwell',
          at,
          role: 'coder',
          data: { processingMs: 1000 },
        });
        const refusalText = `refused for shift ${shiftKey}`;
        const deps = {
          sendNote: () => {
            if (refused) {
              throw new Error(refusalText);
            }
          },
        };
        const result = runClosingCeremony(target, at, deps);
        const stored = readCeremonyRun(target, shiftKey);
        assert.ok(stored, `expected a stored run for shift ${shiftKey}`);
        if (refused) {
          assert.equal(result.status, 'created_undeliverable');
          assert.notEqual(stored.failedAt, null, `refused shift ${shiftKey} must never be stored pending`);
          assert.equal(stored.outcome, null);
          assert.equal(stored.deliveryFailure, refusalText);
        } else {
          assert.equal(result.status, 'created');
          assert.equal(stored.failedAt, null);
          assert.equal(stored.deliveryFailure, null);
        }
      });
    }),
    { numRuns: 50 }
  );
});

// ── invariant 2 ──────────────────────────────────────────────────────────

// A realistic-but-fast RunDeps: every non-lean-packet effect is a no-op
// (readActiveRole 'documenter' + inFlightCount 0 keeps the state machine on
// its "happy days" path, so no rotate-documenter/instruct-briefing side
// effect is even attempted), while deliverLeanPacket/recordEmptyOutcome run
// the REAL composition night-closing-ceremony-run.ts's own buildRealDeps
// wires - runClosingCeremony + closingCeremonyLoudCodes - against an
// INJECTED sendNote, so the property drives the exact code path production
// uses without a real swarm_handoff.sh subprocess.
function makeInjectedNightDeps() {
  const state = { current: null };
  const surfaced = [];
  // A placeholder - recordEmptyOutcome/deliverLeanPacket are both replaced
  // per-iteration below once each day's own refusal decision is known;
  // workedAShift is always true here so record-empty-outcome's action
  // (and this placeholder) is never actually reached.
  const sendNote = () => {};
  const deps = {
    readConf: () => '',
    evaluate: () => ({
      mode: 'ceremony',
      scheduleState: 'ok',
      surfaced: 'nothing',
      ceremonyDue: true,
      ceremonyBeginLocal: '05:25',
      closureStopLocal: '06:00',
    }),
    readState: () => state.current,
    writeState: (_t, s) => {
      state.current = s;
    },
    scanInFlight: () => ({ count: 0, roles: [] }),
    scanHeld: () => [],
    readActiveRole: () => 'documenter',
    briefingSent: () => false,
    applyFreeze: () => {},
    rotateDocumenter: () => {},
    instructBriefing: () => {},
    nightStop: () => {},
    surface: (_t, code) => surfaced.push(code),
    recordCnp: () => {},
    deliverLeanPacket: (t, shiftKey) => {
      const result = runClosingCeremony(t, `${shiftKey}T00:00:00Z`, { sendNote });
      return closingCeremonyLoudCodes(result);
    },
    recordEmptyOutcome: (t, shiftKey) => {
      const result = runClosingCeremony(t, `${shiftKey}T00:00:00Z`, { sendNote });
      return closingCeremonyLoudCodes(result);
    },
    workedAShift: () => true,
  };
  return { deps, state, surfaced };
}

test('property (BL-1528 invariant 2): a refused send never throws out of the night sequence; state is written, and a re-run sends nothing again', () => {
  fc.assert(
    fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }), (refusals) => {
      const target = mkTmp();
      const { deps, state, surfaced } = makeInjectedNightDeps();

      refusals.forEach((refused, i) => {
        const dayIso = isoForDay(i);
        const dayMs = Date.parse(dayIso);
        const shiftKey = dayIso.slice(0, 10);
        appendLeanLedgerEventIfNew(target, {
          ticket: `BL-${9100 + i}`,
          type: 'stage_transition',
          source: 'stage-dwell',
          at: `${shiftKey}T09:00:00.000Z`,
          role: 'coder',
          data: { processingMs: 1000 },
        });
        deps.deliverLeanPacket = (t, sk) => {
          const result = runClosingCeremony(t, `${sk}T00:00:00Z`, {
            sendNote: () => {
              if (refused) {
                throw new Error(`refused for shift ${sk}`);
              }
            },
          });
          return closingCeremonyLoudCodes(result);
        };

        // Tick 1: idle -> frozen (no lean-packet action yet).
        assert.doesNotThrow(() => runNightClosingCeremony(target, '/dev/null', dayMs, deps));
        const surfaceCountBeforeLean = surfaced.length;
        // Tick 2: frozen -> briefing, which is where lean-packet actually runs.
        assert.doesNotThrow(() => runNightClosingCeremony(target, '/dev/null', dayMs + 1000, deps));

        const stored = readCeremonyRun(target, shiftKey);
        assert.ok(stored, `expected a stored run for shift ${shiftKey}`);
        if (refused) {
          assert.notEqual(stored.failedAt, null);
          assert.ok(
            surfaced.slice(surfaceCountBeforeLean).some((c) => c.startsWith('closing-lean-packet-undeliverable')),
            `expected a loud code to be surfaced for the refused shift ${shiftKey}`
          );
          assert.ok(
            state.current.loudSurfaces.some((c) => c.startsWith('closing-lean-packet-undeliverable')),
            `expected the written state's loudSurfaces to carry the code for ${shiftKey}`
          );
        } else {
          assert.equal(stored.failedAt, null);
        }

        // A later sweep re-running the step: no second send attempt, no
        // second lean-packet loud code, never throws. (The hard-deadline's
        // own 'closing-briefing-missing' surface is a separate, unrelated
        // mechanism this property is not about, so only ceremony-send codes
        // are counted here.)
        const isCeremonySendCode = (c) => c.startsWith('closing-lean-packet-undeliverable') || c.startsWith('closing-ceremony-failure-undeliverable');
        const ceremonyCodeCountBeforeReRun = surfaced.filter(isCeremonySendCode).length;
        assert.doesNotThrow(() => runNightClosingCeremony(target, '/dev/null', dayMs + 2000, deps));
        assert.equal(
          surfaced.filter(isCeremonySendCode).length,
          ceremonyCodeCountBeforeReRun,
          `expected no further ceremony-send loud code from a re-run on shift ${shiftKey}`
        );
      });
    }),
    { numRuns: 30 }
  );
});
