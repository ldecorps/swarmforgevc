const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkTmpDir } = require('./helpers/tmpDir');
const {
  decideProviderChatTurn,
  formatProviderChatAcknowledgement,
  formatProviderChatRefusal,
  seatForProviderChatTopic,
} = require('../out/tools/providerChatSeat');
const {
  chatCompletionsUrl,
  completeWithProviderChat,
  composeSwarmContextBlock,
  providerChatTopicMapPath,
  readProviderChatTopicSeats,
  runProviderChatSeatTurn,
} = require('../out/tools/providerChatSeatLive');

const SEAT = { model: 'glm-4', baseUrl: 'https://api.example.test', apiKeyEnv: 'FAKE_KEY' };
const SEATS = { 71550: SEAT };
const ENV = { FAKE_KEY: 'k-123' };

function withRoot(prefix, fn) {
  const root = mkTmpDir(prefix);
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeMap(root, mapping) {
  const p = providerChatTopicMapPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(mapping), 'utf8');
}

// ── the pure decision ────────────────────────────────────────────────────

describe('decideProviderChatTurn', () => {
  it('is not-mine for an unbound topic', () => {
    assert.equal(decideProviderChatTurn({ topicId: 900, topicSeats: SEATS, env: ENV }).kind, 'not-mine');
  });

  it('is not-mine when there is no topic at all', () => {
    assert.equal(decideProviderChatTurn({ topicId: undefined, topicSeats: SEATS, env: ENV }).kind, 'not-mine');
  });

  it('answers for a bound topic with its key present', () => {
    const turn = decideProviderChatTurn({ topicId: 71550, topicSeats: SEATS, env: ENV });
    assert.equal(turn.kind, 'answer');
    assert.equal(turn.modelId, 'glm-4');
    assert.equal(turn.apiKey, 'k-123');
  });

  it('refuses, naming the env var, when the key is absent', () => {
    const turn = decideProviderChatTurn({ topicId: 71550, topicSeats: SEATS, env: {} });
    assert.equal(turn.kind, 'refuse');
    assert.match(turn.reason, /FAKE_KEY/);
  });

  it('refuses an incomplete seat rather than half-calling a provider', () => {
    const turn = decideProviderChatTurn({
      topicId: 71550,
      topicSeats: { 71550: { model: '', baseUrl: '', apiKeyEnv: '' } },
      env: ENV,
    });
    assert.equal(turn.kind, 'refuse');
    assert.match(turn.reason, /incomplete/);
  });

  it('strips a trailing slash from the base url', () => {
    const turn = decideProviderChatTurn({
      topicId: 71550,
      topicSeats: { 71550: { ...SEAT, baseUrl: 'https://api.example.test///' } },
      env: ENV,
    });
    assert.equal(turn.baseUrl, 'https://api.example.test');
  });

  it('seatForProviderChatTopic keys on the topic id as a string', () => {
    assert.equal(seatForProviderChatTopic(SEATS, 71550).model, 'glm-4');
    assert.equal(seatForProviderChatTopic(SEATS, 900), undefined);
  });
});

describe('the posted texts name the model', () => {
  it('acknowledgement', () => {
    assert.match(formatProviderChatAcknowledgement('glm-4'), /glm-4/);
  });

  it('refusal carries the reason, not a bare code', () => {
    const text = formatProviderChatRefusal({ kind: 'refuse', reason: 'no key', modelId: 'glm-4' });
    assert.match(text, /glm-4/);
    assert.match(text, /no key/);
  });
});

// ── the map reader ───────────────────────────────────────────────────────

describe('readProviderChatTopicSeats', () => {
  it('reads well-formed seats', () => {
    withRoot('sfvc-bl1383-map-', (root) => {
      writeMap(root, { 71550: SEAT });
      // An absent systemPrompt comes back as an explicit `undefined` property
      // rather than a missing one, which JSON drops and nothing downstream
      // distinguishes - so the fields are compared, not the key set.
      const seats = readProviderChatTopicSeats(root);
      assert.deepEqual(Object.keys(seats), ['71550']);
      assert.equal(seats['71550'].model, SEAT.model);
      assert.equal(seats['71550'].baseUrl, SEAT.baseUrl);
      assert.equal(seats['71550'].apiKeyEnv, SEAT.apiKeyEnv);
      assert.equal(seats['71550'].systemPrompt, undefined);
    });
  });

  it('is empty when the map is absent', () => {
    withRoot('sfvc-bl1383-nomap-', (root) => {
      assert.deepEqual(readProviderChatTopicSeats(root), {});
    });
  });

  it('is empty for a corrupt map rather than throwing', () => {
    withRoot('sfvc-bl1383-badmap-', (root) => {
      const p = providerChatTopicMapPath(root);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, '{not json', 'utf8');
      assert.deepEqual(readProviderChatTopicSeats(root), {});
    });
  });

  it('drops a non-numeric topic key and an incomplete seat', () => {
    withRoot('sfvc-bl1383-partial-', (root) => {
      writeMap(root, { notATopic: SEAT, 900: { model: 'm' }, 71550: SEAT });
      assert.deepEqual(Object.keys(readProviderChatTopicSeats(root)), ['71550']);
    });
  });
});

// ── the endpoint ─────────────────────────────────────────────────────────

describe('chatCompletionsUrl', () => {
  it('appends the path to a bare root', () => {
    assert.equal(chatCompletionsUrl('https://api.deepseek.com'), 'https://api.deepseek.com/chat/completions');
  });

  it('appends the path to a /v1 root', () => {
    assert.equal(
      chatCompletionsUrl('https://integrate.api.nvidia.com/v1'),
      'https://integrate.api.nvidia.com/v1/chat/completions'
    );
  });

  it('leaves an endpoint that already names the path alone', () => {
    const full = 'https://x.test/v1/chat/completions';
    assert.equal(chatCompletionsUrl(full), full);
  });

  it('ignores trailing slashes', () => {
    assert.equal(chatCompletionsUrl('https://x.test///'), 'https://x.test/chat/completions');
  });
});

describe('completeWithProviderChat', () => {
  function fakeFetch(response, captured) {
    return async (url, init) => {
      captured.url = url;
      captured.init = init;
      return response;
    };
  }

  it('sends the bearer token and returns the reply text', async () => {
    const captured = {};
    const reply = await completeWithProviderChat(
      'glm-4',
      'hello',
      'https://x.test',
      'k-123',
      undefined,
      fakeFetch(
        { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: ' hi ' } }] }) },
        captured
      )
    );
    assert.equal(reply, 'hi');
    assert.equal(captured.init.headers.authorization, 'Bearer k-123');
    assert.deepEqual(JSON.parse(captured.init.body).messages, [{ role: 'user', content: 'hello' }]);
  });

  it('sends the system prompt first when there is one', async () => {
    const captured = {};
    await completeWithProviderChat(
      'glm-4',
      'hello',
      'https://x.test',
      'k',
      'be brief',
      fakeFetch(
        { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'x' } }] }) },
        captured
      )
    );
    assert.deepEqual(JSON.parse(captured.init.body).messages, [
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'hello' },
    ]);
  });

  // BL-572/BL-662: a failure shows the server's actual reason, never a bare
  // HTTP status.
  it('throws with the provider body, not just the status', async () => {
    await assert.rejects(
      () =>
        completeWithProviderChat(
          'glm-4',
          'hello',
          'https://x.test',
          'k',
          undefined,
          fakeFetch({ ok: false, status: 401, text: async () => 'invalid api key' }, {})
        ),
      /invalid api key/
    );
  });
});

// ── the swarm context block ──────────────────────────────────────────────

describe('composeSwarmContextBlock', () => {
  it('never throws on a bare directory, and says unknown instead', () => {
    withRoot('sfvc-bl1383-ctx-', (root) => {
      const block = composeSwarmContextBlock(root, '2026-09-05T00:00:00.000Z');
      assert.match(block, /unknown/);
      assert.match(block, /2026-09-05T00:00:00.000Z/);
    });
  });

  it('reports what it can read', () => {
    withRoot('sfvc-bl1383-ctx2-', (root) => {
      fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
      fs.writeFileSync(path.join(root, '.swarmforge', 'swarm-identity'), 'launch_pack\tfull-forge\n', 'utf8');
      fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
      fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-1-a.yaml'), 'id: BL-1\n', 'utf8');
      const block = composeSwarmContextBlock(root, '2026-09-05T00:00:00.000Z');
      assert.match(block, /full-forge/);
      assert.match(block, /backlog\/active: 1/);
    });
  });

  it('warns the model the snapshot may be stale rather than inviting invention', () => {
    withRoot('sfvc-bl1383-ctx3-', (root) => {
      assert.match(composeSwarmContextBlock(root), /stale/);
    });
  });
});

// ── the turn ─────────────────────────────────────────────────────────────

describe('runProviderChatSeatTurn', () => {
  function turnDeps(overrides) {
    const posted = [];
    return {
      posted,
      deps: {
        targetPath: '/nowhere',
        topicId: 71550,
        text: 'hello',
        env: ENV,
        topicSeats: SEATS,
        post: async (topicId, message) => posted.push({ topicId, message }),
        complete: async () => 'Hello from the seat',
        ...overrides,
      },
    };
  }

  it('is not-mine for an unbound topic and posts nothing', async () => {
    const { posted, deps } = turnDeps({ topicId: 900 });
    const outcome = await runProviderChatSeatTurn(deps);
    assert.equal(outcome.kind, 'not-mine');
    assert.deepEqual(posted, []);
  });

  it('never calls the provider for an unbound topic', async () => {
    let called = 0;
    const { deps } = turnDeps({ topicId: 900, complete: async () => (called += 1, 'x') });
    await runProviderChatSeatTurn(deps);
    assert.equal(called, 0);
  });

  it('acknowledges then answers in the bound topic', async () => {
    const { posted, deps } = turnDeps({});
    const outcome = await runProviderChatSeatTurn(deps);
    assert.equal(outcome.kind, 'answer');
    assert.equal(posted.length, 2);
    assert.match(posted[0].message, /glm-4/);
    assert.equal(posted[1].message, 'Hello from the seat');
    assert.ok(posted.every((p) => p.topicId === 71550));
  });

  it('reports the provider failure reason in the topic', async () => {
    const { posted, deps } = turnDeps({
      complete: async () => {
        throw new Error('https://x.test/chat/completions answered 401: invalid api key');
      },
    });
    const outcome = await runProviderChatSeatTurn(deps);
    assert.equal(outcome.kind, 'refuse');
    assert.match(posted[posted.length - 1].message, /invalid api key/);
  });

  it('reports a refused connection as its own reason', async () => {
    const { posted, deps } = turnDeps({
      complete: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:9');
      },
    });
    await runProviderChatSeatTurn(deps);
    assert.match(posted[posted.length - 1].message, /ECONNREFUSED/);
  });

  it('refuses when the seat key is missing, without calling the provider', async () => {
    let called = 0;
    const { posted, deps } = turnDeps({ env: {}, complete: async () => (called += 1, 'x') });
    const outcome = await runProviderChatSeatTurn(deps);
    assert.equal(outcome.kind, 'refuse');
    assert.equal(called, 0);
    assert.match(posted[0].message, /FAKE_KEY/);
  });

  it('says so when the provider returns an empty reply', async () => {
    const { posted, deps } = turnDeps({ complete: async () => '   ' });
    const outcome = await runProviderChatSeatTurn(deps);
    assert.equal(outcome.kind, 'refuse');
    assert.match(posted[posted.length - 1].message, /empty reply/);
  });

  it('never puts the api key in anything it posts', async () => {
    const { posted, deps } = turnDeps({
      complete: async () => {
        throw new Error('boom');
      },
    });
    await runProviderChatSeatTurn(deps);
    for (const p of posted) {
      assert.doesNotMatch(p.message, /k-123/);
    }
  });
});
