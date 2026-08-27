const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const {
  config,
  toWebhookRequest,
  parseSenderAllowlist,
  depsFromEnv,
  applyResponse,
  recertWebhookHandler,
} = require('../out/notify/recertWebhookVercelHandler');

// BL-225: built at runtime from an obviously-fake seed, not a committed
// whsec_ literal, mirroring recertInboundWebhook.test.js's own fixture.
const SECRET = 'whsec_' + Buffer.from('bl-288-fake-fixture-seed').toString('base64');
const NOW_ISO = '2026-07-09T12:00:00Z';
const FRESH_TIMESTAMP = String(Math.floor(Date.parse(NOW_ISO) / 1000));
const ALLOWED_SENDER = 'ops@example.com';

function sign(id, timestamp, rawBody, secret = SECRET) {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const sig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  return `v1,${sig}`;
}

function rawHeadersFor(rawBody, secret = SECRET, svixTimestamp = FRESH_TIMESTAMP) {
  const svixId = 'msg_1';
  return {
    'svix-id': svixId,
    'svix-timestamp': svixTimestamp,
    'svix-signature': sign(svixId, svixTimestamp, rawBody, secret),
    'content-type': 'application/json',
  };
}

function updateEmailPayload(scenarioId, newText, from = ALLOWED_SENDER) {
  return {
    type: 'email.received',
    data: {
      subject: `SwarmForge recert: update ${scenarioId}`,
      text: `scenario: ${scenarioId}\noutcome: update\n---\n${newText}`,
      from,
    },
  };
}

// A fake IncomingMessage: an EventEmitter that also carries .headers, so
// readRawBody's req.on('data'/'end') wiring and toWebhookRequest's
// req.headers read both work against the same object, mirroring how a real
// Node request behaves.
function fakeRequest(rawBody, headers) {
  const req = new EventEmitter();
  req.headers = headers;
  process.nextTick(() => {
    req.emit('data', Buffer.from(rawBody, 'utf8'));
    req.emit('end');
  });
  return req;
}

function fakeResponse() {
  return {
    statusCode: undefined,
    body: undefined,
    end(body) {
      this.body = body;
    },
  };
}

function baseEnv(overrides = {}) {
  return {
    RECERT_WEBHOOK_SECRET: SECRET,
    RECERT_SENDER_ALLOWLIST: ALLOWED_SENDER,
    RECERT_GITHUB_OWNER: 'ldecorps',
    RECERT_GITHUB_REPO: 'swarmforgevc',
    RECERT_GITHUB_BRANCH: 'main',
    RECERT_GITHUB_TOKEN: 'fake-token',
    ...overrides,
  };
}

// ── config ────────────────────────────────────────────────────────────────

test('config disables Vercel\'s automatic body parsing - the #1 serverless-Svix pitfall', () => {
  assert.equal(config.api.bodyParser, false);
});

// ── toWebhookRequest (pure) ──────────────────────────────────────────────

test('toWebhookRequest maps raw HTTP header names to the core\'s SvixHeaders shape', () => {
  const rawBody = JSON.stringify(updateEmailPayload('BL-288-demo-01', 'text'));
  const request = toWebhookRequest(rawBody, rawHeadersFor(rawBody));
  assert.deepEqual(request.headers, {
    svixId: 'msg_1',
    svixTimestamp: FRESH_TIMESTAMP,
    svixSignature: sign('msg_1', FRESH_TIMESTAMP, rawBody),
  });
});

// BL-288 recert-handler-03
test('recert-handler-03: toWebhookRequest carries the exact raw body bytes, never a re-serialized copy', () => {
  // Reformatting this exact string via JSON.parse+JSON.stringify changes it
  // (1.50 -> 1.5), so this fixture actually proves the distinction, not
  // just asserts a tautology.
  const rawBody = '{"type":"email.received","data":{"subject":"S","text":"B","from":"ops@example.com"},"extra":1.50}';
  assert.notEqual(JSON.stringify(JSON.parse(rawBody)), rawBody, 'fixture must be reparse-sensitive to be a meaningful guard');

  const request = toWebhookRequest(rawBody, rawHeadersFor(rawBody));
  assert.equal(request.rawBody, rawBody);

  // The signature was computed over the ORIGINAL rawBody - verifying against
  // a reparsed/reserialized copy must fail, proving raw-byte fidelity
  // actually matters end to end, not just at the mapping function.
  const { verifySvixSignature } = require('../out/notify/svixSignature');
  assert.equal(verifySvixSignature(request.headers, request.rawBody, SECRET), true);
  assert.equal(verifySvixSignature(request.headers, JSON.stringify(JSON.parse(rawBody)), SECRET), false);
});

test('toWebhookRequest tolerates missing svix headers rather than throwing', () => {
  const request = toWebhookRequest('{}', {});
  assert.deepEqual(request.headers, { svixId: '', svixTimestamp: '', svixSignature: '' });
});

// ── parseSenderAllowlist (pure) ──────────────────────────────────────────

test('parseSenderAllowlist splits, trims, and drops empties from a comma-separated env value', () => {
  assert.deepEqual(parseSenderAllowlist(' ops@example.com , other@example.com ,,'), ['ops@example.com', 'other@example.com']);
});

test('parseSenderAllowlist returns [] for an absent env value (fails closed via the core)', () => {
  assert.deepEqual(parseSenderAllowlist(undefined), []);
  assert.deepEqual(parseSenderAllowlist(''), []);
});

// ── depsFromEnv (pure assembly) ──────────────────────────────────────────

test('depsFromEnv assembles secret/nowIso/senderAllowlist/log straight from env', () => {
  const logged = [];
  const deps = depsFromEnv({ env: baseEnv(), nowIso: NOW_ISO, log: (m) => logged.push(m) });
  assert.equal(deps.secret, SECRET);
  assert.equal(deps.nowIso, NOW_ISO);
  assert.deepEqual(deps.senderAllowlist, [ALLOWED_SENDER]);
  deps.log('hi');
  assert.deepEqual(logged, ['hi']);
});

test('depsFromEnv with no RECERT_WEBHOOK_SECRET set yields an empty secret (recert-handler-04)', () => {
  const env = baseEnv();
  delete env.RECERT_WEBHOOK_SECRET;
  const deps = depsFromEnv({ env, nowIso: NOW_ISO, log: () => {} });
  assert.equal(deps.secret, '');
});

test('depsFromEnv wires commitProposal to the injected putFn, never a real network call, carrying the assembled repo config', async () => {
  const calls = [];
  const fakePutFn = async (url, body, token) => {
    calls.push({ url, body, token });
    return { ok: true, status: 200 };
  };
  const deps = depsFromEnv({ env: baseEnv(), nowIso: NOW_ISO, log: () => {}, putFn: fakePutFn });
  await deps.commitProposal({ scenarioId: 'BL-288-demo-02', outcome: 'update', newText: 'x', receivedAtIso: NOW_ISO });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/repos/ldecorps/swarmforgevc/contents/backlog/recert-inbox/BL-288-demo-02-2026-07-09T12-00-00-000Z.json');
  assert.equal(calls[0].token, 'fake-token');
});

test('depsFromEnv defaults RECERT_GITHUB_BRANCH to "main" when unset', async () => {
  const env = baseEnv();
  delete env.RECERT_GITHUB_BRANCH;
  const calls = [];
  const deps = depsFromEnv({
    env,
    nowIso: NOW_ISO,
    log: () => {},
    putFn: async (url, body) => {
      calls.push(JSON.parse(body).branch);
      return { ok: true, status: 200 };
    },
  });
  await deps.commitProposal({ scenarioId: 'BL-288-demo-03', outcome: 'delete', receivedAtIso: NOW_ISO });
  assert.deepEqual(calls, ['main']);
});

// ── applyResponse (pure-ish, trivial) ────────────────────────────────────

test('applyResponse writes the core\'s status and body straight onto the platform response', () => {
  const res = fakeResponse();
  applyResponse(res, { status: 403, body: 'sender not allowed' });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body, 'sender not allowed');
});

// ── recertWebhookHandler (integration, fake req/res + fixture env) ──────

// BL-288 recert-handler-01
test('recert-handler-01: a signed inbound email from an allowed sender commits a recert proposal', async () => {
  const rawBody = JSON.stringify(updateEmailPayload('BL-288-demo-04', 'the new scenario text'));
  const req = fakeRequest(rawBody, rawHeadersFor(rawBody));
  const res = fakeResponse();
  const calls = [];
  const originalEnv = process.env;
  process.env = { ...originalEnv, ...baseEnv() };
  try {
    // depsFromEnv inside recertWebhookHandler always builds a real
    // commitProposal via the real network putFn default - to keep this
    // integration test network-free while still exercising the FULL
    // handler (not a hand-assembled deps object), stub the module-level
    // defaultPut the same way recertProposalRepoCommit.test.js's own
    // fixtures avoid a real network call: monkeypatch global fetch.
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      calls.push({ url, body: opts.body });
      return { ok: true, status: 201 };
    };
    try {
      await recertWebhookHandler(req, res, NOW_ISO);
    } finally {
      global.fetch = originalFetch;
    }
  } finally {
    process.env = originalEnv;
  }
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'proposal committed');
  assert.equal(calls.length, 1);
  assert.match(calls[0].body, /BL-288-demo-04/);
});

// BL-288 recert-handler-02
test('recert-handler-02: a POST with no valid signature commits nothing and is rejected', async () => {
  const rawBody = JSON.stringify(updateEmailPayload('BL-288-demo-05', 'x'));
  const wrongSecret = 'whsec_' + Buffer.from('wrong').toString('base64');
  const req = fakeRequest(rawBody, rawHeadersFor(rawBody, wrongSecret));
  const res = fakeResponse();
  const originalEnv = process.env;
  process.env = { ...originalEnv, ...baseEnv() };
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('must never be called - no valid signature means no commit');
  };
  try {
    await recertWebhookHandler(req, res, NOW_ISO);
  } finally {
    process.env = originalEnv;
    global.fetch = originalFetch;
  }
  assert.equal(res.statusCode, 401);
});

// BL-288 recert-handler-04
test('recert-handler-04: with no signing secret in the environment the handler commits nothing', async () => {
  const rawBody = JSON.stringify(updateEmailPayload('BL-288-demo-06', 'x'));
  const req = fakeRequest(rawBody, rawHeadersFor(rawBody));
  const res = fakeResponse();
  const env = baseEnv();
  delete env.RECERT_WEBHOOK_SECRET;
  const originalEnv = process.env;
  process.env = { ...originalEnv, ...env, RECERT_WEBHOOK_SECRET: '' };
  delete process.env.RECERT_WEBHOOK_SECRET;
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('must never be called - no secret means no commit');
  };
  try {
    await recertWebhookHandler(req, res, NOW_ISO);
  } finally {
    process.env = originalEnv;
    global.fetch = originalFetch;
  }
  assert.equal(res.statusCode, 401);
});

// BL-288 recert-handler-05
test('recert-handler-05: the core\'s status and body become the HTTP response, for a non-happy-path outcome too', async () => {
  const rawBody = JSON.stringify(updateEmailPayload('BL-288-demo-07', 'x', 'evil@example.com'));
  const req = fakeRequest(rawBody, rawHeadersFor(rawBody));
  const res = fakeResponse();
  const originalEnv = process.env;
  process.env = { ...originalEnv, ...baseEnv() };
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('must never be called - a non-allowlisted sender never reaches commit');
  };
  try {
    await recertWebhookHandler(req, res, NOW_ISO);
  } finally {
    process.env = originalEnv;
    global.fetch = originalFetch;
  }
  assert.equal(res.statusCode, 403);
  assert.equal(res.body, 'sender not allowed');
});
