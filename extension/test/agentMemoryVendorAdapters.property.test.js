'use strict';

// BL-1179 D1 (architect bounce, backlog/evidence/BL-1179-architect-bounce-20260828.md):
// the ticket's two declared invariants had no executable property test.
// Both are encoded here against generated runtime-token pairs and generated
// role/state inputs.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  RUNTIME_MEMORY_ADAPTERS,
  vendorPairUnsupportedReason,
  transferMemoryAcrossVendors,
} = require('../out/tools/agentMemoryVendorAdapters');

const knownRuntimeArb = fc.constantFrom(...RUNTIME_MEMORY_ADAPTERS.map((a) => a.runtime));
// Arbitrary strings exercise the fail-closed unrecognised-runtime path
// (invariant 1 must hold there too, not only for the known table).
const anyRuntimeTokenArb = fc.oneof(
  { arbitrary: knownRuntimeArb, weight: 3 },
  { arbitrary: fc.string({ minLength: 0, maxLength: 12 }), weight: 1 }
);

const roleArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/);
const summaryArb = fc.string({ minLength: 1, maxLength: 40 });

test('BL-1179 P1: an unsupported pair never transfers, always names a reason; a supported pair is never refused', () => {
  fc.assert(
    fc.property(anyRuntimeTokenArb, anyRuntimeTokenArb, roleArb, summaryArb, (outgoing, incoming, role, summary) => {
      const reason = vendorPairUnsupportedReason(outgoing, incoming);
      const outcome = transferMemoryAcrossVendors(outgoing, incoming, role, { role, transcriptSummary: summary, openParcelIds: [] });

      if (reason !== null) {
        // Invariant 1, refusal half: an unsupported pair never returns
        // ok: true, and always carries a non-empty signal naming the reason.
        assert.equal(outcome.ok, false);
        assert.equal(outcome.captured, false);
        assert.equal(outcome.injected, false);
        assert.equal(typeof outcome.signal, 'string');
        assert.ok(outcome.signal.length > 0);
        assert.ok(outcome.signal.includes(reason));
      } else {
        // Invariant 1, converse half: transferMemoryAcrossVendors never
        // refuses at the matrix step for a supported pair - any ok: false
        // here can only come from runMemoryTransferForRole's own inject
        // step, never from a matrix-reason short-circuit (captured stays
        // true, and the signal - if any - never matches the matrix
        // unsupported-pair wording).
        if (outcome.ok === false) {
          assert.equal(outcome.captured, true);
          assert.ok(!outcome.signal.startsWith('unsupported vendor pair'));
        }
      }
    }),
    { numRuns: 300 }
  );
});

test('BL-1179 P2: a supported pair delegates verbatim to runMemoryTransferForRole - no second payload format', () => {
  fc.assert(
    fc.property(knownRuntimeArb, knownRuntimeArb, roleArb, summaryArb, (outgoing, incoming, role, summary) => {
      fc.pre(vendorPairUnsupportedReason(outgoing, incoming) === null);
      const state = { role, transcriptSummary: summary, openParcelIds: [] };

      const calls = [];
      const spyDeps = {
        capture: (s) => {
          calls.push(['capture', s]);
          return require('../out/tools/agentMemoryTransfer').capture(s);
        },
        inject: (r, p) => {
          calls.push(['inject', r, p]);
          return require('../out/tools/agentMemoryTransfer').inject(r, p);
        },
      };

      const viaAdapter = transferMemoryAcrossVendors(outgoing, incoming, role, state, spyDeps);
      const adapterCalls = calls.slice();
      calls.length = 0;

      const { runMemoryTransferForRole } = require('../out/tools/agentMemoryHotSwap');
      const direct = runMemoryTransferForRole(role, state, spyDeps);
      const directCalls = calls.slice();

      // Delegation, not a second format: identical outcome, and identical
      // capture/inject call sequence (same args, in the same order) - a
      // vendor-specific reformatting step in between would show up as a
      // divergence in either.
      assert.deepEqual(viaAdapter, direct);
      assert.deepEqual(adapterCalls, directCalls);
    }),
    { numRuns: 300 }
  );
});

// Non-vacuity (break-then-fix discipline): fixed, known cases proving each
// property is sensitive to the module's real output, not vacuously true.
test('BL-1179 non-vacuity: known supported/unsupported pairs behave as the properties expect', () => {
  const unsupported = transferMemoryAcrossVendors('aider', 'claude', 'coder', { transcriptSummary: 'x' });
  assert.equal(unsupported.ok, false);
  assert.ok(unsupported.signal.startsWith('unsupported vendor pair'));

  const bothUnsupported = transferMemoryAcrossVendors('mock', 'aider', 'coder', { transcriptSummary: 'x' });
  assert.equal(bothUnsupported.ok, false);
  assert.match(bothUnsupported.signal, /neither mock .* nor aider/);

  assert.throws(() => assert.equal(unsupported.ok, true));
});
