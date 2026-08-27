'use strict';

const assert = require('node:assert/strict');
const fc = require('fast-check');
const {
  aggregateCapturePayload,
  validatePortablePayload,
  capture,
  inject,
  AGENT_MEMORY_PAYLOAD_SCHEMA_VERSION,
} = require('../out/tools/agentMemoryTransfer');

const roleArb = fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/);
const summaryArb = fc.string({ minLength: 1, maxLength: 120 });
const parcelIdArb = fc.stringMatching(/^[A-Za-z0-9._-]{1,24}$/);

test('BL-1177 P1: capture always emits schema-versioned portable payload fields', () => {
  fc.assert(
    fc.property(roleArb, summaryArb, fc.array(parcelIdArb, { maxLength: 6 }), (role, summary, parcelIds) => {
      const payload = aggregateCapturePayload({
        role,
        transcriptSummary: summary,
        openParcelIds: parcelIds,
      });
      assert.equal(payload.schemaVersion, AGENT_MEMORY_PAYLOAD_SCHEMA_VERSION);
      assert.equal(payload.kind, 'portable-agent-memory-payload');
      assert.equal(payload.continuitySummary, summary.trim());
      assert.deepEqual(payload.openParcelContext.openParcelIds, [...parcelIds].map((id) => id.trim()).filter(Boolean).sort());
    }),
    { numRuns: 80 }
  );
});

test('BL-1177 P2: inject fails closed on missing or malformed payload', () => {
  fc.assert(
    fc.property(
      roleArb,
      fc.oneof(fc.constant(null), fc.constant(undefined), fc.jsonValue(), fc.string()),
      (role, raw) => {
        const validated = validatePortablePayload(raw);
        const result = inject(role, raw);
        if (raw === null || raw === undefined || validated === null) {
          assert.equal(result.ok, false);
          assert.match(result.signal, /inject refused/i);
          assert.equal(result.pretendedContinuity, false);
        }
      }
    ),
    { numRuns: 80 }
  );
});

test('BL-1177 P3: valid capture round-trips through inject for same role', () => {
  fc.assert(
    fc.property(roleArb, summaryArb, fc.array(parcelIdArb, { maxLength: 4 }), (role, summary, parcelIds) => {
      const { payload } = capture({
        role,
        transcriptSummary: summary,
        openParcelIds: parcelIds,
      });
      const injected = inject(role, payload);
      assert.equal(injected.ok, true);
      assert.equal(injected.continuitySummary, payload.continuitySummary);
      assert.deepEqual(injected.openParcelContext, payload.openParcelContext);
      assert.equal(injected.pretendedContinuity, false);
    }),
    { numRuns: 60 }
  );
});

test('BL-1177 P4: aggregation is pure — identical inputs yield identical payloads', () => {
  fc.assert(
    fc.property(roleArb, summaryArb, fc.array(parcelIdArb, { maxLength: 5 }), (role, summary, parcelIds) => {
      const inputs = { role, transcriptSummary: summary, openParcelIds: parcelIds };
      assert.deepEqual(aggregateCapturePayload(inputs), aggregateCapturePayload(inputs));
    }),
    { numRuns: 40 }
  );
});
