'use strict';

// BL-1179 (epic BL-1176): step handlers for cross-vendor memory adapters +
// the unsupported matrix. Drives the REAL agentMemoryVendorAdapters /
// agentMemoryTransfer (extension/out/tools/*) — never a reimplementation.
const assert = require('node:assert/strict');

const {
  isSupportedVendorPair,
  unsupportedVendorMatrix,
  transferMemoryAcrossVendors,
} = require('../../../extension/out/tools/agentMemoryVendorAdapters');
const { agentMemoryTransfer } = require('../../../extension/out/tools/agentMemoryTransfer');

const FEATURE = 'cross-vendor memory adapters refuse unsupported pairs loudly';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^the portable agent-memory payload from BL-1177$/, (ctx) => {
    ctx.bl1179 = {};
  });

  scoped(/^outgoing and incoming runtimes are a supported pair in the matrix$/, (ctx) => {
    ctx.bl1179.outgoing = 'claude';
    ctx.bl1179.incoming = 'codex';
    assert.ok(isSupportedVendorPair(ctx.bl1179.outgoing, ctx.bl1179.incoming), 'fixture pair must be supported');
  });

  scoped(/^outgoing and incoming runtimes are listed as unsupported$/, (ctx) => {
    ctx.bl1179.outgoing = 'aider';
    ctx.bl1179.incoming = 'claude';
    assert.ok(!isSupportedVendorPair(ctx.bl1179.outgoing, ctx.bl1179.incoming), 'fixture pair must be unsupported');
  });

  scoped(/^memory transfer runs for that same-role swap$/, (ctx) => {
    ctx.bl1179.result = transferMemoryAcrossVendors(
      ctx.bl1179.outgoing,
      ctx.bl1179.incoming,
      'coder',
      { role: 'coder', transcriptSummary: 'ctx', openParcelIds: ['p1'] },
      agentMemoryTransfer
    );
  });

  scoped(/^memory transfer is attempted$/, (ctx) => {
    ctx.bl1179.result = transferMemoryAcrossVendors(
      ctx.bl1179.outgoing,
      ctx.bl1179.incoming,
      'coder',
      { role: 'coder', transcriptSummary: 'ctx', openParcelIds: ['p1'] },
      agentMemoryTransfer
    );
  });

  scoped(/^transfer succeeds using the portable payload$/, (ctx) => {
    assert.equal(ctx.bl1179.result.ok, true, JSON.stringify(ctx.bl1179.result));
    assert.equal(ctx.bl1179.result.payload.kind, 'portable-agent-memory-payload');
  });

  scoped(/^transfer refuses naming the unsupported matrix reason$/, (ctx) => {
    assert.equal(ctx.bl1179.result.ok, false);
    assert.match(ctx.bl1179.result.signal, /unsupported vendor pair/);
  });

  scoped(/^continuity is not silently pretended$/, (ctx) => {
    assert.equal(ctx.bl1179.result.ok, false);
    assert.equal(ctx.bl1179.result.injected, false);
  });

  scoped(/^the unsupported matrix is queried$/, (ctx) => {
    ctx.bl1179.matrix = unsupportedVendorMatrix();
  });

  scoped(/^each unsupported pair is named with a reason$/, (ctx) => {
    assert.ok(ctx.bl1179.matrix.length > 0);
    for (const entry of ctx.bl1179.matrix) {
      assert.ok(entry.outgoing);
      assert.ok(entry.incoming);
      assert.ok(entry.reason && entry.reason.length > 0);
    }
  });
}

module.exports = { registerSteps };
