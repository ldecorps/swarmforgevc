const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { extractEmailFields, isSenderAllowed, handleInboundEmailWebhook } = require('../out/notify/recertInboundWebhook');

// BL-225: built at runtime from an obviously-fake seed, not a committed
// whsec_ literal (GitGuardian flagged the fixed literal across history as
// a "Stripe Webhook Secret" false positive - whsec_ is shared by Svix and
// Stripe). Still base64-decodes to real HMAC bytes, same as before.
const SECRET = 'whsec_' + Buffer.from('bl-225-fake-fixture-seed').toString('base64');
const NOW_ISO = '2026-07-09T12:00:00Z';
const FRESH_TIMESTAMP = String(Math.floor(Date.parse(NOW_ISO) / 1000));

function sign(id, timestamp, rawBody, secret = SECRET) {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const sig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  return `v1,${sig}`;
}

function requestForRawBody(rawBody, secret = SECRET, svixTimestamp = FRESH_TIMESTAMP) {
  const svixId = 'msg_1';
  return {
    headers: { svixId, svixTimestamp, svixSignature: sign(svixId, svixTimestamp, rawBody, secret) },
    rawBody,
  };
}

function requestFor(payloadObj, secret = SECRET) {
  return requestForRawBody(JSON.stringify(payloadObj), secret);
}

const ALLOWED_SENDER = 'ops@example.com';

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

// ── extractEmailFields ─────────────────────────────────────────────────────

test('extractEmailFields reads subject/text/from out of the {type, data} envelope', () => {
  const fields = extractEmailFields(updateEmailPayload('BL-042-demo-01', 'new text'));
  assert.deepEqual(fields, {
    subject: 'SwarmForge recert: update BL-042-demo-01',
    body: 'scenario: BL-042-demo-01\noutcome: update\n---\nnew text',
    from: ALLOWED_SENDER,
  });
});

test('extractEmailFields omits "from" entirely (not null/undefined key) when the envelope carries no sender', () => {
  const fields = extractEmailFields({ type: 'email.received', data: { subject: 'S', text: 'B' } });
  assert.deepEqual(fields, { subject: 'S', body: 'B' });
  assert.equal('from' in fields, false);
});

test('extractEmailFields returns null for a payload with no data.subject/text', () => {
  assert.equal(extractEmailFields({ type: 'email.sent', data: {} }), null);
});

test('extractEmailFields returns null for non-object input', () => {
  assert.equal(extractEmailFields(null), null);
  assert.equal(extractEmailFields('not an object'), null);
});

// ── isSenderAllowed (BL-248, pure) ──────────────────────────────────────────

test('isSenderAllowed accepts an exact match on the allowlist', () => {
  assert.equal(isSenderAllowed('ops@example.com', ['ops@example.com']), true);
});

// BL-248 sender-match-case-insensitive-03
test('isSenderAllowed matches case-insensitively', () => {
  assert.equal(isSenderAllowed('OPS@Example.com', ['ops@example.com']), true);
  assert.equal(isSenderAllowed('ops@example.com', ['OPS@EXAMPLE.COM']), true);
});

test('isSenderAllowed rejects a sender not on the allowlist', () => {
  assert.equal(isSenderAllowed('evil@example.com', ['ops@example.com']), false);
});

// BL-248 empty-allowlist-fail-closed-04
test('isSenderAllowed fails closed: an empty allowlist rejects every sender', () => {
  assert.equal(isSenderAllowed('ops@example.com', []), false);
});

test('isSenderAllowed fails closed: a missing/undefined allowlist rejects every sender', () => {
  assert.equal(isSenderAllowed('ops@example.com', undefined), false);
});

test('isSenderAllowed rejects a missing sender even against a non-empty allowlist', () => {
  assert.equal(isSenderAllowed(undefined, ['ops@example.com']), false);
});

// ── handleInboundEmailWebhook ──────────────────────────────────────────────

async function run(payloadObj, deps = {}) {
  const request = requestFor(payloadObj, deps.secretForSigning);
  const committed = [];
  const logged = [];
  const result = await handleInboundEmailWebhook(request, {
    secret: SECRET,
    nowIso: NOW_ISO,
    senderAllowlist: [ALLOWED_SENDER],
    commitProposal: async (proposal) => {
      committed.push(proposal);
    },
    log: (message) => logged.push(message),
    ...deps,
  });
  return { result, committed, logged };
}

test('webhook-01: a validly signed update email commits exactly one proposal carrying scenario id, outcome, and new text', async () => {
  const { result, committed, logged } = await run(updateEmailPayload('BL-042-demo-01', 'the new scenario text'));
  assert.equal(result.status, 200);
  assert.equal(committed.length, 1);
  assert.deepEqual(committed[0], {
    scenarioId: 'BL-042-demo-01',
    outcome: 'update',
    newText: 'the new scenario text',
    receivedAtIso: '2026-07-09T12:00:00Z',
  });
  assert.deepEqual(logged, []);
});

test('a validly signed but non-JSON request body produces no proposal and logs without crashing', async () => {
  const request = requestForRawBody('not json at all');
  const logged = [];
  const result = await handleInboundEmailWebhook(request, {
    secret: SECRET,
    nowIso: NOW_ISO,
    senderAllowlist: [ALLOWED_SENDER],
    commitProposal: async () => {
      throw new Error('must not be called');
    },
    log: (message) => logged.push(message),
  });
  assert.equal(result.status, 200);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /not valid JSON/);
});

test('webhook-02: an unsigned/forged request is rejected with no proposal committed', async () => {
  const { result, committed } = await run(updateEmailPayload('BL-042-demo-01', 'x'), { secretForSigning: 'whsec_' + Buffer.from('wrong').toString('base64') });
  assert.equal(result.status, 401);
  assert.equal(committed.length, 0);
});

// ── BL-248: sender allowlist ─────────────────────────────────────────────

// BL-248 allowlisted-sender-commits-01
test('a valid recert email from an allowlisted sender still commits a proposal', async () => {
  const { result, committed, logged } = await run(
    updateEmailPayload('BL-248-demo-01', 'text', ALLOWED_SENDER),
    { senderAllowlist: [ALLOWED_SENDER] }
  );
  assert.equal(result.status, 200);
  assert.equal(committed.length, 1);
  assert.deepEqual(logged, []);
});

// BL-248 non-allowlisted-rejected-02
test('a recert email from a non-allowlisted sender is rejected: no proposal committed, rejection logged', async () => {
  const { result, committed, logged } = await run(
    updateEmailPayload('BL-248-demo-02', 'text', 'evil@example.com'),
    { senderAllowlist: [ALLOWED_SENDER] }
  );
  assert.equal(result.status, 403);
  assert.equal(committed.length, 0);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /rejected sender/);
  assert.match(logged[0], /evil@example\.com/);
});

// BL-248 sender-match-case-insensitive-03
for (const [sender, shouldCommit] of [
  [ALLOWED_SENDER, true],
  ['OPS@Example.com', true],
  ['evil@example.com', false],
]) {
  test(`sender matching is case-insensitive: "${sender}" against allowlist ["${ALLOWED_SENDER}"] -> ${shouldCommit ? 'committed' : 'not committed'}`, async () => {
    const { committed } = await run(updateEmailPayload('BL-248-demo-03', 'text', sender), { senderAllowlist: [ALLOWED_SENDER] });
    assert.equal(committed.length, shouldCommit ? 1 : 0);
  });
}

// BL-248 empty-allowlist-fail-closed-04
test('an empty allowlist rejects every sender (fail closed), even one that would otherwise be reasonable', async () => {
  const { result, committed } = await run(updateEmailPayload('BL-248-demo-04', 'text', ALLOWED_SENDER), { senderAllowlist: [] });
  assert.equal(result.status, 403);
  assert.equal(committed.length, 0);
});

test('a missing (undefined) allowlist rejects every sender (fail closed)', async () => {
  const { result, committed } = await run(updateEmailPayload('BL-248-demo-04b', 'text', ALLOWED_SENDER), { senderAllowlist: undefined });
  assert.equal(result.status, 403);
  assert.equal(committed.length, 0);
});

// BL-248 regression: auth still runs BEFORE the allowlist check - a
// bad-signature/stale request from an ALLOWLISTED sender must still be
// rejected at 401, never reaching (or needing) the allowlist at all.
test('regression: a bad-signature request from an allowlisted sender is still rejected at auth, before any allowlist check', async () => {
  const { result, committed } = await run(
    updateEmailPayload('BL-248-demo-05', 'x', ALLOWED_SENDER),
    { secretForSigning: 'whsec_' + Buffer.from('wrong').toString('base64'), senderAllowlist: [ALLOWED_SENDER] }
  );
  assert.equal(result.status, 401);
  assert.equal(committed.length, 0);
});

test('regression: a stale/replayed request from an allowlisted sender is still rejected at auth, before any allowlist check', async () => {
  const rawBody = JSON.stringify(updateEmailPayload('BL-248-demo-06', 'x', ALLOWED_SENDER));
  const request = requestForRawBody(rawBody, SECRET, '1614265330');
  const committed = [];
  const result = await handleInboundEmailWebhook(request, {
    secret: SECRET,
    nowIso: NOW_ISO,
    senderAllowlist: [ALLOWED_SENDER],
    commitProposal: async (proposal) => {
      committed.push(proposal);
    },
    log: () => {},
  });
  assert.equal(result.status, 401);
  assert.equal(committed.length, 0);
});

// QA bounce (BL-217): a valid signature over a stale svix-timestamp is a
// replay, not a fresh delivery - reproduces QA's exact repro (a 2021-dated
// signed request) to prove it is now rejected, matching webhook-02's own
// "reject before ever reaching parse/commit" intent for an unauthenticated
// write.
test('a validly signed but stale/replayed request is rejected with no proposal committed', async () => {
  const rawBody = JSON.stringify(updateEmailPayload('BL-042-demo-01', 'x'));
  const request = requestForRawBody(rawBody, SECRET, '1614265330');
  const committed = [];
  const result = await handleInboundEmailWebhook(request, {
    secret: SECRET,
    nowIso: NOW_ISO,
    commitProposal: async (proposal) => {
      committed.push(proposal);
    },
    log: () => {},
  });
  assert.equal(result.status, 401);
  assert.equal(committed.length, 0);
});

test('webhook-03: a validly signed but unparseable email produces no proposal and logs without crashing', async () => {
  const payload = { type: 'email.received', data: { subject: 'Re: hello', text: 'just a normal email', from: ALLOWED_SENDER } };
  const { result, committed, logged } = await run(payload);
  assert.equal(result.status, 200);
  assert.equal(committed.length, 0);
  assert.equal(logged.length, 1);
});

test('webhook-04: a delete email commits a delete proposal with no newText field', async () => {
  const payload = {
    type: 'email.received',
    data: { subject: 'SwarmForge recert: delete BL-042-demo-02', text: 'scenario: BL-042-demo-02\noutcome: delete', from: ALLOWED_SENDER },
  };
  const { committed } = await run(payload);
  assert.equal(committed.length, 1);
  assert.deepEqual(committed[0], { scenarioId: 'BL-042-demo-02', outcome: 'delete', receivedAtIso: '2026-07-09T12:00:00Z' });
  assert.equal('newText' in committed[0], false);
});

test('a confirm email is not committed as a proposal (out of this webhook\'s scope per BL-217)', async () => {
  const payload = { type: 'email.received', data: { subject: 'SwarmForge recert: confirm BL-042-demo-03', text: 'scenario: BL-042-demo-03\noutcome: confirm', from: ALLOWED_SENDER } };
  const { result, committed, logged } = await run(payload);
  assert.equal(result.status, 200);
  assert.equal(committed.length, 0);
  assert.equal(logged.length, 1);
});

test('a signed request whose payload envelope carries no email fields at all produces no proposal and logs without crashing', async () => {
  const { result, committed, logged } = await run({ type: 'email.sent', data: {} });
  assert.equal(result.status, 200);
  assert.equal(committed.length, 0);
  assert.equal(logged.length, 1);
});

test('a commitProposal failure is caught, logged, and still returns a response rather than throwing', async () => {
  const request = requestFor(updateEmailPayload('BL-042-demo-04', 'text'));
  const logged = [];
  const result = await handleInboundEmailWebhook(request, {
    secret: SECRET,
    nowIso: NOW_ISO,
    senderAllowlist: [ALLOWED_SENDER],
    commitProposal: async () => {
      throw new Error('repo write failed');
    },
    log: (message) => logged.push(message),
  });
  assert.equal(result.status, 500);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /repo write failed/);
});

test('a commitProposal failure that rejects with a non-Error value is stringified, not crashed on', async () => {
  const request = requestFor(updateEmailPayload('BL-042-demo-05', 'text'));
  const logged = [];
  const result = await handleInboundEmailWebhook(request, {
    secret: SECRET,
    nowIso: NOW_ISO,
    senderAllowlist: [ALLOWED_SENDER],
    commitProposal: async () => {
      throw 'not-an-error-object';
    },
    log: (message) => logged.push(message),
  });
  assert.equal(result.status, 500);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /not-an-error-object/);
});
