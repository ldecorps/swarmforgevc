'use strict';

// BL-248: step handlers for the recert inbound-email webhook sender
// allowlist feature. Drives the real compiled handleInboundEmailWebhook
// (out/notify/recertInboundWebhook.js) with a real svix-signed request -
// mirrors recertInboundWebhook.test.js's own signing helpers exactly (same
// BL-225 runtime-built-fake-secret convention, no committed whsec_ literal).
const path = require('node:path');
const crypto = require('node:crypto');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { handleInboundEmailWebhook } = require(path.join(EXT_DIR, 'out', 'notify', 'recertInboundWebhook'));

const SECRET = 'whsec_' + Buffer.from('bl-248-fake-fixture-seed').toString('base64');
const NOW_ISO = '2026-07-10T12:00:00Z';
const FRESH_TIMESTAMP = String(Math.floor(Date.parse(NOW_ISO) / 1000));
const DEFAULT_SENDER = 'ops@example.com';

function sign(id, timestamp, rawBody) {
  const secretBytes = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const sig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  return `v1,${sig}`;
}

function signedRequest(rawBody) {
  const svixId = 'msg_1';
  return {
    headers: { svixId, svixTimestamp: FRESH_TIMESTAMP, svixSignature: sign(svixId, FRESH_TIMESTAMP, rawBody) },
    rawBody,
  };
}

function updateEmailPayload(scenarioId, newText, from) {
  return {
    type: 'email.received',
    data: {
      subject: `SwarmForge recert: update ${scenarioId}`,
      text: `scenario: ${scenarioId}\noutcome: update\n---\n${newText}`,
      from,
    },
  };
}

function registerSteps(registry) {
  registry.define(/^the recert inbound-email webhook with a configured sender allowlist$/, (ctx) => {
    ctx.allowlist = [DEFAULT_SENDER];
    ctx.sender = DEFAULT_SENDER;
  });

  registry.define(/^a validly-signed, fresh request whose email parses as a recertification proposal$/, (ctx) => {
    ctx.scenarioId = 'BL-248-fixture-01';
    ctx.newText = 'fixture proposal text';
  });

  // ── allowlisted-sender-commits-01 ─────────────────────────────────────
  registry.define(/^the request's sender is on the allowlist$/, (ctx) => {
    ctx.sender = DEFAULT_SENDER;
    ctx.allowlist = [DEFAULT_SENDER];
  });

  // ── non-allowlisted-rejected-02 ───────────────────────────────────────
  registry.define(/^the request's sender is not on the allowlist$/, (ctx) => {
    ctx.sender = 'evil@example.com';
    ctx.allowlist = [DEFAULT_SENDER];
  });

  // ── sender-match-case-insensitive-03 (Scenario Outline) ────────────────
  registry.define(/^the allowlist contains "([^"]+)"$/, (ctx, entry) => {
    ctx.allowlist = [entry];
  });

  registry.define(/^the request's sender is "([^"]+)"$/, (ctx, sender) => {
    ctx.sender = sender;
  });

  // ── empty-allowlist-fail-closed-04 ──────────────────────────────────────
  registry.define(/^the sender allowlist is empty$/, (ctx) => {
    ctx.allowlist = [];
  });

  // ── shared When/Then ─────────────────────────────────────────────────
  registry.define(/^the webhook handles the request$/, async (ctx) => {
    const rawBody = JSON.stringify(updateEmailPayload(ctx.scenarioId, ctx.newText, ctx.sender));
    ctx.committed = [];
    ctx.logged = [];
    ctx.response = await handleInboundEmailWebhook(signedRequest(rawBody), {
      secret: SECRET,
      nowIso: NOW_ISO,
      senderAllowlist: ctx.allowlist,
      commitProposal: async (proposal) => {
        ctx.committed.push(proposal);
      },
      log: (message) => ctx.logged.push(message),
    });
  });

  registry.define(/^a proposal is committed$/, (ctx) => {
    if (ctx.committed.length !== 1) {
      throw new Error(`expected exactly one committed proposal, got ${ctx.committed.length}`);
    }
  });

  registry.define(/^no proposal is committed$/, (ctx) => {
    if (ctx.committed.length !== 0) {
      throw new Error(`expected no committed proposal, got ${ctx.committed.length}`);
    }
  });

  registry.define(/^the sender rejection is logged$/, (ctx) => {
    if (!ctx.logged.some((line) => /rejected sender/.test(line))) {
      throw new Error(`expected a sender-rejection log line, got: ${JSON.stringify(ctx.logged)}`);
    }
  });

  registry.define(/^the recert proposal is "([^"]+)"$/, (ctx, outcome) => {
    const expectedCount = outcome === 'committed' ? 1 : 0;
    if (ctx.committed.length !== expectedCount) {
      throw new Error(`expected the proposal to be "${outcome}" (committed count ${expectedCount}), got ${ctx.committed.length}`);
    }
  });
}

module.exports = { registerSteps };
