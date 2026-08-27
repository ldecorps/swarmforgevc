'use strict';

// BL-1177: portable agent-memory payload capture/inject acceptance steps.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  agentMemoryTransfer,
  aggregateCapturePayload,
  AGENT_MEMORY_PAYLOAD_SCHEMA_VERSION,
} = require('../../../extension/out/tools/agentMemoryTransfer');

const FEATURE = 'portable agent-memory payload capture and inject for same-role swap';
const REPO_ROOT = path.join(__dirname, '..', '..', '..');

function ensure(ctx) {
  if (!ctx.bl1177) ctx.bl1177 = {};
  return ctx.bl1177;
}

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^bl1177PortableAgentMemoryPayloadSteps acceptance handler is registered$/, () => {
    const idx = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    assert.ok(
      idx.includes('bl1177PortableAgentMemoryPayloadSteps'),
      'expected bl1177PortableAgentMemoryPayloadSteps registered in index.js'
    );
  });

  scoped(/^a same-role model swap needs transferable agent memory$/, () => {});

  scoped(/^outgoing agent state for role "([^"]+)" with open parcel context$/, (ctx, role) => {
    const st = ensure(ctx);
    st.role = role;
    st.transcriptSummary = 'continuity summary for BL-1177 fixture';
    st.openParcelIds = ['parcel-1177-a', 'parcel-1177-b'];
    st.outgoingState = {
      role,
      transcriptSummary: st.transcriptSummary,
      openParcelIds: st.openParcelIds,
    };
  });

  scoped(/^memory is captured for that role$/, (ctx) => {
    const st = ensure(ctx);
    st.captureResult = agentMemoryTransfer.capture(st.outgoingState);
  });

  scoped(/^a portable payload is produced with a schema version$/, (ctx) => {
    const st = ensure(ctx);
    assert.ok(st.captureResult?.payload, 'expected capture to produce a payload');
    assert.equal(st.captureResult.payload.schemaVersion, AGENT_MEMORY_PAYLOAD_SCHEMA_VERSION);
    assert.ok(st.captureResult.payload.schemaVersion >= 1);
  });

  scoped(/^the payload carries open parcel context and a continuity summary$/, (ctx) => {
    const st = ensure(ctx);
    const payload = st.captureResult.payload;
    assert.deepEqual(payload.openParcelContext.openParcelIds, [...st.openParcelIds].sort());
    assert.equal(payload.continuitySummary, st.transcriptSummary);
  });

  scoped(/^a valid portable memory payload for role "([^"]+)"$/, (ctx, role) => {
    const st = ensure(ctx);
    st.role = role;
    st.payload = aggregateCapturePayload({
      role,
      transcriptSummary: 'incoming continuity summary',
      openParcelIds: ['parcel-inject-1'],
    });
  });

  scoped(/^memory is injected for that role before live work$/, (ctx) => {
    const st = ensure(ctx);
    st.injectResult = agentMemoryTransfer.inject(st.role, st.payload);
  });

  scoped(/^the incoming agent receives the open parcel context from the payload$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.injectResult.ok, true);
    assert.deepEqual(st.injectResult.openParcelContext, st.payload.openParcelContext);
  });

  scoped(/^the continuity summary is available to the incoming agent$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.injectResult.ok, true);
    assert.equal(st.injectResult.continuitySummary, st.payload.continuitySummary);
  });

  scoped(/^the portable memory payload is (missing|malformed)$/, (ctx, bad) => {
    const st = ensure(ctx);
    st.role = st.role || 'coder';
    st.badPayload = bad === 'missing' ? undefined : { schemaVersion: 'not-a-number' };
  });

  scoped(/^memory inject is attempted for a role$/, (ctx) => {
    const st = ensure(ctx);
    st.injectResult = agentMemoryTransfer.inject(st.role, st.badPayload);
  });

  scoped(/^inject refuses with a clear signal$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.injectResult.ok, false);
    assert.match(st.injectResult.signal, /inject refused/i);
    assert.match(st.injectResult.signal, /fail closed/i);
  });

  scoped(/^continuity is not silently pretended$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.injectResult.ok, false);
    assert.equal(st.injectResult.pretendedContinuity, false);
  });

  scoped(/^fixture inputs for transcript summary and open parcel ids$/, (ctx) => {
    const st = ensure(ctx);
    st.fixtureInputs = {
      role: 'coder',
      transcriptSummary: 'pure fixture transcript summary',
      openParcelIds: ['fixture-parcel-1', 'fixture-parcel-2'],
    };
  });

  scoped(/^capture runs in memory without a live agent$/, (ctx) => {
    const st = ensure(ctx);
    st.captureResult = { payload: aggregateCapturePayload(st.fixtureInputs) };
  });

  scoped(/^the payload fields match the fixture inputs$/, (ctx) => {
    const st = ensure(ctx);
    const payload = st.captureResult.payload;
    assert.equal(payload.role, st.fixtureInputs.role);
    assert.equal(payload.continuitySummary, st.fixtureInputs.transcriptSummary);
    assert.deepEqual(
      payload.openParcelContext.openParcelIds,
      [...st.fixtureInputs.openParcelIds].sort()
    );
  });
}

module.exports = { registerSteps };
