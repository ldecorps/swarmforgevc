'use strict';

// BL-1178: agent-memory transfer on hot-swap, relaunch, and trial boundaries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  attemptSameRoleModelSwitch,
  runTrialBoundaryMemoryTransfer,
} = require('../../../extension/out/tools/agentMemoryHotSwap');
const { agentMemoryTransfer } = require('../../../extension/out/tools/agentMemoryTransfer');

const FEATURE = 'agent-memory transfer runs on hot-swap relaunch and trial boundaries';

function scoped(registry, pattern, handler) {
  registry.defineScoped(pattern, handler, FEATURE);
}

function ensure(ctx) {
  if (!ctx.bl1178) ctx.bl1178 = {};
  return ctx.bl1178;
}

function registerSteps(registry) {
  scoped(registry, /^bl1178WireAgentMemoryHotSwapSteps acceptance handler is registered$/, () => {
    const idx = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
    assert.ok(
      idx.includes('bl1178WireAgentMemoryHotSwapSteps'),
      'expected bl1178WireAgentMemoryHotSwapSteps registered in index.js'
    );
  });

  scoped(registry, /^the portable agent-memory capture and inject API from BL-1177$/, () => {});

  scoped(registry, /^role "([^"]+)" is switching from one model to another via hot-swap$/, (ctx, role) => {
    const st = ensure(ctx);
    st.role = role;
    st.outgoingState = {
      role,
      transcriptSummary: 'hot-swap continuity for BL-1178',
      openParcelIds: ['parcel-hot-1178'],
    };
    st.swapRan = false;
    st.performSwap = () => {
      st.swapRan = true;
      return { success: true, message: 'respawned' };
    };
  });

  scoped(registry, /^the switch proceeds$/, (ctx) => {
    const st = ensure(ctx);
    st.switchResult = attemptSameRoleModelSwitch({
      role: st.role,
      outgoingState: st.outgoingState,
      performSwap: st.performSwap,
    });
  });

  scoped(registry, /^memory is captured from the outgoing agent$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.switchResult.memoryCaptured, true);
  });

  scoped(
    registry,
    /^memory is injected into the incoming agent before it takes live work$/,
    (ctx) => {
      const st = ensure(ctx);
      assert.equal(st.switchResult.memoryInjected, true);
      assert.equal(st.switchResult.success, true);
      assert.equal(st.swapRan, true, 'swap must run only after inject succeeds');
    }
  );

  scoped(registry, /^inject would fail for the incoming agent$/, (ctx) => {
    const st = ensure(ctx);
    st.role = st.role || 'coder';
    st.outgoingState = {
      role: st.role,
      transcriptSummary: 'abort fixture',
      openParcelIds: [],
    };
    st.swapRan = false;
    st.deps = {
      capture: agentMemoryTransfer.capture,
      inject: () => ({
        ok: false,
        signal: 'inject refused: portable memory payload is missing — fail closed',
        pretendedContinuity: false,
      }),
    };
    st.performSwap = () => {
      st.swapRan = true;
      return { success: true, message: 'must not run' };
    };
  });

  scoped(registry, /^a same-role model switch is attempted$/, (ctx) => {
    const st = ensure(ctx);
    st.switchResult = attemptSameRoleModelSwitch({
      role: st.role,
      outgoingState: st.outgoingState,
      performSwap: st.performSwap,
      deps: st.deps,
    });
  });

  scoped(registry, /^the switch is aborted with a clear signal$/, (ctx) => {
    const st = ensure(ctx);
    assert.equal(st.switchResult.success, false);
    assert.match(st.switchResult.message, /inject refused/i);
  });

  scoped(registry, /^the seat is not reported as successfully swapped$/, (ctx) => {
    const st = ensure(ctx);
    assert.notEqual(st.switchResult.success, true);
    assert.equal(st.swapRan, false, 'performSwap must not run when inject fails');
  });

  scoped(
    registry,
    /^a BoB or steward trial (start|end) changes the model for one role$/,
    (ctx, boundary) => {
      const st = ensure(ctx);
      st.boundary = boundary;
      st.role = 'coder';
      st.outgoingState = {
        role: st.role,
        transcriptSummary: `trial ${boundary} continuity`,
        openParcelIds: [`trial-${boundary}-1178`],
      };
    }
  );

  scoped(registry, /^that boundary runs$/, (ctx) => {
    const st = ensure(ctx);
    st.trialResult = runTrialBoundaryMemoryTransfer(st.role, st.boundary, st.outgoingState);
  });

  scoped(
    registry,
    /^memory transfer runs for that role before live work resumes$/,
    (ctx) => {
      const st = ensure(ctx);
      assert.equal(st.trialResult.ok, true);
      assert.equal(st.trialResult.captured, true);
      assert.equal(st.trialResult.injected, true);
    }
  );
}

module.exports = { registerSteps };
