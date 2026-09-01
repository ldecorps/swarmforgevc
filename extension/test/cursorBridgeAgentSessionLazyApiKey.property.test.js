const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');

const MODULE_PATH = require.resolve('../out/bridge/cursorBridgeAgentSession');

function freshModule() {
  delete require.cache[MODULE_PATH];
  return require(MODULE_PATH);
}

// BL-1322 declared invariant: "Constructing/starting a bridge server never
// requires CURSOR_API_KEY by itself -- only actually sending a prompt to the
// Cursor SDK agent does." Generates arbitrary pre-existing agent state (or
// none) and arbitrary non-prompt operation sequences, always with
// CURSOR_API_KEY absent from both the environment and swarm.env, and asserts
// none of them ever throw -- while a prompt attempt always throws the
// documented message. numRuns picked so the generator reliably visits both
// "no prior state file" and "prior state file with an agentId" on every run.

const priorStateArb = fc.option(
  fc.record({ updateOffset: fc.nat(), agentId: fc.string({ minLength: 1, maxLength: 24 }) }),
  { nil: undefined }
);

const nonPromptOpArb = fc.constantFrom('readAgentId', 'resetSession', 'constructOnly');

function mkRoot() {
  const root = mkTmpDir('sfvc-bl1322-prop-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

test('property: BL-1322 non-prompt operations never require CURSOR_API_KEY, only promptAgent does', async () => {
  const prevKey = process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_API_KEY;
  try {
    await fc.assert(
      fc.asyncProperty(priorStateArb, nonPromptOpArb, async (priorState, op) => {
        const root = mkRoot();
        if (priorState) {
          fs.writeFileSync(
            path.join(root, '.swarmforge', 'operator', 'cursor-bridge-state.json'),
            `${JSON.stringify(priorState, null, 2)}\n`,
            'utf8'
          );
        }
        const { createLiveCursorBridgeAgentSession } = freshModule();
        const session = createLiveCursorBridgeAgentSession(root);
        if (op === 'readAgentId') {
          session.readAgentId();
        } else if (op === 'resetSession') {
          await session.resetSession();
        }
        // constructOnly: nothing further -- construction itself must not have thrown.
      }),
      { numRuns: 25 }
    );

    // The one operation that DOES need the key still fails, loudly, every time.
    await fc.assert(
      fc.asyncProperty(priorStateArb, async (priorState) => {
        const root = mkRoot();
        if (priorState) {
          fs.writeFileSync(
            path.join(root, '.swarmforge', 'operator', 'cursor-bridge-state.json'),
            `${JSON.stringify(priorState, null, 2)}\n`,
            'utf8'
          );
        }
        const { createLiveCursorBridgeAgentSession } = freshModule();
        const session = createLiveCursorBridgeAgentSession(root);
        await assert.rejects(() => session.promptAgent('ping'), /CURSOR_API_KEY is not set for the headless bridge/);
      }),
      { numRuns: 10 }
    );
  } finally {
    if (prevKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = prevKey;
  }
});
