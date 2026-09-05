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
  countBacklogYaml,
  providerChatTopicMapPath,
  readProviderChatTopicSeats,
  readSwarmIdentity,
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

  // BL-1383 hardening: an undefined topicId must never be conflated with the
  // literal string key "undefined" that String(undefined) would produce.
  it('never conflates an undefined topic id with the literal string "undefined" key', () => {
    assert.equal(seatForProviderChatTopic({ undefined: SEAT }, undefined), undefined);
  });

  it('trims whitespace from model, baseUrl, and apiKeyEnv before use', () => {
    const turn = decideProviderChatTurn({
      topicId: 71550,
      topicSeats: { 71550: { model: '  glm-4  ', baseUrl: '  https://api.example.test  ', apiKeyEnv: '  FAKE_KEY  ' } },
      env: ENV,
    });
    assert.equal(turn.kind, 'answer');
    assert.equal(turn.modelId, 'glm-4');
    assert.equal(turn.baseUrl, 'https://api.example.test');
    assert.equal(turn.apiKey, 'k-123');
  });

  it('refuses when the seat config omits fields entirely (undefined), not just empty strings', () => {
    const turn = decideProviderChatTurn({ topicId: 71550, topicSeats: { 71550: {} }, env: ENV });
    assert.equal(turn.kind, 'refuse');
    assert.equal(turn.modelId, '(unset)');
  });

  it('refuses when ONLY baseUrl is missing, still naming the real model in the refusal', () => {
    const turn = decideProviderChatTurn({
      topicId: 71550,
      topicSeats: { 71550: { model: 'glm-4', baseUrl: '', apiKeyEnv: 'FAKE_KEY' } },
      env: ENV,
    });
    assert.equal(turn.kind, 'refuse');
    assert.equal(turn.modelId, 'glm-4');
  });

  it('refuses when ONLY apiKeyEnv is missing', () => {
    const turn = decideProviderChatTurn({
      topicId: 71550,
      topicSeats: { 71550: { model: 'glm-4', baseUrl: 'https://x.test', apiKeyEnv: '' } },
      env: ENV,
    });
    assert.equal(turn.kind, 'refuse');
  });

  // The two above use an explicit '' - nullish-coalescing (??) never even
  // fires for an explicit empty string. These isolate the OMITTED-key case
  // (undefined, not '') that the ?? fallback actually exists for.
  it('refuses when ONLY baseUrl is omitted entirely (key absent, not empty)', () => {
    const turn = decideProviderChatTurn({
      topicId: 71550,
      topicSeats: { 71550: { model: 'glm-4', apiKeyEnv: 'FAKE_KEY' } },
      env: ENV,
    });
    assert.equal(turn.kind, 'refuse');
    assert.equal(turn.modelId, 'glm-4');
  });

  it('refuses when ONLY apiKeyEnv is omitted entirely (key absent, not empty)', () => {
    const turn = decideProviderChatTurn({
      topicId: 71550,
      topicSeats: { 71550: { model: 'glm-4', baseUrl: 'https://x.test' } },
      env: ENV,
    });
    assert.equal(turn.kind, 'refuse');
    // The REASON, not just the kind: an omitted apiKeyEnv must be caught by
    // the seat-completeness guard ("incomplete") - if that guard's ??
    // fallback ever stopped being falsy, apiKeyEnv would resolve to some
    // truthy placeholder instead, slip past THIS guard, and only be caught
    // later by the separate "key not set in env" guard, which names a
    // different (and here nonsensical) env-var reason instead.
    assert.match(turn.reason, /incomplete/);
  });

  it('refuses when ONLY model is missing', () => {
    const turn = decideProviderChatTurn({
      topicId: 71550,
      topicSeats: { 71550: { model: '', baseUrl: 'https://x.test', apiKeyEnv: 'FAKE_KEY' } },
      env: ENV,
    });
    assert.equal(turn.kind, 'refuse');
    assert.equal(turn.modelId, '(unset)');
  });

  it('trims whitespace from the resolved api key', () => {
    const turn = decideProviderChatTurn({ topicId: 71550, topicSeats: SEATS, env: { FAKE_KEY: '  k-123  ' } });
    assert.equal(turn.apiKey, 'k-123');
  });

  it('carries no systemPrompt when the seat has none (undefined, not the string "undefined")', () => {
    const turn = decideProviderChatTurn({ topicId: 71550, topicSeats: SEATS, env: ENV });
    assert.equal(turn.kind, 'answer');
    assert.equal(turn.systemPrompt, undefined);
  });

  it('carries an explicit empty systemPrompt as an empty string, not undefined', () => {
    const turn = decideProviderChatTurn({
      topicId: 71550,
      topicSeats: { 71550: { ...SEAT, systemPrompt: '' } },
      env: ENV,
    });
    assert.equal(turn.kind, 'answer');
    assert.equal(turn.systemPrompt, '');
  });

  it('providerChatTopicMapPath resolves the exact three-segment path', () => {
    assert.equal(
      providerChatTopicMapPath('/x'),
      path.join('/x', '.swarmforge', 'operator', 'provider-chat-topic-map.json')
    );
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

  // BL-1383 hardening: a topic id that fails the exact numeric test in
  // either direction (a leading or a trailing non-digit) must still be
  // dropped - each fixture below isolates one direction.
  it('drops a topic key with a trailing non-digit (letters after the digits)', () => {
    withRoot('sfvc-bl1383-trail-', (root) => {
      writeMap(root, { '123abc': SEAT, 71550: SEAT });
      assert.deepEqual(Object.keys(readProviderChatTopicSeats(root)), ['71550']);
    });
  });

  it('drops a topic key with a leading non-digit (letters before the digits)', () => {
    withRoot('sfvc-bl1383-lead-', (root) => {
      writeMap(root, { a123: SEAT, 71550: SEAT });
      assert.deepEqual(Object.keys(readProviderChatTopicSeats(root)), ['71550']);
    });
  });

  it('drops a seat value that is null or not an object, keeping a valid sibling seat', () => {
    withRoot('sfvc-bl1383-nullseat-', (root) => {
      writeMap(root, { 900: null, 800: 'not-an-object', 71550: SEAT });
      assert.deepEqual(Object.keys(readProviderChatTopicSeats(root)), ['71550']);
    });
  });

  it('drops a raw seat missing ONLY baseUrl (model+apiKeyEnv present)', () => {
    withRoot('sfvc-bl1383-missbase-', (root) => {
      writeMap(root, { 71550: { model: 'glm-4', apiKeyEnv: 'FAKE_KEY' } });
      assert.deepEqual(readProviderChatTopicSeats(root), {});
    });
  });

  it('drops a raw seat missing ONLY apiKeyEnv (model+baseUrl present)', () => {
    withRoot('sfvc-bl1383-missapikeyenv-', (root) => {
      writeMap(root, { 71550: { model: 'glm-4', baseUrl: 'https://x.test' } });
      assert.deepEqual(readProviderChatTopicSeats(root), {});
    });
  });

  it('drops a raw seat missing ONLY model (baseUrl+apiKeyEnv present)', () => {
    withRoot('sfvc-bl1383-missmodel-', (root) => {
      writeMap(root, { 71550: { baseUrl: 'https://x.test', apiKeyEnv: 'FAKE_KEY' } });
      assert.deepEqual(readProviderChatTopicSeats(root), {});
    });
  });

  it("trims whitespace from a raw seat's model/baseUrl/apiKeyEnv on read", () => {
    withRoot('sfvc-bl1383-trim-', (root) => {
      writeMap(root, { 71550: { model: '  glm-4  ', baseUrl: '  https://x.test  ', apiKeyEnv: '  FAKE_KEY  ' } });
      const seats = readProviderChatTopicSeats(root);
      assert.equal(seats['71550'].model, 'glm-4');
      assert.equal(seats['71550'].baseUrl, 'https://x.test');
      assert.equal(seats['71550'].apiKeyEnv, 'FAKE_KEY');
    });
  });

  it('drops a whitespace-only systemPrompt as absent, not as a blank string', () => {
    withRoot('sfvc-bl1383-wsprompt-', (root) => {
      writeMap(root, { 71550: { ...SEAT, systemPrompt: '   ' } });
      assert.equal(readProviderChatTopicSeats(root)['71550'].systemPrompt, undefined);
    });
  });

  it('keeps a genuine systemPrompt exactly as written, untrimmed', () => {
    withRoot('sfvc-bl1383-realprompt-', (root) => {
      writeMap(root, { 71550: { ...SEAT, systemPrompt: '  be terse  ' } });
      assert.equal(readProviderChatTopicSeats(root)['71550'].systemPrompt, '  be terse  ');
    });
  });
});

describe('readSwarmIdentity', () => {
  it('parses tab-separated key/value lines', () => {
    withRoot('sfvc-bl1383-ident-', (root) => {
      fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
      fs.writeFileSync(path.join(root, '.swarmforge', 'swarm-identity'), 'launch_pack\tfull-forge\nrotation\tnight\n', 'utf8');
      assert.deepEqual(readSwarmIdentity(root), { launch_pack: 'full-forge', rotation: 'night' });
    });
  });

  it('skips a line with no tab at all, rather than misparsing it into a bogus key', () => {
    withRoot('sfvc-bl1383-ident2-', (root) => {
      fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
      fs.writeFileSync(
        path.join(root, '.swarmforge', 'swarm-identity'),
        'garbage line with no tab\nlaunch_pack\tfull-forge\n',
        'utf8'
      );
      assert.deepEqual(readSwarmIdentity(root), { launch_pack: 'full-forge' });
    });
  });

  it('is empty (never throws) when the file is absent', () => {
    withRoot('sfvc-bl1383-ident3-', (root) => {
      assert.deepEqual(readSwarmIdentity(root), {});
    });
  });

  it('splits exactly at the FIRST tab (a single-char key), keeping later tabs in the value', () => {
    withRoot('sfvc-bl1383-ident4-', (root) => {
      fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
      fs.writeFileSync(path.join(root, '.swarmforge', 'swarm-identity'), 'k\tv1\tv2\n', 'utf8');
      assert.deepEqual(readSwarmIdentity(root), { k: 'v1\tv2' });
    });
  });
});

describe('countBacklogYaml', () => {
  it('counts only .yaml files in the given backlog folder', () => {
    withRoot('sfvc-bl1383-cby-', (root) => {
      fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
      fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-1.yaml'), '', 'utf8');
      fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-2.yaml'), '', 'utf8');
      fs.writeFileSync(path.join(root, 'backlog', 'active', 'README.md'), '', 'utf8');
      assert.equal(countBacklogYaml(root, 'active'), 2);
    });
  });

  it('is undefined (never throws) when the folder is absent', () => {
    withRoot('sfvc-bl1383-cby2-', (root) => {
      assert.equal(countBacklogYaml(root, 'active'), undefined);
    });
  });

  it('reads the named folder, not a different one', () => {
    withRoot('sfvc-bl1383-cby3-', (root) => {
      fs.mkdirSync(path.join(root, 'backlog', 'paused'), { recursive: true });
      fs.writeFileSync(path.join(root, 'backlog', 'paused', 'BL-9.yaml'), '', 'utf8');
      assert.equal(countBacklogYaml(root, 'paused'), 1);
      assert.equal(countBacklogYaml(root, 'active'), undefined);
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

  it('does not mistake a mid-path chat/completions for a trailing one', () => {
    assert.equal(
      chatCompletionsUrl('https://x.test/chat/completions/extra'),
      'https://x.test/chat/completions/extra/chat/completions'
    );
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
    assert.equal(captured.init.method, 'POST');
    assert.equal(captured.init.headers['content-type'], 'application/json');
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
  // HTTP status. Anchored to the exact message shape (not a bare substring
  // match) - a plain /invalid api key/ regex would ALSO match the unrelated
  // SyntaxError JSON.parse throws on this same non-JSON body text (its own
  // message quotes the offending input verbatim), so a substring-only check
  // cannot tell "we threw on purpose" from "JSON.parse blew up by accident".
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
      (err) => {
        assert.equal(err.message, 'https://x.test/chat/completions answered 401: invalid api key');
        return true;
      }
    );
  });

  it('trims the body and caps it at 300 chars in the failure message', async () => {
    const body = `  ${'x'.repeat(310)}  `;
    await assert.rejects(
      () =>
        completeWithProviderChat(
          'glm-4',
          'hello',
          'https://x.test',
          'k',
          undefined,
          fakeFetch({ ok: false, status: 500, text: async () => body }, {})
        ),
      (err) => {
        assert.equal(err.message, `https://x.test/chat/completions answered 500: ${'x'.repeat(300)}`);
        return true;
      }
    );
  });

  it('returns an empty string, never throwing, when the response has no choices field at all', async () => {
    const reply = await completeWithProviderChat(
      'glm-4',
      'hi',
      'https://x.test',
      'k',
      undefined,
      fakeFetch({ ok: true, status: 200, text: async () => JSON.stringify({}) }, {})
    );
    assert.equal(reply, '');
  });

  it('returns an empty string, never throwing, when choices is an empty array', async () => {
    const reply = await completeWithProviderChat(
      'glm-4',
      'hi',
      'https://x.test',
      'k',
      undefined,
      fakeFetch({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [] }) }, {})
    );
    assert.equal(reply, '');
  });

  it('returns an empty string, never throwing, when the first choice has no message field', async () => {
    const reply = await completeWithProviderChat(
      'glm-4',
      'hi',
      'https://x.test',
      'k',
      undefined,
      fakeFetch({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{}] }) }, {})
    );
    assert.equal(reply, '');
  });
});

// ── the swarm context block ──────────────────────────────────────────────

describe('composeSwarmContextBlock', () => {
  it('never throws on a bare directory, and says unknown instead', () => {
    withRoot('sfvc-bl1383-ctx-', (root) => {
      const block = composeSwarmContextBlock(root, '2026-09-05T00:00:00.000Z');
      assert.match(block, /unknown/);
      assert.match(block, /2026-09-05T00:00:00.000Z/);
      // Precise per-field fallback text, not just "unknown appears somewhere" -
      // each of these lines has its OWN fallback literal and its own optional
      // rotation suffix, and a bare directory exercises every one of them.
      assert.match(block, /launch pack: unknown\n/);
      assert.match(block, /active backlog depth cap: unknown\n/);
      assert.match(block, /tickets in backlog\/active: unknown, paused: unknown\n/);
    });
  });

  it('reports what it can read, including an optional rotation suffix and the depth cap', () => {
    withRoot('sfvc-bl1383-ctx2-', (root) => {
      fs.mkdirSync(path.join(root, '.swarmforge'), { recursive: true });
      fs.writeFileSync(
        path.join(root, '.swarmforge', 'swarm-identity'),
        'launch_pack\tfull-forge\nrotation\tnight\nactive_backlog_max_depth\t3\n',
        'utf8'
      );
      fs.mkdirSync(path.join(root, 'backlog', 'active'), { recursive: true });
      fs.writeFileSync(path.join(root, 'backlog', 'active', 'BL-1-a.yaml'), 'id: BL-1\n', 'utf8');
      const block = composeSwarmContextBlock(root, '2026-09-05T00:00:00.000Z');
      assert.match(block, /- launch pack: full-forge \(rotation: night\)\n/);
      assert.match(block, /active backlog depth cap: 3\n/);
      assert.match(block, /backlog\/active: 1, paused: unknown\n/);
    });
  });

  it('warns the model the snapshot may be stale rather than inviting invention', () => {
    withRoot('sfvc-bl1383-ctx3-', (root) => {
      assert.match(composeSwarmContextBlock(root), /stale/);
    });
  });

  it('joins the snapshot lines with real newlines, not run together', () => {
    withRoot('sfvc-bl1383-ctx4-', (root) => {
      const block = composeSwarmContextBlock(root, '2026-09-05T00:00:00.000Z');
      assert.ok(block.split('\n').length >= 5, `expected multiple newline-separated lines, got: ${block}`);
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
    assert.deepEqual(outcome.posted, []);
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

  // BL-1383 hardening: the system prompt sent to the provider composes the
  // seat's own prompt with a live swarm-context block, joined by a blank
  // line - and the seat prompt must be OMITTED (not left as an empty/blank
  // leading line) when the seat has none.
  it("composes the system prompt from the seat's own prompt plus the swarm-context block, joined by a blank line", async () => {
    let capturedSystemPrompt;
    const { deps } = turnDeps({
      topicSeats: { 71550: { ...SEAT, systemPrompt: 'be terse' } },
      complete: async (modelId, prompt, baseUrl, apiKey, systemPrompt) => {
        capturedSystemPrompt = systemPrompt;
        return 'ok';
      },
    });
    await runProviderChatSeatTurn(deps);
    assert.ok(capturedSystemPrompt.startsWith('be terse\n\n'));
    assert.match(capturedSystemPrompt, /Live snapshot/);
  });

  it('omits the seat prompt from the system prompt when the seat has none - no leading blank-line join', async () => {
    let capturedSystemPrompt;
    const { deps } = turnDeps({
      complete: async (modelId, prompt, baseUrl, apiKey, systemPrompt) => {
        capturedSystemPrompt = systemPrompt;
        return 'ok';
      },
    });
    await runProviderChatSeatTurn(deps);
    assert.ok(!capturedSystemPrompt.startsWith('\n\n'), `must not lead with a blank-line join: ${capturedSystemPrompt}`);
    assert.match(capturedSystemPrompt, /Live snapshot/);
  });

  it('filters a whitespace-only seat prompt out of the composed system prompt', async () => {
    let capturedSystemPrompt;
    const { deps } = turnDeps({
      topicSeats: { 71550: { ...SEAT, systemPrompt: '   ' } },
      complete: async (modelId, prompt, baseUrl, apiKey, systemPrompt) => {
        capturedSystemPrompt = systemPrompt;
        return 'ok';
      },
    });
    await runProviderChatSeatTurn(deps);
    assert.ok(
      !capturedSystemPrompt.startsWith('   \n\n'),
      `a whitespace-only seat prompt must not survive the filter: ${capturedSystemPrompt}`
    );
    assert.match(capturedSystemPrompt, /Live snapshot/);
  });
});
