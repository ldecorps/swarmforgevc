'use strict';

const assert = require('node:assert/strict');
const {
  RUNTIME_MEMORY_ADAPTERS,
  runtimeMemoryAdapter,
  vendorPairUnsupportedReason,
  isSupportedVendorPair,
  unsupportedVendorMatrix,
  transferMemoryAcrossVendors,
} = require('../out/tools/agentMemoryVendorAdapters');

// ── runtimeMemoryAdapter ────────────────────────────────────────────────

test('BL-1179: a known supported runtime carries no reason', () => {
  const a = runtimeMemoryAdapter('claude');
  assert.equal(a.supported, true);
  assert.equal(a.reason, undefined);
});

test('BL-1179: aider is a known unsupported runtime with a reason', () => {
  const a = runtimeMemoryAdapter('aider');
  assert.equal(a.supported, false);
  assert.ok(a.reason && a.reason.length > 0);
});

test('BL-1179: mock is a known unsupported runtime with a reason', () => {
  const a = runtimeMemoryAdapter('mock');
  assert.equal(a.supported, false);
  assert.ok(a.reason && a.reason.length > 0);
});

test('BL-1179: an unrecognised runtime fails closed as unsupported, not silently allowed', () => {
  const a = runtimeMemoryAdapter('totally-unknown-vendor');
  assert.equal(a.supported, false);
  assert.match(a.reason, /not in the memory-adapter table/);
});

test('BL-1179: runtime lookup is case- and whitespace-insensitive (normalizeAgentToken)', () => {
  assert.equal(runtimeMemoryAdapter('  Claude  ').supported, true);
  assert.equal(runtimeMemoryAdapter('CLAUDE').runtime, 'claude');
});

// ── vendorPairUnsupportedReason / isSupportedVendorPair ─────────────────

test('BL-1179: two supported runtimes form a supported pair', () => {
  assert.equal(vendorPairUnsupportedReason('claude', 'codex'), null);
  assert.equal(isSupportedVendorPair('claude', 'codex'), true);
});

test('BL-1179: an unsupported outgoing runtime names itself in the reason', () => {
  const reason = vendorPairUnsupportedReason('aider', 'claude');
  assert.match(reason, /aider does not support memory transfer as the outgoing runtime/);
  assert.equal(isSupportedVendorPair('aider', 'claude'), false);
});

test('BL-1179: an unsupported incoming runtime names itself in the reason', () => {
  const reason = vendorPairUnsupportedReason('claude', 'mock');
  assert.match(reason, /mock does not support memory transfer as the incoming runtime/);
});

test('BL-1179: both sides unsupported names both in the reason', () => {
  const reason = vendorPairUnsupportedReason('aider', 'mock');
  assert.match(reason, /neither aider .* nor mock/);
});

// ── unsupportedVendorMatrix ───────────────────────────────────────────────

test('BL-1179: the unsupported matrix is queryable without a live swap and names every pair with a reason', () => {
  const matrix = unsupportedVendorMatrix();
  assert.ok(matrix.length > 0);
  for (const entry of matrix) {
    assert.ok(entry.outgoing);
    assert.ok(entry.incoming);
    assert.ok(entry.reason && entry.reason.length > 0);
    assert.notEqual(entry.outgoing, entry.incoming);
  }
});

test('BL-1179: the unsupported matrix contains no fully-supported pair', () => {
  const matrix = unsupportedVendorMatrix();
  assert.ok(!matrix.some((e) => isSupportedVendorPair(e.outgoing, e.incoming)));
});

test('BL-1179: the unsupported matrix is derived from the adapter table, not hand-duplicated — every unsupported runtime appears', () => {
  const matrix = unsupportedVendorMatrix();
  const unsupportedRuntimes = RUNTIME_MEMORY_ADAPTERS.filter((a) => !a.supported).map((a) => a.runtime);
  for (const runtime of unsupportedRuntimes) {
    assert.ok(
      matrix.some((e) => e.outgoing === runtime || e.incoming === runtime),
      `expected ${runtime} to appear in the unsupported matrix`
    );
  }
});

// ── transferMemoryAcrossVendors ───────────────────────────────────────────

test('BL-1179: a supported pair transfers via the portable payload (delegates to runMemoryTransferForRole, no second format)', () => {
  const deps = {
    capture: (state) => ({ payload: { kind: 'portable-agent-memory-payload', schemaVersion: 1, role: state.role, continuitySummary: state.transcriptSummary, openParcelContext: { openParcelIds: state.openParcelIds } } }),
    inject: (role, payload) => ({ ok: true, role, openParcelContext: payload.openParcelContext, continuitySummary: payload.continuitySummary, pretendedContinuity: false }),
  };
  const result = transferMemoryAcrossVendors('claude', 'codex', 'coder', { role: 'coder', transcriptSummary: 'ctx', openParcelIds: ['p1'] }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.captured, true);
  assert.equal(result.injected, true);
});

test('BL-1179: an unsupported pair refuses naming the matrix reason and never calls capture/inject', () => {
  let called = false;
  const deps = {
    capture: () => {
      called = true;
      return { payload: {} };
    },
    inject: () => {
      called = true;
      return { ok: true };
    },
  };
  const result = transferMemoryAcrossVendors('aider', 'claude', 'coder', { role: 'coder', transcriptSummary: '', openParcelIds: [] }, deps);
  assert.equal(result.ok, false);
  assert.equal(result.captured, false);
  assert.equal(result.injected, false);
  assert.match(result.signal, /unsupported vendor pair \(aider → claude\)/);
  assert.equal(called, false, 'capture/inject must never run for an unsupported pair');
});

// Invariant 1, literally: never silently pretend continuity.
test('BL-1179: an unsupported pair never reports ok:true', () => {
  const result = transferMemoryAcrossVendors('mock', 'mock', 'coder', { role: 'coder', transcriptSummary: '', openParcelIds: [] });
  // mock -> mock: both sides unsupported, same runtime — still refused.
  assert.equal(result.ok, false);
});
