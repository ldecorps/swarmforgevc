'use strict';

// BL-289: wires BL-217's own acceptance feature (previously 0/5 - no
// registered step handlers at all) to drive the REAL core end to end:
// recertInboundWebhook.ts's handleInboundEmailWebhook (webhook-01..04) and,
// for webhook-05, the REAL recertProposalRepoCommit.ts +
// bridge-recert-proposals.ts + recertificationStore.ts chain (a fake PutFn
// writes locally instead of a real GitHub PUT, but every other step is the
// real production code) - proving a committed proposal really reaches
// BL-150's own durable review queue, not just a fake. Mirrors
// recertSenderAllowlistSteps.js's/BL-288's recertInboundServerlessHandlerSteps.js's
// own BL-225 runtime-built-fake-secret signing convention throughout - no
// committed whsec_ literal, no real network, no real timers.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

const EXT_DIR = path.join(__dirname, '..', '..', '..', 'extension');
const { handleInboundEmailWebhook } = require(path.join(EXT_DIR, 'out', 'notify', 'recertInboundWebhook'));
const { commitRecertProposalToRepo } = require(path.join(EXT_DIR, 'out', 'notify', 'recertProposalRepoCommit'));
const { bridgeRecertProposals } = require(path.join(EXT_DIR, 'out', 'tools', 'bridge-recert-proposals'));

const SECRET = 'whsec_' + Buffer.from('bl-217-fixture-seed').toString('base64');
const WRONG_SECRET = 'whsec_' + Buffer.from('wrong').toString('base64');
const NOW_ISO = '2026-07-11T12:00:00Z';
const FRESH_TIMESTAMP = String(Math.floor(Date.parse(NOW_ISO) / 1000));
const ALLOWED_SENDER = 'ops@example.com';

function sign(id, timestamp, rawBody, secret) {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const sig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  return `v1,${sig}`;
}

function signedRequest(rawBody, secret) {
  const svixId = 'msg_1';
  return {
    headers: { svixId, svixTimestamp: FRESH_TIMESTAMP, svixSignature: sign(svixId, FRESH_TIMESTAMP, rawBody, secret) },
    rawBody,
  };
}

function updateEmailPayload(scenarioId, newText, from = ALLOWED_SENDER) {
  return {
    type: 'email.received',
    data: { subject: `SwarmForge recert: update ${scenarioId}`, text: `scenario: ${scenarioId}\noutcome: update\n---\n${newText}`, from },
  };
}

function deleteEmailPayload(scenarioId, from = ALLOWED_SENDER) {
  return {
    type: 'email.received',
    data: { subject: `SwarmForge recert: delete ${scenarioId}`, text: `scenario: ${scenarioId}\noutcome: delete`, from },
  };
}

async function processInboundRequest(ctx) {
  ctx.committed = [];
  ctx.logged = [];
  ctx.result = await handleInboundEmailWebhook(signedRequest(ctx.rawBody, ctx.signWithSecret), {
    secret: SECRET,
    nowIso: NOW_ISO,
    senderAllowlist: [ALLOWED_SENDER],
    commitProposal: async (proposal) => {
      ctx.committed.push(proposal);
    },
    log: (message) => ctx.logged.push(message),
  });
  // "the request is rejected" is ALSO registered by burnRateSteps.js with
  // the SAME wording (BL-273) - the registry's first-registered handler
  // wins for identical step text (this project's own established
  // convention, see the Gherkin step registry lesson), and that handler
  // reads ctx.status expecting 401 - the core's own authenticateRequest
  // returns exactly 401 for a bad signature, so writing the SAME field
  // here reuses it correctly rather than adding a dead second definition.
  ctx.status = ctx.result.status;
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aps-recert-webhook-'));
}

function registerSteps(registry) {
  // ── Background ───────────────────────────────────────────────────────
  registry.define(/^a serverless inbound receiver configured with the Resend signing secret$/, () => {
    // Framing only - each scenario's own Given builds its own request/proposal fixture.
  });

  // ── webhook-01 ────────────────────────────────────────────────────────
  registry.define(/^a phone-composed email with a scenario id, outcome "update", and new text$/, (ctx) => {
    ctx.scenarioId = 'BL-217-demo-01';
    ctx.newText = 'the new scenario text';
    ctx.rawBody = JSON.stringify(updateEmailPayload(ctx.scenarioId, ctx.newText));
  });

  registry.define(/^the email carries a valid Resend signature$/, (ctx) => {
    ctx.signWithSecret = SECRET;
  });

  registry.define(/^the inbound receiver processes it$/, async (ctx) => {
    await processInboundRequest(ctx);
  });

  registry.define(/^exactly one recertification proposal is committed to the review queue$/, (ctx) => {
    if (ctx.committed.length !== 1) {
      throw new Error(`expected exactly one committed proposal, got ${ctx.committed.length}`);
    }
  });

  registry.define(/^the proposal carries the scenario id, outcome, and new text$/, (ctx) => {
    const [proposal] = ctx.committed;
    if (proposal.scenarioId !== ctx.scenarioId || proposal.outcome !== 'update' || proposal.newText !== ctx.newText) {
      throw new Error(`expected the proposal to carry the scenario id/outcome/new text, got: ${JSON.stringify(proposal)}`);
    }
  });

  // ── webhook-02 ────────────────────────────────────────────────────────
  registry.define(/^an inbound request whose signature does not verify$/, (ctx) => {
    ctx.rawBody = JSON.stringify(updateEmailPayload('BL-217-demo-02', 'x'));
    ctx.signWithSecret = WRONG_SECRET;
  });

  registry.define(/^no proposal is created$/, (ctx) => {
    if (ctx.committed.length !== 0) {
      throw new Error(`expected no proposal committed, got ${ctx.committed.length}`);
    }
  });

  // ── webhook-03 ────────────────────────────────────────────────────────
  registry.define(/^a validly signed request whose body is not a recertification email$/, (ctx) => {
    ctx.rawBody = JSON.stringify({
      type: 'email.received',
      data: { subject: 'Re: hello', text: 'just a normal email', from: ALLOWED_SENDER },
    });
    ctx.signWithSecret = SECRET;
  });

  registry.define(/^the failure is logged without crashing$/, (ctx) => {
    if (ctx.logged.length === 0) {
      throw new Error('expected the unparseable-email outcome to be logged');
    }
  });

  // ── webhook-04 ────────────────────────────────────────────────────────
  registry.define(/^a phone-composed email with outcome "delete" and a valid signature$/, (ctx) => {
    ctx.scenarioId = 'BL-217-demo-04';
    ctx.rawBody = JSON.stringify(deleteEmailPayload(ctx.scenarioId));
    ctx.signWithSecret = SECRET;
  });

  registry.define(/^a delete proposal is committed to the review queue$/, (ctx) => {
    if (ctx.committed.length !== 1 || ctx.committed[0].outcome !== 'delete') {
      throw new Error(`expected exactly one delete proposal committed, got: ${JSON.stringify(ctx.committed)}`);
    }
  });

  registry.define(/^the scenario is not removed until the specifier accepts it$/, () => {
    // Structural guarantee (same idiom as briefingDiagramSteps.js's own
    // network-API check): the receiver core never touches the filesystem
    // directly - committing a delete PROPOSAL (asserted by the prior step)
    // is its only possible effect. Only BL-150's own specifier-accept flow
    // (out of this ticket's scope) ever applies one.
    const src = fs.readFileSync(path.join(EXT_DIR, 'src', 'notify', 'recertInboundWebhook.ts'), 'utf8');
    if (/\bfs\.(rm|unlink|write)/.test(src)) {
      throw new Error('expected the inbound receiver core to never touch the filesystem directly - only commitProposal may act');
    }
  });

  // ── webhook-05 ────────────────────────────────────────────────────────
  registry.define(/^a proposal has been committed by the receiver$/, async (ctx) => {
    ctx.target = mkTmp();
    ctx.proposal = { scenarioId: 'BL-217-demo-05', outcome: 'update', newText: 'reaches the review queue', receivedAtIso: NOW_ISO };
    // Real commitRecertProposalToRepo + real recertProposalCommitPath
    // naming - only the PUT transport is faked, writing locally instead of
    // a real GitHub call, so the file lands exactly where the real
    // receiver would name it.
    const fakePutFn = async (url, body) => {
      const filePath = url.split('/contents/')[1];
      const fullPath = path.join(ctx.target, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, Buffer.from(JSON.parse(body).content, 'base64'));
      return { ok: true, status: 200 };
    };
    await commitRecertProposalToRepo(ctx.proposal, { owner: 'x', repo: 'y', branch: 'main', token: 'fake' }, Date.parse(NOW_ISO), fakePutFn);
  });

  registry.define(/^the host bridge picks up the committed proposal$/, (ctx) => {
    ctx.bridgeResult = bridgeRecertProposals(ctx.target, Date.parse(NOW_ISO));
  });

  registry.define(/^it enters the same durable review queue BL-150's seam feeds$/, (ctx) => {
    if (ctx.bridgeResult.ingested.length !== 1) {
      throw new Error(`expected the bridge to ingest exactly one proposal, got: ${JSON.stringify(ctx.bridgeResult)}`);
    }
    const month = new Date(Date.parse(NOW_ISO)).toISOString().slice(0, 7);
    const queueFile = path.join(ctx.target, '.swarmforge', 'recert_proposals', `${month}.jsonl`);
    if (!fs.existsSync(queueFile)) {
      throw new Error(`expected the durable review queue file to exist at ${queueFile}`);
    }
    const lines = fs.readFileSync(queueFile, 'utf8').trim().split('\n');
    if (!lines.some((line) => JSON.parse(line).scenarioId === ctx.proposal.scenarioId)) {
      throw new Error(`expected the proposal to reach the durable review queue, got: ${lines}`);
    }
  });
}

module.exports = { registerSteps };
