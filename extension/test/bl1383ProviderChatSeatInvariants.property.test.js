'use strict';

// BL-1383 declared invariants:
//
// 1. A topic bound in provider-chat-topic-map.json is decided before the
//    generic front-desk flow: no support subject is ever opened for a bound
//    topic's message, whether the provider answered, refused, or failed.
// 2. Provider credentials and endpoints reach the process from the extension
//    host environment and the gitignored map only - never from the target
//    working directory, a feature file, or a commit.
//
// Invariant 1 drives the REAL dispatch (runPollCycle -> processMessageUpdate)
// with the REAL seat turn behind it, and observes the REAL
// openSubjectAndRecord adapter. Asserting on a log line would prove nothing:
// the ticket's own qa_e2e step 2 says to check the subject store, not the
// absence of a message.
//
// Runs ONLY via `npm run test:properties`.

const assert = require('node:assert/strict');
const fc = require('fast-check');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const { runPollCycle } = require('../out/tools/telegramFrontDeskBotCore');
const {
  providerChatTopicMapPath,
  readProviderChatTopicSeats,
  runProviderChatSeatTurn,
} = require('../out/tools/providerChatSeatLive');

const PRINCIPAL_ID = 111;
const BOUND_TOPIC = 71550;
const BACKOFF_CONFIG = {
  backoffBaseMs: 1000,
  backoffMaxMs: 8000,
  degradedThreshold: 3,
  sustainedOutageThresholdMs: 30 * 60_000,
};
const FIXTURE_NOW = 0;
const NO_OUTAGE = { escalated: false };
const API_KEY = 'k-secret-value';


function writeMap(root, mapping) {
  const p = providerChatTopicMapPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(mapping), 'utf8');
}

function mkUpdate(topicId, text) {
  return {
    update_id: 1,
    message: { message_id: 1, chat: { id: 1 }, from: { id: PRINCIPAL_ID }, message_thread_id: topicId, text },
  };
}

/**
 * The three ways a bound topic's turn can end, per invariant 1's own wording:
 * answered, refused (no key), or failed (the provider threw). Each is a
 * DIFFERENT path through runProviderChatSeatTurn, which is why the invariant
 * enumerates them.
 */
const seatOutcomeArb = fc.constantFrom('answer', 'refuse-no-key', 'provider-throws', 'empty-reply');

function envFor(outcome) {
  return outcome === 'refuse-no-key' ? {} : { FAKE_KEY: API_KEY };
}

function completeFor(outcome) {
  if (outcome === 'provider-throws') {
    return async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:9');
    };
  }
  if (outcome === 'empty-reply') {
    return async () => '';
  }
  return async () => 'Hello from the seat';
}

function adaptersFor(root, update, outcome, opened, posted) {
  return {
    chatId: '1',
    getUpdates: async () => ({ success: true, updates: [update] }),
    postToBridge: async () => true,
    subjectForTopic: () => undefined,
    openSubjectAndRecord: async (topicId) => {
      opened.push(topicId);
      return 'SUP-1';
    },
    backlogForTopic: () => undefined,
    postOperatorContext: async () => true,
    nextOffset: (updates, current) => current + updates.length,
    runProviderChatSeat: async (topicId, text) => {
      const result = await runProviderChatSeatTurn({
        targetPath: root,
        topicId,
        text,
        env: envFor(outcome),
        complete: completeFor(outcome),
        post: async (postTopicId, message) => {
          posted.push({ topicId: postTopicId, message });
        },
      });
      return result.kind === 'not-mine' ? 'not-mine' : 'handled';
    },
  };
}

// ── invariant 1 ──────────────────────────────────────────────────────────

test('property (invariant 1): a bound topic never opens a support subject', async () => {
  const seen = { answered: 0, refused: 0, failed: 0, empty: 0 };
  await fc.assert(
    fc.asyncProperty(seatOutcomeArb, fc.string({ minLength: 1, maxLength: 40 }), async (outcome, text) => {
      seen[
        { answer: 'answered', 'refuse-no-key': 'refused', 'provider-throws': 'failed', 'empty-reply': 'empty' }[outcome]
      ] += 1;

      const root = mkTmpDir('sfvc-bl1383-inv1-');
      try {
        writeMap(root, {
          [BOUND_TOPIC]: { model: 'glm-4', baseUrl: 'https://api.example.test', apiKeyEnv: 'FAKE_KEY' },
        });
        const opened = [];
        const posted = [];
        const update = mkUpdate(BOUND_TOPIC, text);
        await runPollCycle(
          { offset: 0, consecutiveFailures: 0, sustainedOutage: NO_OUTAGE },
          PRINCIPAL_ID,
          adaptersFor(root, update, outcome, opened, posted),
          BACKOFF_CONFIG,
          FIXTURE_NOW
        );

        assert.deepEqual(
          opened,
          [],
          `a support subject was opened for bound topic ${BOUND_TOPIC} on the "${outcome}" path`
        );
        // ...and the topic was not merely silently swallowed: the seat spoke.
        assert.ok(posted.length > 0, `nothing was posted into the bound topic on the "${outcome}" path`);
        assert.ok(posted.every((p) => p.topicId === BOUND_TOPIC));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 25 }
  );

  // Reachability floors: invariant 1 names three endings explicitly, so a run
  // that only ever answered would pass it without testing what it claims.
  assert.ok(seen.answered >= 1, `generator never answered: ${JSON.stringify(seen)}`);
  assert.ok(seen.refused >= 1, `generator never refused: ${JSON.stringify(seen)}`);
  assert.ok(seen.failed >= 1, `generator never hit a provider failure: ${JSON.stringify(seen)}`);
});

test('property (invariant 1, the other side): an UNBOUND topic still opens its subject', async () => {
  const seen = { unbound: 0 };
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 9999 }).filter((n) => n !== BOUND_TOPIC),
      async (topicId) => {
        seen.unbound += 1;
        const root = mkTmpDir('sfvc-bl1383-inv1b-');
        try {
          writeMap(root, {
            [BOUND_TOPIC]: { model: 'glm-4', baseUrl: 'https://api.example.test', apiKeyEnv: 'FAKE_KEY' },
          });
          const opened = [];
          const posted = [];
          const update = mkUpdate(topicId, 'hello');
          await runPollCycle(
            { offset: 0, consecutiveFailures: 0, sustainedOutage: NO_OUTAGE },
            PRINCIPAL_ID,
            adaptersFor(root, update, 'answer', opened, posted),
            BACKOFF_CONFIG,
            FIXTURE_NOW
          );
          assert.deepEqual(opened, [topicId], `the unbound topic ${topicId} did not follow today's flow`);
          assert.deepEqual(posted, [], 'the seat spoke in a topic it does not own');
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
    ),
    { numRuns: 25 }
  );
  assert.ok(seen.unbound >= 1, 'generator produced no unbound topic');
});

// ── invariant 2 ──────────────────────────────────────────────────────────

// The key is drawn from the ENV and the endpoint from the gitignored MAP;
// the property asserts that a target working directory carrying decoy
// credentials contributes neither. Both decoys are derived from the real
// values so a leak would be unmistakable rather than coincidental.
test('property (invariant 2): credentials come from env and the map, never the working tree', async () => {
  const seen = { decoyPresent: 0 };
  await fc.assert(
    fc.asyncProperty(fc.string({ minLength: 1, maxLength: 20 }), async (decoySuffix) => {
      const decoyKey = `decoy-${decoySuffix}`;
      const root = mkTmpDir('sfvc-bl1383-inv2-');
      try {
        // A working tree stuffed with plausible credential sources.
        fs.mkdirSync(path.join(root, 'specs', 'features'), { recursive: true });
        fs.writeFileSync(path.join(root, '.env'), `FAKE_KEY=${decoyKey}\n`, 'utf8');
        fs.writeFileSync(path.join(root, 'specs', 'features', 'seat.feature'), `key ${decoyKey}\n`, 'utf8');
        fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
        fs.writeFileSync(path.join(root, '.swarmforge', 'swarm-identity'), `api_key\t${decoyKey}\n`, 'utf8');
        seen.decoyPresent += 1;

        writeMap(root, {
          [BOUND_TOPIC]: { model: 'glm-4', baseUrl: 'https://api.example.test', apiKeyEnv: 'FAKE_KEY' },
        });

        // The map supplies the endpoint; the env supplies the key.
        const seats = readProviderChatTopicSeats(root);
        assert.equal(seats[String(BOUND_TOPIC)].baseUrl, 'https://api.example.test');

        let sawKey;
        let sawUrl;
        const posted = [];
        await runProviderChatSeatTurn({
          targetPath: root,
          topicId: BOUND_TOPIC,
          text: 'hello',
          env: { FAKE_KEY: API_KEY },
          complete: async (_model, _prompt, baseUrl, apiKey) => {
            sawKey = apiKey;
            sawUrl = baseUrl;
            return 'ok';
          },
          post: async (topicId, message) => posted.push(message),
        });

        assert.equal(sawKey, API_KEY, 'the key did not come from the process environment');
        assert.notEqual(sawKey, decoyKey, 'a working-tree file supplied the credential');
        assert.equal(sawUrl, 'https://api.example.test', 'the endpoint did not come from the map');
        // And nothing the seat says carries either secret.
        for (const message of posted) {
          assert.doesNotMatch(message, new RegExp(API_KEY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
          assert.doesNotMatch(message, new RegExp(decoyKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 25 }
  );
  assert.ok(seen.decoyPresent >= 1, 'generator never planted a decoy credential');
});

test('property (invariant 2): the seat reads no credential when the env var is absent', async () => {
  const seen = { refused: 0 };
  await fc.assert(
    fc.asyncProperty(fc.string({ minLength: 1, maxLength: 20 }), async (decoySuffix) => {
      const decoyKey = `decoy-${decoySuffix}`;
      const root = mkTmpDir('sfvc-bl1383-inv2b-');
      try {
        fs.writeFileSync(path.join(root, '.env'), `FAKE_KEY=${decoyKey}\n`, 'utf8');
        writeMap(root, {
          [BOUND_TOPIC]: { model: 'glm-4', baseUrl: 'https://api.example.test', apiKeyEnv: 'FAKE_KEY' },
        });
        let called = 0;
        const posted = [];
        const outcome = await runProviderChatSeatTurn({
          targetPath: root,
          topicId: BOUND_TOPIC,
          text: 'hello',
          env: {},
          complete: async () => {
            called += 1;
            return 'ok';
          },
          post: async (_topicId, message) => posted.push(message),
        });
        seen.refused += 1;
        assert.equal(outcome.kind, 'refuse');
        assert.equal(called, 0, 'the provider was called with a credential from the working tree');
        for (const message of posted) {
          assert.doesNotMatch(message, new RegExp(decoyKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: 25 }
  );
  assert.ok(seen.refused >= 1, 'generator never reached the missing-key refusal');
});
