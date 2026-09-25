'use strict';

// BL-1744: step handlers for "The local seat asks the model not to
// think". Drives the REAL compiled completeWithLocalModel
// (extension/out/tools/localQwenSeatLive.js) against a stand-in fetch that
// records the request it received - never a restatement of the request
// body it builds.

const assert = require('node:assert/strict');
const path = require('node:path');

const { completeWithLocalModel } = require(path.join(__dirname, '..', '..', '..', 'extension', 'out', 'tools', 'localQwenSeatLive'));

const ENDPOINT = 'http://127.0.0.1:11434';

// BL-421/engineering.prompt Scenario Outline rule: the <with or without>
// column is validated against this explicit map, never a bare passthrough.
const KNOWN_SYSTEM_PROMPT_MODES = {
  with: 'You are the local seat.',
  without: undefined,
};

function knownSystemPromptMode(text) {
  if (!Object.prototype.hasOwnProperty.call(KNOWN_SYSTEM_PROMPT_MODES, text)) {
    throw new Error(`BL-1744: unrecognized <with or without> example value "${text}"`);
  }
  return KNOWN_SYSTEM_PROMPT_MODES[text];
}

function registerSteps(registry) {
  registry.define(/^a stand-in ollama endpoint that records the request it receives$/, (ctx) => {
    ctx.sawUrl = undefined;
    ctx.sawBody = undefined;
    ctx.fakeFetch = async (url, init) => {
      ctx.sawUrl = url;
      ctx.sawBody = JSON.parse(init.body);
      return { ok: true, status: 200, text: async () => JSON.stringify({ response: 'the answer' }) };
    };
  });

  registry.define(/^the local seat completes a turn (\S+) a system prompt$/, async (ctx, modeText) => {
    const system = knownSystemPromptMode(modeText);
    ctx.reply = await completeWithLocalModel('qwen3:14b', 'hello', ENDPOINT, ctx.fakeFetch, system);
  });

  registry.define(/^the recorded request's think field is false$/, (ctx) => {
    assert.equal(ctx.sawBody.think, false);
  });

  registry.define(/^the seat returns the endpoint's reply as its answer$/, (ctx) => {
    assert.equal(ctx.reply, 'the answer');
  });
}

module.exports = { registerSteps };
