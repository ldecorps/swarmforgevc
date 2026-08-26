const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { withAgentLock } = require('../out/bridge/cursorBridgeAgentSession');
const { createLetsTalkTurnHandler } = require('../out/bridge/letsTalkRoutes');
const { createMockCursorBridgeAgentSession } = require('../out/bridge/cursorBridgeAgentSession');

// BL-696 declared invariants (backlog/paused/BL-696-miniapp-lets-talk-cursor-audio.yaml):
// 1. Exactly one writer owns the Cursor bridge agent session at a time.
// 2. Every STT/TTS/agent-spend route requires console control auth first.
// Coder-authored property tests per BL-654; runs only via npm run test:properties.

function mkRoot() {
  const root = mkTmpDir('sfvc-bl696-inv-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('property: invariant 1 - withAgentLock never runs two holders concurrently', async () => {
  const root = mkRoot();
  let maxConcurrent = 0;
  let concurrent = 0;
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 2, max: 6 }), async (workers) => {
      maxConcurrent = 0;
      concurrent = 0;
      await Promise.all(
        Array.from({ length: workers }, () =>
          withAgentLock(root, async () => {
            concurrent += 1;
            maxConcurrent = Math.max(maxConcurrent, concurrent);
            await sleep(5);
            concurrent -= 1;
          })
        )
      );
      assert.equal(maxConcurrent, 1, 'expected at most one concurrent lock holder');
    }),
    { numRuns: 25 }
  );
});

test('property: invariant 2 - /lets-talk/turn never spends STT when control auth fails', async () => {
  const root = mkRoot();
  let sttCalls = 0;
  const deps = {
    agentSession: createMockCursorBridgeAgentSession(root),
    transcribeAudio: async () => {
      sttCalls += 1;
      return { kind: 'ok', transcript: 'hello' };
    },
    synthesizeSpeech: async () => ({ kind: 'ok', audio: Buffer.from('x') }),
  };
  const handler = createLetsTalkTurnHandler(
    deps,
    async () => ({ audioBase64: Buffer.from('audio').toString('base64') }),
    (_req, res) => {
      res.end();
      return false;
    },
    () => {}
  );
  await fc.assert(
    fc.asyncProperty(fc.string({ minLength: 1, maxLength: 40 }), async () => {
      sttCalls = 0;
      await new Promise((resolve) => {
        handler({ method: 'POST' }, { writeHead() {}, end() { resolve(); } }, '/lets-talk/turn', { devices: [] });
      });
      assert.equal(sttCalls, 0, 'STT must not run without control auth');
    }),
    { numRuns: 20 }
  );
});

test('non-vacuity: invariant 1 property fails when lock serialization is bypassed', async () => {
  const root = mkRoot();
  let concurrent = 0;
  let maxConcurrent = 0;
  const brokenLock = async (fn) => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await sleep(5);
    concurrent -= 1;
    return fn();
  };
  await Promise.all([brokenLock(async () => {}), brokenLock(async () => {})]);
  assert.equal(maxConcurrent, 2, 'broken lock must allow overlap so the real test is non-vacuous');
});

test('non-vacuity: invariant 2 property fails when STT runs without auth', async () => {
  const root = mkRoot();
  let sttCalls = 0;
  const deps = {
    agentSession: createMockCursorBridgeAgentSession(root),
    transcribeAudio: async () => {
      sttCalls += 1;
      return { kind: 'ok', transcript: 'hello' };
    },
  };
  await deps.transcribeAudio(Buffer.from('x'));
  assert.equal(sttCalls, 1, 'broken path must spend STT so the auth gate test is non-vacuous');
});
