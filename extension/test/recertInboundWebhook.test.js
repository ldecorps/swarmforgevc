const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { extractEmailFields, handleInboundEmailWebhook } = require('../out/notify/recertInboundWebhook');

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

function sign(id, timestamp, rawBody, secret = SECRET) {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const sig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  return `v1,${sig}`;
}

function requestForRawBody(rawBody, secret = SECRET) {
  const svixId = 'msg_1';
  const svixTimestamp = '1614265330';
  return {
    headers: { svixId, svixTimestamp, svixSignature: sign(svixId, svixTimestamp, rawBody, secret) },
    rawBody,
  };
}

function requestFor(payloadObj, secret = SECRET) {
  return requestForRawBody(JSON.stringify(payloadObj), secret);
}

function updateEmailPayload(scenarioId, newText) {
  return {
    type: 'email.received',
    data: {
      subject: `SwarmForge recert: update ${scenarioId}`,
      text: `scenario: ${scenarioId}\noutcome: update\n---\n${newText}`,
    },
  };
}

// ── extractEmailFields ─────────────────────────────────────────────────────

test('extractEmailFields reads subject/text out of the {type, data} envelope', () => {
  const fields = extractEmailFields(updateEmailPayload('BL-042-demo-01', 'new text'));
  assert.deepEqual(fields, { subject: 'SwarmForge recert: update BL-042-demo-01', body: 'scenario: BL-042-demo-01\noutcome: update\n---\nnew text' });
});

test('extractEmailFields returns null for a payload with no data.subject/text', () => {
  assert.equal(extractEmailFields({ type: 'email.sent', data: {} }), null);
});

test('extractEmailFields returns null for non-object input', () => {
  assert.equal(extractEmailFields(null), null);
  assert.equal(extractEmailFields('not an object'), null);
});

// ── handleInboundEmailWebhook ──────────────────────────────────────────────

async function run(payloadObj, deps = {}) {
  const request = requestFor(payloadObj, deps.secretForSigning);
  const committed = [];
  const logged = [];
  const result = await handleInboundEmailWebhook(request, {
    secret: SECRET,
    nowIso: '2026-07-09T12:00:00Z',
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
    nowIso: '2026-07-09T12:00:00Z',
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

test('webhook-03: a validly signed but unparseable email produces no proposal and logs without crashing', async () => {
  const payload = { type: 'email.received', data: { subject: 'Re: hello', text: 'just a normal email' } };
  const { result, committed, logged } = await run(payload);
  assert.equal(result.status, 200);
  assert.equal(committed.length, 0);
  assert.equal(logged.length, 1);
});

test('webhook-04: a delete email commits a delete proposal with no newText field', async () => {
  const payload = {
    type: 'email.received',
    data: { subject: 'SwarmForge recert: delete BL-042-demo-02', text: 'scenario: BL-042-demo-02\noutcome: delete' },
  };
  const { committed } = await run(payload);
  assert.equal(committed.length, 1);
  assert.deepEqual(committed[0], { scenarioId: 'BL-042-demo-02', outcome: 'delete', receivedAtIso: '2026-07-09T12:00:00Z' });
  assert.equal('newText' in committed[0], false);
});

test('a confirm email is not committed as a proposal (out of this webhook\'s scope per BL-217)', async () => {
  const payload = { type: 'email.received', data: { subject: 'SwarmForge recert: confirm BL-042-demo-03', text: 'scenario: BL-042-demo-03\noutcome: confirm' } };
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
    nowIso: '2026-07-09T12:00:00Z',
    commitProposal: async () => {
      throw new Error('repo write failed');
    },
    log: (message) => logged.push(message),
  });
  assert.equal(result.status, 500);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /repo write failed/);
});
