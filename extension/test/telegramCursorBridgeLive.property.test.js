const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fc = require('fast-check');
const { mkTmpDir } = require('./helpers/tmpDir');
const { createMockCursorBridgeAgentSession } = require('../out/bridge/cursorBridgeAgentSession');
const { resolveDeferredReplyTopicId } = require('../out/tools/telegramCursorBridgeCore');
const { runCursorBridgePollOnce, writeJsonFile } = require('../out/tools/telegramCursorBridgeLive');

// BL-767 invariant #1: "A queued prompt is answered in exactly one topic:
// the one it was asked in, or the Cursor Remote topic when no origin was
// recorded — never both, never neither." Runs ONLY via `npm run
// test:properties`.

const topicIdArb = fc.integer({ min: 1, max: 1_000_000 });

// Property A (pure): the single shared resolver every deferred-reply site
// calls through. Exactly-one-topic starts here — if this drifted, every
// site built on it would too.
test('property: resolveDeferredReplyTopicId always resolves to exactly the origin, or the Cursor Remote fallback when absent — never a third value', () => {
  fc.assert(
    fc.property(
      fc.option(topicIdArb, { nil: undefined }),
      fc.option(topicIdArb, { nil: undefined }),
      (originTopicId, cursorTopicId) => {
        const resolved = resolveDeferredReplyTopicId(originTopicId, cursorTopicId);
        if (originTopicId !== undefined) {
          assert.equal(resolved, originTopicId, 'a recorded origin must win outright, regardless of cursorTopicId');
        } else {
          assert.equal(resolved, cursorTopicId, 'an absent origin must fall back to Cursor Remote, nothing else');
        }
      }
    ),
    { numRuns: 300 }
  );
});

function mkRoot() {
  const root = mkTmpDir('sfvc-tg-bridge-live-prop-');
  fs.mkdirSync(path.join(root, '.swarmforge', 'operator'), { recursive: true });
  return root;
}

const NOOP_TELEGRAM_POST_FN = async () => ({ ok: true, status: 200, json: {} });

function mkPollDeps(root, cursorTopicId) {
  const opDir = path.join(root, '.swarmforge', 'operator');
  const statePath = path.join(opDir, 'cursor-bridge-state.json');
  const topicMapPath = path.join(opDir, 'cursor-bridge-topic-map.json');
  writeJsonFile(statePath, { updateOffset: 0, cursorTopicId });
  return {
    repoRoot: root,
    botToken: 'token',
    chatId: '-100',
    principalUserId: '42',
    opDir,
    statePath,
    topicMapPath,
    agentSession: createMockCursorBridgeAgentSession(root),
    telegramPostFn: NOOP_TELEGRAM_POST_FN,
  };
}

// Drives an "Agent started…" reply through one of the two real deferred-
// reply drain paths and returns the set of distinct topic ids it posted to.
// Both paths funnel through resolveDeferredReplyTopicId (processQueuedPollAnswer /
// processChoicePollAnswer in telegramCursorBridgeLive.ts) - this exercises
// the ACTUAL wiring, not just the pure resolver above.
async function drainAndCollectReplyTopics(drainPath, originTopicId, cursorTopicId) {
  const root = mkRoot();
  const deps = mkPollDeps(root, cursorTopicId);
  const postCalls = [];
  const pollId = 'poll-prop-1';
  const originField = originTopicId === undefined ? {} : { originTopicId };
  const initialState =
    drainPath === 'queued-prompt'
      ? {
          updateOffset: 80,
          cursorTopicId,
          pendingPrompts: [{ id: 'qp-1', text: 'queued', createdAtMs: Date.now(), ...originField }],
          pendingPromptPoll: { pollId, itemIds: ['qp-1'], clearAllOptionIndex: 1 },
        }
      : {
          updateOffset: 80,
          cursorTopicId,
          pendingChoicePolls: [{ pollId, question: 'Which?', options: ['a', 'b'], createdAtMs: Date.now(), ...originField }],
        };
  await runCursorBridgePollOnce(
    {
      ...deps,
      post: async (_t, _c, topicId, text) => {
        postCalls.push({ topicId, text });
      },
      getUpdates: async () => ({
        success: true,
        updates: [{ update_id: 81, poll_answer: { poll_id: pollId, option_ids: [0], user: { id: 42 } } }],
      }),
    },
    initialState,
    false,
    0
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  const startedTopics = new Set(postCalls.filter((c) => c.text.includes('Agent started')).map((c) => c.topicId));
  return startedTopics;
}

// Property B (integration, "sweeps (origin recorded/absent) x (drain
// path)"): whichever of the two real drain mechanisms fires, the reply
// lands in EXACTLY ONE topic, and it is the invariant's own topic — never
// both an origin topic AND Cursor Remote, never neither.
test('property: whichever deferred-reply path drains, the reply is posted to exactly one topic — the origin, or Cursor Remote when absent', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.constantFrom('queued-prompt', 'choice-poll'),
      fc.boolean(), // origin recorded?
      fc.tuple(topicIdArb, topicIdArb).filter(([a, b]) => a !== b), // distinct origin/cursor topic ids
      async (drainPath, originRecorded, [candidateOriginTopicId, cursorTopicId]) => {
        const originTopicId = originRecorded ? candidateOriginTopicId : undefined;
        const startedTopics = await drainAndCollectReplyTopics(drainPath, originTopicId, cursorTopicId);
        assert.equal(startedTopics.size, 1, `expected exactly one reply topic, got ${[...startedTopics]}`);
        const [actual] = startedTopics;
        const expected = resolveDeferredReplyTopicId(originTopicId, cursorTopicId);
        assert.equal(actual, expected);
      }
    ),
    { numRuns: 40 }
  );
});
