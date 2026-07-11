'use strict';

// BL-288: step handlers for "Deployed recert inbound webhook handler wires
// the BL-217 core to commit proposals". Drives the REAL compiled
// recertWebhookVercelHandler.js (out/notify/recertWebhookVercelHandler.js)
// against a fake req/res + fixture env + a stubbed global.fetch (never a
// real network call, never a real Vercel runtime) - mirrors
// recertSenderAllowlistSteps.js's own signing-fixture convention (BL-225:
// a runtime-built fake secret, never a committed whsec_ literal).
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const {
  toWebhookRequest,
  recertWebhookHandler,
} = require(path.join(EXT_DIR, 'out', 'notify', 'recertWebhookVercelHandler'));
const { verifySvixSignature } = require(path.join(EXT_DIR, 'out', 'notify', 'svixSignature'));

const SECRET = 'whsec_' + Buffer.from('bl-288-fixture-seed').toString('base64');
const NOW_ISO = '2026-07-11T12:00:00Z';
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
  };
}

function updateEmailPayload(scenarioId, newText, from) {
  return {
    type: 'email.received',
    data: { subject: `SwarmForge recert: update ${scenarioId}`, text: `scenario: ${scenarioId}\noutcome: update\n---\n${newText}`, from },
  };
}

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
  return { statusCode: undefined, body: undefined, end(body) { this.body = body; } };
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

async function withStubbedFetch(fn, { shouldBeCalled }) {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, body: opts.body });
    return { ok: true, status: 201 };
  };
  try {
    await fn();
  } finally {
    global.fetch = originalFetch;
  }
  if (!shouldBeCalled && calls.length > 0) {
    throw new Error(`expected no GitHub commit call, got: ${JSON.stringify(calls)}`);
  }
  return calls;
}

async function runHandler(ctx, env) {
  const originalEnv = process.env;
  process.env = { ...originalEnv, ...env };
  try {
    ctx.commitCalls = await withStubbedFetch(
      async () => {
        await recertWebhookHandler(ctx.req, ctx.res, NOW_ISO);
      },
      { shouldBeCalled: ctx.expectCommit !== false }
    );
  } finally {
    process.env = originalEnv;
  }
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^the recert inbound webhook handler wraps the BL-217 core with env-sourced deps$/, () => {
    // Framing only - each scenario's own Given builds its fixture.
  });

  // ── recert-handler-01 ────────────────────────────────────────────────
  registry.define(/^a signed inbound webhook POST from an allowed sender$/, (ctx) => {
    const rawBody = JSON.stringify(updateEmailPayload('BL-288-fixture-01', 'the new scenario text', ALLOWED_SENDER));
    ctx.req = fakeRequest(rawBody, rawHeadersFor(rawBody));
    ctx.res = fakeResponse();
    ctx.env = baseEnv();
    ctx.expectCommit = true;
  });

  registry.define(/^the handler processes the request$/, async (ctx) => {
    await runHandler(ctx, ctx.env);
  });

  registry.define(/^it commits a recert proposal and responds with success$/, (ctx) => {
    if (ctx.res.statusCode !== 200 || ctx.res.body !== 'proposal committed') {
      throw new Error(`expected a success response, got status=${ctx.res.statusCode} body=${ctx.res.body}`);
    }
    if (ctx.commitCalls.length !== 1) {
      throw new Error(`expected exactly one committed proposal, got ${ctx.commitCalls.length}`);
    }
  });

  // ── recert-handler-02 ────────────────────────────────────────────────
  registry.define(/^an inbound webhook POST carrying no valid signature$/, (ctx) => {
    const rawBody = JSON.stringify(updateEmailPayload('BL-288-fixture-02', 'x', ALLOWED_SENDER));
    const wrongSecret = 'whsec_' + Buffer.from('wrong').toString('base64');
    ctx.req = fakeRequest(rawBody, rawHeadersFor(rawBody, wrongSecret));
    ctx.res = fakeResponse();
    ctx.env = baseEnv();
    ctx.expectCommit = false;
  });

  registry.define(/^no recert proposal is committed$/, (ctx) => {
    if (ctx.commitCalls.length !== 0) {
      throw new Error(`expected no committed proposal, got ${ctx.commitCalls.length}`);
    }
  });

  registry.define(/^the response is a rejection$/, (ctx) => {
    if (ctx.res.statusCode < 400) {
      throw new Error(`expected a rejection status (>=400), got ${ctx.res.statusCode}`);
    }
  });

  // ── recert-handler-03 ────────────────────────────────────────────────
  registry.define(/^an inbound webhook POST with a signed raw payload$/, (ctx) => {
    // Reformatting this exact string via JSON.parse+JSON.stringify changes
    // it (1.50 -> 1.5), so it actually proves raw-byte fidelity, not just a
    // tautology.
    ctx.rawBody = '{"type":"email.received","data":{"subject":"S","text":"B","from":"ops@example.com"},"extra":1.50}';
    ctx.headers = rawHeadersFor(ctx.rawBody);
  });

  registry.define(/^the handler builds the core request$/, (ctx) => {
    ctx.coreRequest = toWebhookRequest(ctx.rawBody, ctx.headers);
  });

  registry.define(/^it passes the exact raw body bytes to the core, not a re-serialized copy$/, (ctx) => {
    if (ctx.coreRequest.rawBody !== ctx.rawBody) {
      throw new Error('expected the core request to carry the exact raw body bytes');
    }
    if (!verifySvixSignature(ctx.coreRequest.headers, ctx.coreRequest.rawBody, SECRET)) {
      throw new Error('expected the exact raw bytes to verify against the signature');
    }
    const reparsed = JSON.stringify(JSON.parse(ctx.rawBody));
    if (verifySvixSignature(ctx.coreRequest.headers, reparsed, SECRET)) {
      throw new Error('expected a re-serialized copy to FAIL verification, proving raw-byte fidelity matters');
    }
  });

  // ── recert-handler-04 ────────────────────────────────────────────────
  registry.define(/^the signing secret is absent from the handler's environment$/, (ctx) => {
    const rawBody = JSON.stringify(updateEmailPayload('BL-288-fixture-04', 'x', ALLOWED_SENDER));
    ctx.req = fakeRequest(rawBody, rawHeadersFor(rawBody));
    ctx.res = fakeResponse();
    ctx.env = baseEnv({ RECERT_WEBHOOK_SECRET: '' });
    ctx.expectCommit = false;
  });

  // ── recert-handler-05 ────────────────────────────────────────────────
  registry.define(/^the core returns a status and body for a processed request$/, (ctx) => {
    const rawBody = JSON.stringify(updateEmailPayload('BL-288-fixture-05', 'x', 'evil@example.com'));
    ctx.req = fakeRequest(rawBody, rawHeadersFor(rawBody));
    ctx.res = fakeResponse();
    ctx.env = baseEnv();
    ctx.expectCommit = false;
  });

  registry.define(/^the handler finishes$/, async (ctx) => {
    await runHandler(ctx, ctx.env);
  });

  registry.define(/^the HTTP response carries that status and that body$/, (ctx) => {
    if (ctx.res.statusCode !== 403 || ctx.res.body !== 'sender not allowed') {
      throw new Error(`expected the core's own status/body (403/"sender not allowed") to reach the response, got status=${ctx.res.statusCode} body=${ctx.res.body}`);
    }
  });
}

module.exports = { registerSteps };
