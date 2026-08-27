'use strict';

// BL-941: boundary scenarios for isCursorAgentGone formatting variants.
// Handler shape follows bl915CursorBridgeGoneAgentSessionResetSteps.js.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach } = require('node:test');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const SDK_PATH = path.join(__dirname, '..', '..', '..', 'extension', 'node_modules', '@cursor', 'sdk');

const FEATURE = 'the Cursor gone-agent classifier holds its boundaries';

const STORED_AGENT_ID = 'agent-47f26e41-65e8-459a-96f0-4a6a8e7bbfb0';
const NEW_AGENT_ID = 'agent-live-99';

const GONE_AGENT_MESSAGE_VALUES = {
  'the canonical gone-agent error': `Agent ${STORED_AGENT_ID} not found.`,
  'a gone-agent error with no full stop': `Agent ${STORED_AGENT_ID} not found`,
  'a gone-agent error in capitals': `AGENT ${STORED_AGENT_ID.toUpperCase()} NOT FOUND.`,
  'a gone-agent error inside prose': `Something went wrong: Agent ${STORED_AGENT_ID} not found. Please retry.`,
};

function parseGoneAgentToken(token) {
  const message = GONE_AGENT_MESSAGE_VALUES[token];
  if (message === undefined) {
    throw new Error(`unknown gone-agent message token: ${token}`);
  }
  return message;
}

let restoreFns = [];
afterEach(() => {
  while (restoreFns.length) {
    const fn = restoreFns.pop();
    try {
      fn();
    } catch {
      // best-effort cleanup
    }
  }
});

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl941-'));
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  restoreFns.push(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function statePath(root) {
  return path.join(root, '.swarmforge', 'operator', 'cursor-bridge-state.json');
}

function writeState(root, agentId) {
  fs.writeFileSync(statePath(root), `${JSON.stringify({ updateOffset: 0, agentId }, null, 2)}\n`, 'utf8');
}

function mockWorkingAgent(replyText) {
  return {
    agentId: NEW_AGENT_ID,
    close: async () => {},
    async send() {
      return {
        async *stream() {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: replyText }] } };
        },
        async wait() {
          return { status: 'success', id: 'run-live' };
        },
      };
    },
  };
}

function registerSteps(registry) {
  const scoped = (pattern, handler) => registry.defineScoped(pattern, handler, FEATURE);

  scoped(/^the Cursor bridge has a stored agentId from an earlier session$/, (ctx) => {
    ctx.root = mkRoot();
    writeState(ctx.root, STORED_AGENT_ID);
    ctx.storedAgentId = STORED_AGENT_ID;

    const sdk = require(SDK_PATH);
    const originalCreate = sdk.Agent.create;
    const originalResume = sdk.Agent.resume;
    restoreFns.push(() => {
      sdk.Agent.create = originalCreate;
      sdk.Agent.resume = originalResume;
    });
    ctx.sdk = sdk;

    const prevKey = process.env.CURSOR_API_KEY;
    process.env.CURSOR_API_KEY = 'test-key';
    restoreFns.push(() => {
      if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
      else process.env.CURSOR_API_KEY = prevKey;
    });

    ctx.creates = 0;
  });

  scoped(
    /^resuming the stored agent fails with a bare "Agent not found\." carrying no agent id$/,
    (ctx) => {
      ctx.faultMessage = 'Agent not found.';
    }
  );

  scoped(/^resuming the stored agent fails with (.+)$/, (ctx, token) => {
    ctx.faultMessage = parseGoneAgentToken(token);
  });

  scoped(/^the operator sends a prompt through the bridge$/, async (ctx) => {
    const sdk = ctx.sdk;
    sdk.Agent.resume = async () => {
      throw new Error(ctx.faultMessage);
    };
    sdk.Agent.create = async () => {
      ctx.creates += 1;
      return mockWorkingAgent('after gone-agent reset');
    };

    const modulePath = path.join(EXT_OUT, 'bridge', 'cursorBridgeAgentSession');
    delete require.cache[require.resolve(modulePath)];
    const { createLiveCursorBridgeAgentSession } = require(modulePath);
    const session = createLiveCursorBridgeAgentSession(ctx.root);
    try {
      ctx.reply = await session.promptAgent('ping');
      ctx.error = null;
    } catch (err) {
      ctx.reply = null;
      ctx.error = err;
    }
  });

  scoped(/^a new agent is created$/, (ctx) => {
    assert.equal(ctx.error, null, `expected no error, got: ${ctx.error && ctx.error.message}`);
    assert.equal(ctx.creates, 1, 'expected exactly one Agent.create call');
  });

  scoped(/^no new agent is created$/, (ctx) => {
    assert.equal(ctx.creates, 0, `expected zero Agent.create calls, got ${ctx.creates}`);
    assert.ok(ctx.error, 'expected the prompt to fail rather than succeed');
  });
}

module.exports = { registerSteps };
