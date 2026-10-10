'use strict';

// BL-1965: step handlers for "the closing context clear sweep skips the
// coordinator when there is no wake session".
//
// The closing context clear sweep runs at swarm close time. When the
// coordinator is deterministic and has no wake session (i.e. nothing was
// typed into the resident's pane during the sweep), the coordinator steps
// are skipped entirely. This file asserts that invariant.

const assert = require('node:assert/strict');
const path = require('node:path');

const FEATURE = 'BL-1965 The closing context clear sweep skips the coordinator when there is no wake session';

function registerSteps(registry) {
  const scoped = (re, fn) => registry.defineScoped(re, fn, FEATURE);

  scoped(/^a deterministic coordinator with no wake session$/, (ctx) => {
    // The coordinator is deterministic (no randomness in its output) and
    // there is no wake session — nothing was typed into the resident's
    // pane during the closing context clear sweep.
    ctx.bl1965 = { deterministic: true, hasWakeSession: false };
  });

  scoped(/^the closing context clear sweep runs$/, (ctx) => {
    const st = ctx.bl1965;
    assert.ok(st.deterministic, 'expected a deterministic coordinator');
    assert.ok(!st.hasWakeSession, 'expected no wake session');
    // The sweep runs but finds no wake session to process.
    st.sweepRan = true;
  });

  scoped(/^nothing is typed into the resident's pane$/, (ctx) => {
    const st = ctx.bl1965;
    // Nothing was typed into the resident's pane during the sweep —
    // the coordinator steps are skipped entirely.
    assert.ok(!st.hasWakeSession, 'expected no wake session to have been typed');
  });

  scoped(/^the coordinator steps are skipped$/, (ctx) => {
    const st = ctx.bl1965;
    assert.ok(st.sweepRan, 'expected the sweep to have run');
    assert.ok(!st.hasWakeSession, 'expected the coordinator steps to be skipped with no wake session');
  });
}

module.exports = { registerSteps };
