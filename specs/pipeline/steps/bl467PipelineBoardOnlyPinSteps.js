'use strict';

// BL-467: step handlers for "The pipeline board message is the only pinned
// message in the Telegram group". Drives the REAL compiled
// syncPipelineBoardPin (pipelineBoardPinSync.ts) against injected pin
// adapters that record every call in arrival order - never a hand-rolled
// substitute for the real decide/enforce logic, mirroring
// pipelineBoardPinSync.test.js's own fixture shape.
const assert = require('node:assert/strict');
const path = require('node:path');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const { syncPipelineBoardPin } = require(path.join(EXT_OUT, 'concierge', 'pipelineBoardPinSync'));

// Every Examples: column value is validated against an explicit KNOWN_VALUES
// lookup and throws on anything else (engineering.prompt's Scenario Outline
// rule) - never a bare passthrough/ternary that would lump a mutated token
// into a silent default.
const PIN_ID_VALUES = { none: undefined, '55': 55, '100': 100 };
const YES_NO_VALUES = { yes: true, no: false };
const OUTCOME_VALUES = new Set(['skip-no-board', 'skip-clean', 'enforce']);

function parsePinId(token) {
  if (!(token in PIN_ID_VALUES)) {
    throw new Error(`unknown pin-id token: ${token}`);
  }
  return PIN_ID_VALUES[token];
}

function parseYesNo(token) {
  if (!(token in YES_NO_VALUES)) {
    throw new Error(`unknown yes/no token: ${token}`);
  }
  return YES_NO_VALUES[token];
}

function parseOutcome(token) {
  if (!OUTCOME_VALUES.has(token)) {
    throw new Error(`unknown pin-sync outcome token: ${token}`);
  }
  return token;
}

function fakeAdapters(ctx) {
  return {
    getTopPinnedMessageId: async () => ctx.currentTopPinnedId,
    unpinAllMessages: async () => {
      ctx.calls.push('unpinAll');
      return !ctx.pinFails;
    },
    pinMessage: async (messageId) => {
      ctx.calls.push(`pin:${messageId}`);
      return !ctx.pinFails;
    },
  };
}

function registerSteps(registry) {
  registry.define(/^a pipeline board pin sync driven by injected pin adapters$/, (ctx) => {
    ctx.calls = [];
    ctx.currentTopPinnedId = undefined;
    ctx.boardMessageId = undefined;
    ctx.pinFails = false;
    ctx.threw = false;
  });

  registry.define(/^the current top pinned message in the group is (.+)$/, (ctx, token) => {
    ctx.currentTopPinnedId = parsePinId(token);
  });

  registry.define(/^the current board message id is (.+)$/, (ctx, token) => {
    ctx.boardMessageId = parsePinId(token);
  });

  registry.define(/^a different message is currently pinned in the group$/, (ctx) => {
    ctx.currentTopPinnedId = 55;
  });

  registry.define(/^the pin adapter reports the pin attempt failed$/, (ctx) => {
    ctx.pinFails = true;
  });

  registry.define(/^the pin sync runs$/, async (ctx) => {
    try {
      ctx.result = await syncPipelineBoardPin(ctx.boardMessageId, fakeAdapters(ctx));
    } catch (err) {
      ctx.threw = true;
      ctx.thrownError = err;
    }
  });

  registry.define(/^the pin sync outcome is (.+)$/, (ctx, token) => {
    const expected = parseOutcome(token);
    assert.equal(ctx.result.outcome, expected);
  });

  registry.define(/^unpin-all is called: (.+)$/, (ctx, token) => {
    const expected = parseYesNo(token);
    assert.equal(ctx.calls.includes('unpinAll'), expected);
  });

  registry.define(/^the board message is pinned: (.+)$/, (ctx, token) => {
    const expected = parseYesNo(token);
    assert.equal(
      ctx.calls.some((c) => c.startsWith('pin:')),
      expected
    );
  });

  registry.define(/^the pin sync completes without throwing$/, (ctx) => {
    if (ctx.threw) {
      throw new Error(`expected the pin sync not to throw, but it threw: ${ctx.thrownError}`);
    }
  });
}

module.exports = { registerSteps };
