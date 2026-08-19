'use strict';

// BL-915: step handlers for "the Cursor bridge starts a new agent when the
// stored agentId is gone" - a stamp-off certifying hotfix ece61cbe63,
// already in production. Drives the REAL createLiveCursorBridgeAgentSession
// against a real state file, with the real SDK's Agent.create/Agent.resume
// swapped for injected mocks - the same shape
// extension/test/cursorBridgeAgentSession.test.js's own shipped live-session
// tests use, and the same shape the sibling
// bl696TelegramCursorBridgeOperatorSteps.js already established for this
// exact module: cleanup via node:test's own afterEach, not a manual
// guarded/terminal wrapper dance - it runs after every scenario regardless
// of which step ran last or whether one threw, which sidesteps the
// "one shared step is gherkin-terminal in some scenarios but not others"
// puzzle other BL-9xx step files this session had to solve by hand.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach } = require('node:test');

const EXT_OUT = path.join(__dirname, '..', '..', '..', 'extension', 'out');
const SDK_PATH = path.join(__dirname, '..', '..', '..', 'extension', 'node_modules', '@cursor', 'sdk');

const FEATURE = 'the Cursor bridge starts a new agent when the stored agentId is gone';

const STORED_AGENT_ID = 'agent-47f26e41-65e8-459a-96f0-4a6a8e7bbfb0';
const NEW_AGENT_ID = 'agent-live-99';

// Every Examples: column value is validated against an explicit KNOWN_VALUES
// lookup and throws on anything else (engineering.prompt's Scenario Outline
// rule) - never a bare passthrough. Messages chosen to match the REAL
// classifier substrings/regex in telegramCursorBridgeCore.ts exactly (read
// from source, not guessed).
const FAULT_MESSAGE_VALUES = {
  'an active-run conflict': 'Agent already has active run in progress.',
  'an authentication error': 'Authentication error. If you are logged in, try logging out and back in.',
  'a connection failure': 'connection failed',
  'a gone-agent error': `Agent ${STORED_AGENT_ID} not found.`,
  'a rate-limit or quota error': 'resource_exhausted: rate limit exceeded',
};

function parseFaultToken(token) {
  const message = FAULT_MESSAGE_VALUES[token];
  if (message === undefined) {
    throw new Error(`unknown fault token: ${token}`);
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
      // best-effort - a restore throwing must never mask the scenario's
      // own pass/fail result, which node:test has already recorded by now.
    }
  }
});

function mkRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-bl915-'));
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

function readState(root) {
  return JSON.parse(fs.readFileSync(statePath(root), 'utf8'));
}

// A working agent: send() succeeds and the run completes normally.
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

// An agent that resumes/opens fine but whose RUN fails - the real shape a
// quota/rate-limit fault takes (assertCursorRunSucceeded in
// cursorBridgeAgentSession.ts, checked on the run's own result, never
// during Agent.resume itself).
function mockAgentWhoseRunFails(errorMessage) {
  return {
    agentId: STORED_AGENT_ID,
    close: async () => {},
    async send() {
      return {
        async *stream() {},
        async wait() {
          return { status: 'error', id: 'run-fail', error: { message: errorMessage } };
        },
      };
    },
  };
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.defineScoped(
    /^the Cursor bridge has a stored agentId from an earlier session$/,
    (ctx) => {
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
    },
    FEATURE
  );

  // ── Given: the fault (two step-text shapes) ──────────────────────────
  // A quoted literal message (scenarios 01/02, and 05's own quoted Examples
  // column values) - used verbatim as the SDK's thrown error message.
  registry.defineScoped(
    /^resuming the stored agent fails with "([^"]*)"$/,
    (ctx, message) => {
      ctx.faultMessage = message;
      ctx.isQuotaCase = false;
    },
    FEATURE
  );

  // A bare descriptive phrase (scenario 03's outline, scenario 04's single
  // case) - resolved through the explicit KNOWN_VALUES lookup.
  registry.defineScoped(
    /^resuming the stored agent fails with (.+)$/,
    (ctx, token) => {
      ctx.faultMessage = parseFaultToken(token);
      ctx.isQuotaCase = token === 'a rate-limit or quota error';
    },
    FEATURE
  );

  // ── When: drive the real session ─────────────────────────────────────
  registry.defineScoped(
    /^the operator sends a prompt through the bridge$/,
    async (ctx) => {
      const sdk = ctx.sdk;
      if (ctx.isQuotaCase) {
        // Resume succeeds (the stored agent is still valid) but its run
        // fails with a quota/rate-limit error - the real code path that
        // fault takes, distinct from every other fault here.
        sdk.Agent.resume = async () => mockAgentWhoseRunFails(ctx.faultMessage);
        sdk.Agent.create = async () => {
          ctx.creates += 1;
          return mockWorkingAgent('should not be reached');
        };
      } else {
        sdk.Agent.resume = async () => {
          throw new Error(ctx.faultMessage);
        };
        sdk.Agent.create = async () => {
          ctx.creates += 1;
          return mockWorkingAgent('after gone-agent reset');
        };
      }

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
    },
    FEATURE
  );

  // ── Then / And ────────────────────────────────────────────────────────
  registry.defineScoped(
    /^a new agent is created$/,
    (ctx) => {
      assert.equal(ctx.error, null, `expected no error, got: ${ctx.error && ctx.error.message}`);
      assert.equal(ctx.creates, 1, 'expected exactly one Agent.create call');
    },
    FEATURE
  );

  registry.defineScoped(
    /^the operator receives the new agent's reply rather than an error$/,
    (ctx) => {
      assert.ok(ctx.reply, 'expected a reply, got an error');
      assert.match(ctx.reply.replyText, /after gone-agent reset/);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the stored agentId is the newly created agent's id$/,
    (ctx) => {
      assert.equal(readState(ctx.root).agentId, NEW_AGENT_ID);
    },
    FEATURE
  );

  registry.defineScoped(
    /^the stored agentId is no longer the one the cloud rejected$/,
    (ctx) => {
      assert.notEqual(readState(ctx.root).agentId, ctx.storedAgentId);
    },
    FEATURE
  );

  registry.defineScoped(
    /^no new agent is created$/,
    (ctx) => {
      assert.equal(ctx.creates, 0, `expected zero Agent.create calls, got ${ctx.creates}`);
      assert.ok(ctx.error, 'expected the prompt to fail rather than succeed');
    },
    FEATURE
  );

  registry.defineScoped(
    /^the operator is told the reason rather than being silently retried$/,
    (ctx) => {
      assert.match(ctx.error.message, /quota/i, `expected the quota reason surfaced, got: ${ctx.error.message}`);
    },
    FEATURE
  );
}

module.exports = { registerSteps };
